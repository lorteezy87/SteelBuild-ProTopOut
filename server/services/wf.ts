import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { evaluateFormula } from "@shared/formula";
import {
  deliveries,
  projects,
  tasks,
  wfApps,
  wfEvents,
  wfItems,
  wfSlaPolicies,
  wfStates,
  wfTransitions,
} from "../../drizzle/schema";
import { getSetting } from "../bootstrap";
import { db } from "../db";
import { orgToday } from "./calendars";
import { getValues, saveValues } from "./customFields";
import { emit, follow, logActivity, notify, notifyFollowers } from "./events";

type Ctx = { user: { id: number; name: string | null }; quiet?: boolean };
export type WfApp = typeof wfApps.$inferSelect;
export type WfItem = typeof wfItems.$inferSelect;

export async function getApp(appIdOrKey: number | string) {
  const d = await db();
  const [app] = await d
    .select()
    .from(wfApps)
    .where(typeof appIdOrKey === "number" ? eq(wfApps.id, appIdOrKey) : eq(wfApps.key, appIdOrKey))
    .limit(1);
  if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Log type not found" });
  return app;
}

export async function getAppStructure(appId: number) {
  const d = await db();
  const [states, transitions, policies] = await Promise.all([
    d.select().from(wfStates).where(eq(wfStates.appId, appId)).orderBy(asc(wfStates.sortOrder)),
    d.select().from(wfTransitions).where(eq(wfTransitions.appId, appId)),
    d.select().from(wfSlaPolicies).where(eq(wfSlaPolicies.appId, appId)),
  ]);
  return { states, transitions, policies };
}

/** Offset-aware end of a calendar day in the org time zone. */
export function endOfDayInTz(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T23:59:59Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

export function computeSla(
  item: Pick<WfItem, "stateId" | "priority" | "stateEnteredAt" | "createdAt" | "dueDate">,
  policies: (typeof wfSlaPolicies.$inferSelect)[],
  noticeHours: number,
  timeZone: string
): { slaDueAt: Date | null; slaAtRiskAt: Date | null; policyId: number | null } {
  const forState = policies.filter(p => p.stateId === item.stateId);
  const policy = forState.find(p => p.priority === item.priority) ?? forState.find(p => !p.priority);
  if (!policy) return { slaDueAt: null, slaAtRiskAt: null, policyId: null };
  let start: Date;
  let due: Date | null;
  if (policy.source === "due_date") {
    start = item.stateEnteredAt;
    due = item.dueDate ? endOfDayInTz(item.dueDate, timeZone) : null;
  } else if (policy.source === "project_notice") {
    start = item.createdAt;
    due = new Date(start.getTime() + noticeHours * 3_600_000);
  } else {
    start = item.stateEnteredAt;
    due = new Date(start.getTime() + policy.hours * 3_600_000);
  }
  if (!due) return { slaDueAt: null, slaAtRiskAt: null, policyId: policy.id };
  const span = Math.max(0, due.getTime() - start.getTime());
  const atRisk = new Date(start.getTime() + (span * (policy.atRiskPct ?? 75)) / 100);
  return { slaDueAt: due, slaAtRiskAt: atRisk, policyId: policy.id };
}

export function slaStatusAt(now: Date, due: Date | null, atRisk: Date | null): "ok" | "at_risk" | "delayed" {
  if (!due) return "ok";
  if (now >= due) return "delayed";
  if (atRisk && now >= atRisk) return "at_risk";
  return "ok";
}

async function orgTz() {
  const org = await getSetting<{ timezone?: string }>("org", {});
  return org.timezone || "America/Phoenix";
}

async function noticeHoursFor(projectId: number | null) {
  if (!projectId) return 72;
  const d = await db();
  const [p] = await d.select({ h: projects.noticeHours }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return p?.h ?? 72;
}

/** Recalculate SLA dates/status, mirrors and score for one item. */
export async function refreshItem(itemId: number) {
  const d = await db();
  const [item] = await d.select().from(wfItems).where(eq(wfItems.id, itemId)).limit(1);
  if (!item) return null;
  const app = await getApp(item.appId);
  const { states, policies } = await getAppStructure(app.id);
  const state = states.find(s => s.id === item.stateId);
  const tz = await orgTz();
  const sla =
    state?.category === "end"
      ? { slaDueAt: null, slaAtRiskAt: null }
      : computeSla(item, policies, await noticeHoursFor(item.projectId), tz);
  const values = (await getValues(`app:${app.key}`, [item.id])).get(item.id) ?? {};
  const cfg = app.config ?? {};
  const num = (k?: string) => (k && typeof values[k] === "number" ? (values[k] as number) : 0);
  let score: number | null = null;
  if (app.scoreFormula) {
    try {
      const v = evaluateFormula(app.scoreFormula, { me: { ...item, ...values }, today: await orgToday() });
      score = typeof v === "number" ? v : null;
    } catch {
      score = null;
    }
  }
  const slaStatus = slaStatusAt(new Date(), sla.slaDueAt, sla.slaAtRiskAt);
  await d
    .update(wfItems)
    .set({
      slaDueAt: sla.slaDueAt,
      slaAtRiskAt: sla.slaAtRiskAt,
      slaStatus,
      costImpact: cfg.costField ? num(cfg.costField) : item.costImpact,
      scheduleImpactDays: cfg.scheduleField ? num(cfg.scheduleField) : item.scheduleImpactDays,
      score,
      closedAt: state?.category === "end" ? item.closedAt ?? new Date() : null,
    })
    .where(eq(wfItems.id, item.id));
  return { ...item, ...sla, slaStatus, score };
}

export function itemLabel(app: Pick<WfApp, "numberPrefix">, item: Pick<WfItem, "number">) {
  return `${app.numberPrefix}-${String(item.number).padStart(3, "0")}`;
}

/** Linked field records must exist on the item's own job, never on global logs. */
export async function validateItemLinks(projectId: number | null, links: { linkedTaskId?: number | null; linkedDeliveryId?: number | null }) {
  const d = await db();
  if (links.linkedTaskId != null) {
    const [task] = await d.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, links.linkedTaskId)).limit(1);
    if (!projectId || !task || task.projectId !== projectId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Linked task must be on the same job" });
    }
  }
  if (links.linkedDeliveryId != null) {
    const [delivery] = await d.select({ projectId: deliveries.projectId }).from(deliveries).where(eq(deliveries.id, links.linkedDeliveryId)).limit(1);
    if (!projectId || !delivery || delivery.projectId !== projectId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Linked delivery must be on the same job" });
    }
  }
}

