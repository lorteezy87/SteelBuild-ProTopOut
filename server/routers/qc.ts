import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  BOLT_GRADES,
  BOLT_METHODS,
  NDT_METHODS,
  QC_RESULTS,
  SI_RESULTS,
  SI_TYPES,
  WELD_PROCESSES,
  boltPunchTitle,
  canCreatePunch,
  inspectionPunchTitle,
  sequenceQcStatus,
  weldPunchTitle,
} from "@shared/qc";
import { qcBoltLogs, qcWeldLogs, specialInspections, tasks, users, wfApps, wfItems } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasPriv, requireJobModule } from "../security/guard";
import { logActivity } from "../services/events";
import { createItem, getApp, itemLabel } from "../services/wf";
import { bad, defined, zDay, zDayOpt, zId, zText } from "./_util";

const keys = <T extends Record<string, string>>(m: T) => Object.keys(m) as [keyof T & string, ...(keyof T & string)[]];
const affected = (res: unknown) => Number((res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
const optText = (n: number) => zText(n).nullable().optional();

/** A sequence link must be a sequence on the same job. */
async function assertSequence(projectId: number, taskId: number | null | undefined) {
  if (taskId == null) return;
  const d = await db();
  const [t] = await d.select({ projectId: tasks.projectId, kind: tasks.kind }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || t.projectId !== projectId || t.kind !== "sequence") bad("Pick a sequence on this job");
}

const boltFields = {
  taskId: zId.nullable().optional(),
  logDate: zDay,
  location: zText(200).min(1),
  grade: z.enum(keys(BOLT_GRADES)),
  method: z.enum(keys(BOLT_METHODS)),
  lotNumber: optText(64),
  boltCount: z.number().int().min(0).max(100000).nullable().optional(),
  inspectorName: optText(120),
  result: z.enum(keys(QC_RESULTS)).default("pending"),
  notes: z.string().max(5000).nullable().optional(),
};
const weldFields = {
  taskId: zId.nullable().optional(),
  logDate: zDay,
  location: zText(200).min(1),
  welderUserId: zId.nullable().optional(),
  welderName: optText(120),
  wps: optText(64),
  process: z.enum(keys(WELD_PROCESSES)),
  weldSize: optText(32),
  ndt: z.enum(keys(NDT_METHODS)).default("none"),
  inspectorName: optText(120),
  result: z.enum(keys(QC_RESULTS)).default("pending"),
  notes: z.string().max(5000).nullable().optional(),
};
const siFields = {
  taskId: zId.nullable().optional(),
  type: z.enum(keys(SI_TYPES)),
  agency: optText(120),
  requestedDate: zDayOpt,
  scheduledDate: zDayOpt,
  inspectedDate: zDayOpt,
  result: z.enum(keys(SI_RESULTS)).default("requested"),
  reportNumber: optText(64),
  notes: z.string().max(5000).nullable().optional(),
};

type Table = typeof qcBoltLogs | typeof qcWeldLogs | typeof specialInspections;
const TABLES = { bolt: qcBoltLogs, weld: qcWeldLogs, inspection: specialInspections } as const;
type Kind = keyof typeof TABLES;
const KIND_NAME: Record<Kind, string> = { bolt: "Bolting entry", weld: "Weld entry", inspection: "Inspection" };

async function rowOr404(kind: Kind, id: number) {
  const d = await db();
  const t = TABLES[kind] as Table;
  const [row] = await d.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) bad(`${KIND_NAME[kind]} not found`);
  return row as Record<string, unknown> & { id: number; projectId: number; taskId: number | null; result: string; punchItemId: number | null };
}

/** Labels for the punch items linked from QC rows. */
async function punchLabels(ids: (number | null)[]) {
  const real = [...new Set(ids.filter((x): x is number => x != null && x > 0))];
  if (!real.length) return new Map<number, string>();
  const d = await db();
  const rows = await d
    .select({ id: wfItems.id, number: wfItems.number, prefix: wfApps.numberPrefix })
    .from(wfItems)
    .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
    .where(inArray(wfItems.id, real));
  return new Map(rows.map(r => [r.id, itemLabel({ numberPrefix: r.prefix }, r)]));
}

function crud<K extends Kind>(kind: K, fields: Record<string, z.ZodTypeAny>, order: "logDate" | "createdAt") {
  const t = TABLES[kind] as Table;
  const create = z.object({ projectId: zId, ...fields });
  const update = z.object({ id: zId, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) });
  return router({
    list: protectedProcedure.input(z.object({ projectId: zId, taskId: zId.optional() })).query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      const conds = [eq(t.projectId, input.projectId)];
      if (input.taskId) conds.push(eq(t.taskId, input.taskId));
      const col = order === "logDate" && "logDate" in t ? (t as typeof qcBoltLogs).logDate : t.createdAt;
      const rows = (await d.select().from(t).where(and(...conds)).orderBy(desc(col), desc(t.id))) as (Record<string, unknown> & { punchItemId: number | null })[];
      const labels = await punchLabels(rows.map(r => r.punchItemId));
      return rows.map(r => ({ ...r, punchLabel: r.punchItemId ? labels.get(r.punchItemId) ?? null : null }));
    }),
    create: protectedProcedure.input(create).mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const i = input as { projectId: number; taskId?: number | null };
      await assertSequence(i.projectId, i.taskId);
      const d = await db();
      const [{ id }] = await d.insert(t).values(input as never).$returningId();
      return { id };
    }),
    update: protectedProcedure.input(update).mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input as { id: number; taskId?: number | null } & Record<string, unknown>;
      const row = await rowOr404(kind, id);
      await requireJobModule(ctx, row.projectId);
      if (rest.taskId !== undefined) await assertSequence(row.projectId, rest.taskId);
      const d = await db();
      const set = defined(rest);
      if (Object.keys(set).length) await d.update(t).set(set as never).where(eq(t.id, id));
      return { ok: true };
    }),
    remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      const row = await rowOr404(kind, input.id);
      await requireJobModule(ctx, row.projectId);
      const d = await db();
      await d.delete(t).where(eq(t.id, input.id));
      return { ok: true };
    }),
  });
}

