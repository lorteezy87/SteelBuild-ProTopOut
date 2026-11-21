import { eq } from "drizzle-orm";
import {
  calendarExceptions,
  calendars,
  customFieldDefs,
  expenseCodes,
  jobRoles,
  settings,
  timeCodes,
  wfApps,
  wfSlaPolicies,
  wfStates,
  wfTransitions,
} from "../../drizzle/schema";
import { ADDED_APP_FIELDS, fieldsToAdd } from "@shared/safety";
import { usHolidays } from "../engine/calendar";
import { db, type Db } from "../db";
import {
  APP_PRESETS,
  EXPENSE_CODE_PRESETS,
  JOB_ROLE_PRESETS,
  PROJECT_TYPE_PRESETS,
  ROLE_PRESETS,
  TIME_CODE_PRESETS,
  type AppPreset,
} from "./presets";

/**
 * Versioned, idempotent install of system defaults. Each step records completion
 * in settings.bootstrap_version only after it succeeds, so restarts resume
 * unfinished work and never overwrite user edits.
 */
const BOOTSTRAP_VERSION = 1;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const d = await db();
  const row = await d.select().from(settings).where(eq(settings.key, key)).limit(1);
  return (row[0]?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  const d = await db();
  await d.insert(settings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}

export async function installApp(d: Db, p: AppPreset, sortOrder: number) {
  const existing = await d.select().from(wfApps).where(eq(wfApps.key, p.key)).limit(1);
  if (existing.length) return existing[0].id;
  const [{ id: appId }] = await d
    .insert(wfApps)
    .values({
      key: p.key,
      name: p.name,
      pluralName: p.pluralName,
      numberPrefix: p.numberPrefix,
      description: p.description,
      color: p.color,
      icon: p.icon,
      scope: p.scope,
      dueDateLabel: p.dueDateLabel,
      allowTimeLogging: p.allowTimeLogging ?? false,
      scoreFormula: p.scoreFormula ?? null,
      config: p.config ?? null,
      sortOrder,
    })
    .$returningId();

  const stateIds = new Map<string, number>();
  for (let i = 0; i < p.states.length; i++) {
    const s = p.states[i];
    const [{ id }] = await d
      .insert(wfStates)
      .values({ appId, name: s.name, category: s.category, color: s.color, sortOrder: i })
      .$returningId();
    stateIds.set(s.name, id);
  }
  for (const t of p.transitions) {
    await d.insert(wfTransitions).values({
      appId,
      fromStateId: stateIds.get(t.from)!,
      toStateId: stateIds.get(t.to)!,
      name: t.name,
      userAllowed: true,
    });
  }
  for (const s of p.sla ?? []) {
    await d.insert(wfSlaPolicies).values({
      appId,
      stateId: stateIds.get(s.state)!,
      priority: s.priority ?? null,
      source: s.source,
      hours: s.hours ?? 72,
      action: s.action ?? "mark_delayed",
      toStateId: s.to ? stateIds.get(s.to) ?? null : null,
      atRiskPct: 75,
    });
  }
  for (let i = 0; i < p.fields.length; i++) {
    const f = p.fields[i];
    await d.insert(customFieldDefs).values({
      entityType: `app:${p.key}`,
      key: f.key,
      label: f.label,
      fieldType: f.fieldType,
      options: f.options ?? null,
      formula: f.formula ?? null,
      required: f.required ?? false,
      isFinancial: f.isFinancial ?? false,
      showInList: f.showInList ?? false,
      helpText: f.helpText ?? null,
      sortOrder: i,
    });
  }
  return appId;
}

async function step1(d: Db) {
  // Calendars
  const holidays: { date: string; name: string }[] = [];
  for (let y = 2025; y <= 2030; y++) holidays.push(...usHolidays(y));
  const [{ id: stdId }] = await d
    .insert(calendars)
    .values({ name: "Standard 5×8 (Mon–Fri)", workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, isDefault: true })
    .$returningId();
  const [{ id: fourTenId }] = await d
    .insert(calendars)
    .values({ name: "4×10 (Mon–Thu)", workDays: [1, 2, 3, 4], hoursPerDay: 10, isDefault: false })
    .$returningId();
  for (const calId of [stdId, fourTenId]) {
    await d
      .insert(calendarExceptions)
      .values(holidays.map(h => ({ calendarId: calId, date: h.date, name: h.name, isWorking: false })));
  }

  await d.insert(jobRoles).values(JOB_ROLE_PRESETS);
  await d.insert(timeCodes).values(TIME_CODE_PRESETS);
  await d.insert(expenseCodes).values(EXPENSE_CODE_PRESETS);

  for (let i = 0; i < APP_PRESETS.length; i++) await installApp(d, APP_PRESETS[i], i);

  await d.insert(settings).values([
    { key: "projectTypes", value: PROJECT_TYPE_PRESETS },
    {
      key: "org",
      value: { name: "FM Steel Construction LLC", timezone: "America/Phoenix", deliveryLeadDays: 2, currency: "USD" },
    },
  ]);
}

/**
 * Back-fill log fields a release added (ADDED_APP_FIELDS, e.g. the Phase 3 incident fields on the Safety log)
 * into installs created before it. Each key is added at most once, ever: if the owner deletes it, it stays deleted.
 */
export async function ensureAppFields(d: Db) {
  const applied = await getSetting<string[]>("app_fields_added", []);
  for (const p of APP_PRESETS) {
    const releaseKeys = ADDED_APP_FIELDS[p.key];
    if (!releaseKeys?.length) continue;
    const [app] = await d.select({ id: wfApps.id }).from(wfApps).where(eq(wfApps.key, p.key)).limit(1);
    if (!app) continue;
    const have = await d.select({ key: customFieldDefs.key }).from(customFieldDefs).where(eq(customFieldDefs.entityType, `app:${p.key}`));
    const appliedHere = applied.filter(a => a.startsWith(`${p.key}.`)).map(a => a.slice(p.key.length + 1));
    for (const f of fieldsToAdd(p.fields, have.map(h => h.key), appliedHere, releaseKeys)) {
      await d
        .insert(customFieldDefs)
        .values({
          entityType: `app:${p.key}`,
          key: f.key,
          label: f.label,
          fieldType: f.fieldType,
          options: f.options ?? null,
          formula: f.formula ?? null,
          required: f.required ?? false,
          isFinancial: f.isFinancial ?? false,
          showInList: f.showInList ?? false,
          helpText: f.helpText ?? null,
          sortOrder: p.fields.indexOf(f),
        })
        .onDuplicateKeyUpdate({ set: { key: f.key } });
      console.log(`[bootstrap] added field ${f.key} to ${p.key}`);
    }
    // Remember every release key as handled (present or just added), so a later deletion by the owner sticks.
    const mark = releaseKeys.map(k => `${p.key}.${k}`).filter(k => !applied.includes(k));
    if (mark.length) {
      applied.push(...mark);
      await setSetting("app_fields_added", applied);
    }
  }
}

let running: Promise<void> | null = null;

export function ensureBootstrap(): Promise<void> {
  if (!running) {
    running = (async () => {
      const d = await db();
      const version = await getSetting<number>("bootstrap_version", 0);
      if (version < 1) {
        await d.transaction(async tx => step1(tx as unknown as Db));
        await setSetting("bootstrap_version", 1);
        console.log("[bootstrap] installed steel-erector defaults v1");
      }
      if (version > BOOTSTRAP_VERSION) console.warn("[bootstrap] database is ahead of code version");
      await ensureAppFields(d);
    })().catch(e => {
      running = null;
      throw e;
    });
  }
  return running;
}