export async function createItem(
  ctx: Ctx,
  input: {
    appId: number;
    projectId: number | null;
    title: string;
    description?: string | null;
    priority?: string;
    assigneeId?: number | null;
    responsibleParty?: string | null;
    dueDate?: string | null;
    linkedTaskId?: number | null;
    linkedDeliveryId?: number | null;
    customFields?: Record<string, unknown>;
    canFinancial: boolean;
  }
) {
  const d = await db();
  const app = await getApp(input.appId);
  if (app.scope === "project" && !input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: `${app.name} must belong to a job` });
  const { states } = await getAppStructure(app.id);
  const start = states.find(s => s.category === "start") ?? states[0];
  if (!start) throw new TRPCError({ code: "BAD_REQUEST", message: "This log type has no states" });
  const projectId = app.scope === "global" ? null : input.projectId;
  await validateItemLinks(projectId, input);

  const [mx] = await d
    .select({ n: sql<number>`coalesce(max(${wfItems.number}),0)` })
    .from(wfItems)
    .where(projectId ? and(eq(wfItems.appId, app.id), eq(wfItems.projectId, projectId)) : eq(wfItems.appId, app.id));
  const number = Number(mx?.n ?? 0) + 1;

  const [{ id }] = await d
    .insert(wfItems)
    .values({
      appId: app.id,
      projectId,
      number,
      title: input.title,
      description: input.description ?? null,
      stateId: start.id,
      priority: input.priority ?? "normal",
      assigneeId: input.assigneeId ?? null,
      requestorId: ctx.user.id,
      responsibleParty: input.responsibleParty ?? null,
      dueDate: input.dueDate ?? null,
      linkedTaskId: input.linkedTaskId ?? null,
      linkedDeliveryId: input.linkedDeliveryId ?? null,
      createdBy: ctx.user.id,
    })
    .$returningId();

  await saveValues({
    entityType: `app:${app.key}`,
    entityId: id,
    values: input.customFields ?? {},
    base: { title: input.title, priority: input.priority ?? "normal", dueDate: input.dueDate ?? null },
    canFinancial: input.canFinancial,
    today: await orgToday(),
  });
  await d.insert(wfEvents).values({ itemId: id, fromStateId: null, toStateId: start.id, userId: ctx.user.id, comment: "Created" });
  await refreshItem(id);
  await follow("logItem", id, ctx.user.id);
  if (input.assigneeId) await follow("logItem", id, input.assigneeId);
  const label = itemLabel(app, { number });
  await notify(ctx, [input.assigneeId], {
    title: `${label} assigned to you: ${input.title}`,
    link: projectId ? `/jobs/${projectId}/logs/${app.key}/${id}` : `/bids/${id}`,
  });
  await logActivity(ctx, { projectId, entityType: "logItem", entityId: id, action: "create", summary: `created ${label} ${input.title}` });
  await emit(ctx, "logItem", "add", { id, app: app.key, number, label, projectId, title: input.title });
  return { id, number, label };
}