export const qcRouter = router({
  bolts: crud("bolt", boltFields, "logDate"),
  welds: crud("weld", weldFields, "logDate"),
  inspections: crud("inspection", siFields, "createdAt"),

  /** QC state per sequence. A sequence with no records says so; it is never shown as clear. */
  summary: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const d = await db();
    const [seqs, b, w, s] = await Promise.all([
      d
        .select({ id: tasks.id, name: tasks.name, isSummary: tasks.isSummary })
        .from(tasks)
        .where(and(eq(tasks.projectId, input.projectId), eq(tasks.kind, "sequence")))
        .orderBy(asc(tasks.sortOrder), asc(tasks.id)),
      d.select({ taskId: qcBoltLogs.taskId, result: qcBoltLogs.result }).from(qcBoltLogs).where(eq(qcBoltLogs.projectId, input.projectId)),
      d.select({ taskId: qcWeldLogs.taskId, result: qcWeldLogs.result }).from(qcWeldLogs).where(eq(qcWeldLogs.projectId, input.projectId)),
      d.select({ taskId: specialInspections.taskId, result: specialInspections.result }).from(specialInspections).where(eq(specialInspections.projectId, input.projectId)),
    ]);
    type R = { taskId: number | null; result: string };
    const pick = <T extends R>(rows: T[], id: number) => rows.filter(r => r.taskId === id) as never[];
    return seqs
      .filter(x => !x.isSummary)
      .map(x => ({ taskId: x.id, name: x.name, status: sequenceQcStatus({ bolt: pick(b, x.id), weld: pick(w, x.id), inspections: pick(s, x.id) }) }));
  }),

  /**
   * Create the punch item for a failed entry, once. The entry is claimed with a conditional update
   * (punchItemId NULL → 0) so two clicks can't both create one; a failed create releases the claim.
   */
  createPunch: protectedProcedure.input(z.object({ kind: z.enum(["bolt", "weld", "inspection"]), id: zId })).mutation(async ({ ctx, input }) => {
    const kind = input.kind as Kind;
    const t = TABLES[kind] as Table;
    const row = await rowOr404(kind, input.id);
    await requireJobModule(ctx, row.projectId);
    const ok = canCreatePunch(row);
    if (!ok.ok) {
      const label = row.punchItemId ? (await punchLabels([row.punchItemId])).get(row.punchItemId) : null;
      bad(label ? `${ok.reason}: ${label}` : ok.reason);
    }
    const d = await db();
    const claimed = affected(await d.update(t).set({ punchItemId: 0 }).where(and(eq(t.id, row.id), isNull(t.punchItemId))));
    if (!claimed) bad("Punch item already created");
    try {
      const app = await getApp("punch");
      const title =
        kind === "bolt"
          ? boltPunchTitle(row as never)
          : kind === "weld"
            ? weldPunchTitle(row as never)
            : inspectionPunchTitle(row as never);
      const notes = typeof row.notes === "string" && row.notes.trim() ? row.notes : null;
      const created = await createItem(ctx, {
        appId: app.id,
        projectId: row.projectId,
        title: title.slice(0, 255),
        description: notes,
        linkedTaskId: row.taskId,
        customFields: { ...(typeof row.location === "string" ? { location: row.location } : {}), punch_scope: "erector" },
        canFinancial: await hasPriv(ctx, "project.financials", row.projectId),
      });
      await d.update(t).set({ punchItemId: created.id }).where(eq(t.id, row.id));
      await logActivity(ctx, { projectId: row.projectId, entityType: "logItem", entityId: created.id, action: "qc", summary: `created ${created.label} from a failed QC entry` });
      return { itemId: created.id, label: created.label };
    } catch (e) {
      await d.update(t).set({ punchItemId: null }).where(and(eq(t.id, row.id), eq(t.punchItemId, 0)));
      throw e;
    }
  }),

  /** Everything the printable QC log needs for one job (optionally one sequence). */
  print: protectedProcedure.input(z.object({ projectId: zId, taskId: zId.optional() })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const d = await db();
    const by = <T extends Table>(t: T) => and(eq(t.projectId, input.projectId), input.taskId ? eq(t.taskId, input.taskId) : undefined);
    const [bolts, welds, inspections, seqs, crew] = await Promise.all([
      d.select().from(qcBoltLogs).where(by(qcBoltLogs)).orderBy(asc(qcBoltLogs.logDate), asc(qcBoltLogs.id)),
      d.select().from(qcWeldLogs).where(by(qcWeldLogs)).orderBy(asc(qcWeldLogs.logDate), asc(qcWeldLogs.id)),
      d.select().from(specialInspections).where(by(specialInspections)).orderBy(asc(specialInspections.id)),
      d.select({ id: tasks.id, name: tasks.name }).from(tasks).where(and(eq(tasks.projectId, input.projectId), eq(tasks.kind, "sequence"))),
      d.select({ id: users.id, name: users.name }).from(users),
    ]);
    const labels = await punchLabels([...bolts, ...welds, ...inspections].map(r => r.punchItemId));
    const seqName = (id: number | null) => (id ? seqs.find(s => s.id === id)?.name ?? null : null);
    const withPunch = <T extends { punchItemId: number | null; taskId: number | null }>(r: T) => ({ ...r, sequence: seqName(r.taskId), punchLabel: r.punchItemId ? labels.get(r.punchItemId) ?? null : null });
    return {
      sequence: input.taskId ? seqName(input.taskId) : null,
      bolts: bolts.map(withPunch),
      welds: welds.map(r => ({ ...withPunch(r), welder: r.welderName ?? crew.find(c => c.id === r.welderUserId)?.name ?? null })),
      inspections: inspections.map(withPunch),
    };
  }),
});
