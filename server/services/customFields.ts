import { and, asc, eq, inArray } from "drizzle-orm";
import { evaluateFormula } from "@shared/formula";
import { customFieldDefs, customFieldValues, projects, tasks } from "../../drizzle/schema";
import { db } from "../db";
import { bad } from "../routers/_util";

export type FieldDef = typeof customFieldDefs.$inferSelect;
export type FieldValues = Record<string, unknown>;

export async function getDefs(entityType: string, projectType?: string | null) {
  const d = await db();
  const rows = await d
    .select()
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.entityType, entityType), eq(customFieldDefs.isActive, true)))
    .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.id));
  if (projectType === undefined) return rows;
  return rows.filter(r => !r.projectType || r.projectType === projectType);
}

export async function getValues(entityType: string, entityIds: number[]): Promise<Map<number, FieldValues>> {
  const out = new Map<number, FieldValues>();
  if (!entityIds.length) return out;
  const d = await db();
  const defs = await getDefs(entityType);
  const byId = new Map(defs.map(x => [x.id, x]));
  const rows = await d
    .select()
    .from(customFieldValues)
    .where(and(eq(customFieldValues.entityType, entityType), inArray(customFieldValues.entityId, entityIds)));
  for (const r of rows) {
    const def = byId.get(r.defId);
    if (!def) continue;
    if (!out.has(r.entityId)) out.set(r.entityId, {});
    out.get(r.entityId)![def.key] = r.value;
  }
  return out;
}

export function maskFinancial(defs: FieldDef[], values: FieldValues, canFinancial: boolean): FieldValues {
  if (canFinancial) return values;
  const hidden = new Set(defs.filter(x => x.isFinancial).map(x => x.key));
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(values)) if (!hidden.has(k)) out[k] = v;
  return out;
}