export async function transitionItem(
  ctx: Ctx,
  itemId: number,
  opts: { transitionId?: number; toStateId?: number; comment?: string | null; auto?: boolean }
) {
  const d = await db();
  const [item] = await d.select().from(wfItems).where(eq(wfItems.id, itemId)).limit(1);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  const app = await getApp(item.appId);
  const { states, transitions } = await getAppStructure(app.id);
  let toStateId: number | undefined;
  if (opts.transitionId) {
    const t = transitions.find(x => x.id === opts.transitionId);
    if (!t || t.fromStateId !== item.stateId) throw new TRPCError({ code: "BAD_REQUEST", message: "That action is not available from the current state" });
    if (!t.userAllowed && !opts.auto) throw new TRPCError({ code: "FORBIDDEN", message: "This transition is automatic only" });
    toStateId = t.toStateId;
  } else if (opts.toStateId) {
    const allowed = transitions.some(x => x.fromStateId === item.stateId && x.toStateId === opts.toStateId && (x.userAllowed || opts.auto));
    if (!allowed && !opts.auto) throw new TRPCError({ code: "BAD_REQUEST", message: "That state change is not allowed" });
    toStateId = opts.toStateId;
  }
  if (!toStateId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an action" });
  const to = states.find(s => s.id === toStateId)!;
  const from = states.find(s => s.id === item.stateId);
  const now = new Date();
  await d
    .update(wfItems)
    .set({ stateId: toStateId, stateEnteredAt: now, closedAt: to.category === "end" ? now : null })
    .where(eq(wfItems.id, item.id));
  await d.insert(wfEvents).values({
    itemId: item.id,
    fromStateId: item.stateId,
    toStateId,
    userId: opts.auto ? null : ctx.user.id,
    comment: opts.comment ?? null,
    isAuto: !!opts.auto,
  });
  await refreshItem(item.id);
  const label = itemLabel(app, item);
  await notifyFollowers(
    ctx,
    "logItem",
    item.id,
    {
      title: `${label} → ${to.name}${opts.auto ? " (auto)" : ""}`,
      body: item.title,
      link: item.projectId ? `/jobs/${item.projectId}/logs/${app.key}/${item.id}` : `/bids/${item.id}`,
    },
    [item.assigneeId, item.requestorId]
  );
  await logActivity(ctx, {
    projectId: item.projectId,
    entityType: "logItem",
    entityId: item.id,
    action: "transition",
    summary: `moved ${label} from ${from?.name ?? "?"} to ${to.name}${opts.auto ? " (SLA timeout)" : ""}`,
  });
  await emit(ctx, "logItem", "update", { id: item.id, label, from: from?.name, to: to.name, auto: !!opts.auto });
  return { ok: true, state: to };
}

/**
 * SLA sweeper: refreshes at-risk / delayed status for open items and applies
 * auto-transition policies. Runs on an interval from the server process.
 */
export async function sweepSla() {
  const d = await db();
  const open = await d
    .select({ item: wfItems, category: wfStates.category })
    .from(wfItems)
    .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
    .where(and(isNotNull(wfItems.slaDueAt), sql`${wfStates.category} <> 'end'`));
  const now = new Date();
  const system = { user: { id: 0, name: "SteelBuild Pro TopOut" } };
  let changed = 0;
  const policyCache = new Map<number, (typeof wfSlaPolicies.$inferSelect)[]>();
  for (const { item } of open) {
    const status = slaStatusAt(now, item.slaDueAt, item.slaAtRiskAt);
    if (status === "delayed") {
      if (!policyCache.has(item.appId)) policyCache.set(item.appId, (await getAppStructure(item.appId)).policies);
      const pol = policyCache
        .get(item.appId)!
        .filter(p => p.stateId === item.stateId)
        .sort((a, b) => (a.priority === item.priority ? -1 : b.priority === item.priority ? 1 : 0))[0];
      if (pol?.action === "transition" && pol.toStateId) {
        await transitionItem(system, item.id, { toStateId: pol.toStateId, auto: true, comment: "SLA timeout" });
        changed++;
        continue;
      }
    }
    if (status !== item.slaStatus) {
      await d.update(wfItems).set({ slaStatus: status }).where(eq(wfItems.id, item.id));
      changed++;
      if (status !== "ok") {
        const app = await getApp(item.appId);
        await notifyFollowers(
          system,
          "logItem",
          item.id,
          {
            title: `${itemLabel(app, item)} is ${status === "delayed" ? "past its SLA" : "at risk of missing its SLA"}`,
            body: item.title,
            link: item.projectId ? `/jobs/${item.projectId}/logs/${app.key}/${item.id}` : `/bids/${item.id}`,
          },
          [item.assigneeId]
        );
      }
    }
  }
  return changed;
}

export async function refreshItemsForProject(projectId: number) {
  const d = await db();
  const rows = await d.select({ id: wfItems.id }).from(wfItems).where(eq(wfItems.projectId, projectId));
  for (const r of rows) await refreshItem(r.id);
}

export async function itemsByIds(ids: number[]) {
  if (!ids.length) return [];
  const d = await db();
  return d.select().from(wfItems).where(inArray(wfItems.id, ids));
}