function coerce(def: FieldDef, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  switch (def.fieldType) {
    case "text":
      return String(v).slice(0, 500);
    case "richtext":
      return String(v).slice(0, 20000);
    case "number":
    case "decimal":
    case "currency": {
      const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n)) bad(`${def.label} must be a number`);
      return def.fieldType === "number" ? Math.round(n) : n;
    }
    case "date":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${def.label} must be a date (YYYY-MM-DD)`);
      return v;
    case "boolean":
      return Boolean(v);
    case "select": {
      const ok = (def.options ?? []).some(o => o.value === String(v));
      if (!ok) bad(`${def.label}: "${v}" is not an allowed option`);
      return String(v);
    }
    case "multiselect": {
      const arr = Array.isArray(v) ? v.map(String) : [String(v)];
      const allowed = new Set((def.options ?? []).map(o => o.value));
      const badOne = arr.find(x => !allowed.has(x));
      if (badOne) bad(`${def.label}: "${badOne}" is not an allowed option`);
      return arr;
    }
    case "user": {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) bad(`${def.label} must be a user`);
      return n;
    }
    default:
      return v;
  }
}

/**
 * Validate and save custom field values, then recompute formula fields.
 * `base` exposes the record's standard fields to formulas as `me.<field>`.
 */
export async function saveValues(opts: {
  entityType: string;
  entityId: number;
  values: FieldValues;
  base: Record<string, unknown>;
  canFinancial: boolean;
  today: string;
  enforceRequired?: boolean;
  preserveRollups?: boolean;
}): Promise<FieldValues> {
  const d = await db();
  const projectType = typeof opts.base.projectType === "string" || opts.base.projectType === null
    ? opts.base.projectType : undefined;
  const defs = await getDefs(opts.entityType, projectType);
  const current = (await getValues(opts.entityType, [opts.entityId])).get(opts.entityId) ?? {};
  const merged: FieldValues = { ...current };

  for (const def of defs) {
    if (def.fieldType === "formula") continue;
    if (!(def.key in opts.values)) continue;
    if (def.isFinancial && !opts.canFinancial) continue;
    merged[def.key] = coerce(def, opts.values[def.key]);
  }

  if (opts.enforceRequired) {
    const missing = defs.filter(
      x => x.required && x.fieldType !== "formula" && (merged[x.key] == null || merged[x.key] === "")
    );
    if (missing.length) bad(`Required: ${missing.map(m => m.label).join(", ")}`);
  }

  // Formulas see standard fields + custom values; evaluated in definition order.
  const me: Record<string, unknown> = { ...opts.base, ...merged };
  for (const def of defs) {
    if (def.fieldType !== "formula" || !def.formula) continue;
    if (opts.preserveRollups && def.rollup !== "none") continue;
    try {
      const v = evaluateFormula(def.formula, { me, today: opts.today });
      merged[def.key] = v ?? null;
      me[def.key] = v ?? null;
    } catch {
      merged[def.key] = null;
      me[def.key] = null;
    }
  }

  for (const def of defs) {
    if (!(def.key in merged)) continue;
    const value = merged[def.key];
    const numValue = typeof value === "number" && Number.isFinite(value) ? value : null;
    const textValue =
      value == null ? null : Array.isArray(value) ? value.join(",").slice(0, 500) : String(value).slice(0, 500);
    await d
      .insert(customFieldValues)
      .values({ defId: def.id, entityType: opts.entityType, entityId: opts.entityId, value: value ?? null, numValue, textValue })
      .onDuplicateKeyUpdate({ set: { value: value ?? null, numValue, textValue } });
  }
  return merged;
}

/** Recompute formula fields only (e.g. after standard fields change). */
export async function refreshFormulas(entityType: string, entityId: number, base: Record<string, unknown>, today: string) {
  const defs = await getDefs(entityType);
  if (!defs.some(x => x.fieldType === "formula")) return;
  return saveValues({ entityType, entityId, values: {}, base, canFinancial: true, today, preserveRollups: base.isSummary === true });
}

/** Refresh formulas and numeric rollups in child-before-parent order after recompute. */
export async function rollupTaskFields(projectId: number, today?: string) {
  const d = await db();
  const [project] = await d.select({ projectType: projects.projectType }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const allDefs = await getDefs("task", project?.projectType);
  const defs = allDefs.filter(x => x.rollup !== "none");
  if (!defs.length && (!today || !allDefs.some(x => x.fieldType === "formula"))) return;
  const rows = await d.select().from(tasks).where(eq(tasks.projectId, projectId));
  const byId = new Map(rows.map(r => [r.id, r]));
  const values = await getValues(
    "task",
    rows.map(r => r.id)
  );
  const kids = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parentId != null && byId.has(r.parentId)) {
      if (!kids.has(r.parentId)) kids.set(r.parentId, []);
      kids.get(r.parentId)!.push(r.id);
    }
  }
  const visited = new Set<number>();
  const compute = async (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const ch = kids.get(id) ?? [];
    for (const child of ch) await compute(child);
    if (ch.length) {
      const merged = { ...(values.get(id) ?? {}) };
      for (const def of defs) {
        const nums = ch.map(child => values.get(child)?.[def.key])
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        let out: number | null = null;
        if (nums.length) {
          if (def.rollup === "sum") out = nums.reduce((a, b) => a + b, 0);
          if (def.rollup === "avg") out = nums.reduce((a, b) => a + b, 0) / nums.length;
          if (def.rollup === "min") out = Math.min(...nums);
          if (def.rollup === "max") out = Math.max(...nums);
        }
        merged[def.key] = out;
        await d.insert(customFieldValues)
          .values({ defId: def.id, entityType: "task", entityId: id, value: out, numValue: out, textValue: out == null ? null : String(out) })
          .onDuplicateKeyUpdate({ set: { value: out, numValue: out, textValue: out == null ? null : String(out) } });
      }
      values.set(id, merged);
    }
    if (today) {
      const refreshed = await refreshFormulas("task", id, { ...byId.get(id)!, projectType: project?.projectType, isSummary: ch.length > 0 }, today);
      if (refreshed) values.set(id, refreshed);
    }
  };
  const roots = rows.filter(r => r.parentId == null || !byId.has(r.parentId));
  for (const r of roots) await compute(r.id);
  // Also handle malformed/orphaned cycles without recursive loops.
  for (const r of rows) await compute(r.id);
}

export async function deleteValues(entityType: string, entityIds: number[]) {
  if (!entityIds.length) return;
  const d = await db();
  await d
    .delete(customFieldValues)
    .where(and(eq(customFieldValues.entityType, entityType), inArray(customFieldValues.entityId, entityIds)));
}
