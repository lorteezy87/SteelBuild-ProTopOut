import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { liftCheck, parseChart, type ChartRow } from "@shared/lift";
import { craneModels, craneSetups, equipment, liftPicks, tasks } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule } from "../security/guard";
import { logActivity } from "../services/events";
import { bad, defined, getProjectOr404, zId, zText } from "./_util";

const lb = z.number().min(0).max(5_000_000).nullable().optional();
const ft = z.number().min(0).max(2000).nullable().optional();

function chartFrom(text: string): ChartRow[] {
  const { rows, errors } = parseChart(text);
  if (errors.length) bad(`Load chart: ${errors.join("; ")}`);
  if (!rows.length) bad("Enter the load chart: one \"radius capacity\" pair per line");
  return rows;
}

async function setupOr404(id: number) {
  const d = await db();
  const [s] = await d.select().from(craneSetups).where(eq(craneSetups.id, id)).limit(1);
  if (!s) bad("Crane setup not found");
  return s;
}
async function pickOr404(id: number) {
  const d = await db();
  const [p] = await d.select().from(liftPicks).where(eq(liftPicks.id, id)).limit(1);
  if (!p) bad("Pick not found");
  return p;
}
async function assertSequenceOnJob(projectId: number, taskId: number | null | undefined) {
  if (!taskId) return;
  const d = await db();
  const [t] = await d.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || t.projectId !== projectId) bad("Sequence must be on this job");
}

const setupFields = z.object({
  craneModelId: zId,
  equipmentId: zId.nullable().optional(),
  name: zText(120).min(1),
  sheetId: zId.nullable().optional(),
  page: z.number().int().min(1).max(500).optional(),
  grid1: zText(16).nullable().optional(),
  grid2: zText(16).nullable().optional(),
  offsetXFt: z.number().min(-2000).max(2000).optional(),
  offsetYFt: z.number().min(-2000).max(2000).optional(),
  boomFt: ft,
  counterweight: zText(120).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const pickFields = z.object({
  setupId: zId,
  sequenceTaskId: zId.nullable().optional(),
  mark: zText(32).min(1),
  description: zText(200).nullable().optional(),
  pieceLb: lb,
  riggingLb: lb,
  radiusFt: ft,
  radiusSource: z.enum(["entered", "model"]).optional(),
  sheetId: zId.nullable().optional(),
  page: z.number().int().min(1).max(500).nullable().optional(),
  pieceKey: zText(64).nullable().optional(),
});

const signoffs = z.partialRecord(z.enum(["supervisor", "operator", "rigger", "signal"]), z.object({ name: zText(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }));

/** Crane library, setups per job and the lift picks they make. */
export const cranesRouter = router({
  models: router({
    list: protectedProcedure.query(async () => {
      const d = await db();
      return d.select().from(craneModels).orderBy(asc(craneModels.name));
    }),
    create: protectedProcedure
      .input(z.object({ name: zText(120).min(1), maxCapacityLb: lb, chartText: z.string().max(20000), chartNote: zText(500).nullable().optional() }))
      .mutation(async ({ input }) => {
        const chart = chartFrom(input.chartText);
        const d = await db();
        const [{ id }] = await d
          .insert(craneModels)
          .values({ name: input.name, maxCapacityLb: input.maxCapacityLb ?? Math.max(...chart.map(r => r.capacityLb)), chart, chartNote: input.chartNote ?? null })
          .$returningId();
        return { id };
      }),
    update: protectedProcedure
      .input(z.object({ id: zId, name: zText(120).min(1).optional(), maxCapacityLb: lb, chartText: z.string().max(20000).optional(), chartNote: zText(500).nullable().optional(), isActive: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const { id, chartText, ...rest } = input;
        const set: Record<string, unknown> = defined(rest);
        if (chartText !== undefined) set.chart = chartFrom(chartText);
        if (!Object.keys(set).length) bad("Nothing to update");
        const d = await db();
        await d.update(craneModels).set(set).where(eq(craneModels.id, id));
        return { ok: true };
      }),
  }),

  setups: router({
    list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.view");
      const d = await db();
      return d.select().from(craneSetups).where(eq(craneSetups.projectId, input.projectId)).orderBy(asc(craneSetups.name));
    }),
    create: protectedProcedure.input(setupFields.extend({ projectId: zId })).mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "task.edit");
      await getProjectOr404(input.projectId);
      const d = await db();
      const [m] = await d.select({ id: craneModels.id }).from(craneModels).where(eq(craneModels.id, input.craneModelId)).limit(1);
      if (!m) bad("Pick a crane from the library");
      if (input.equipmentId) {
        const [e] = await d.select({ id: equipment.id }).from(equipment).where(eq(equipment.id, input.equipmentId)).limit(1);
        if (!e) bad("Equipment not found");
      }
      const [{ id }] = await d.insert(craneSetups).values(input).$returningId();
      await logActivity(ctx, { projectId: input.projectId, entityType: "craneSetup", entityId: id, action: "create", summary: `added crane setup "${input.name}"` });
      return { id };
    }),
    update: protectedProcedure.input(setupFields.partial().extend({ id: zId })).mutation(async ({ ctx, input }) => {
      const s = await setupOr404(input.id);
      await requireJobModule(ctx, s.projectId, "task.edit");
      const { id, ...rest } = input;
      const set = defined(rest);
      if (!Object.keys(set).length) bad("Nothing to update");
      const d = await db();
      await d.update(craneSetups).set(set).where(eq(craneSetups.id, id));
      return { ok: true };
    }),
    remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      const s = await setupOr404(input.id);
      await requireJobModule(ctx, s.projectId, "task.edit");
      const d = await db();
      const [p] = await d.select({ id: liftPicks.id }).from(liftPicks).where(eq(liftPicks.setupId, s.id)).limit(1);
      if (p) bad("Move or delete this setup's picks first");
      await d.delete(craneSetups).where(eq(craneSetups.id, s.id));
      return { ok: true };
    }),
  }),

  picks: router({
    /** Picks with their capacity check against the setup's crane chart (computed here, never stored). */
    list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.view");
      const d = await db();
      const picks = await d.select().from(liftPicks).where(eq(liftPicks.projectId, input.projectId)).orderBy(asc(liftPicks.mark));
      const setups = await d.select().from(craneSetups).where(eq(craneSetups.projectId, input.projectId));
      const modelIds = Array.from(new Set(setups.map(s => s.craneModelId)));
      const models = modelIds.length ? await d.select().from(craneModels).where(inArray(craneModels.id, modelIds)) : [];
      return picks.map(p => {
        const setup = setups.find(s => s.id === p.setupId) ?? null;
        const model = setup ? models.find(m => m.id === setup.craneModelId) ?? null : null;
        return { ...p, check: liftCheck(p, model?.chart ?? []) };
      });
    }),
    create: protectedProcedure.input(pickFields).mutation(async ({ ctx, input }) => {
      const s = await setupOr404(input.setupId);
      await requireJobModule(ctx, s.projectId, "task.edit");
      await assertSequenceOnJob(s.projectId, input.sequenceTaskId);
      const d = await db();
      const [{ id }] = await d
        .insert(liftPicks)
        .values({ ...input, projectId: s.projectId, radiusSource: input.radiusFt != null ? input.radiusSource ?? "entered" : "entered" })
        .$returningId();
      return { id };
    }),
    update: protectedProcedure.input(pickFields.partial().extend({ id: zId, signoffs: signoffs.nullable().optional() })).mutation(async ({ ctx, input }) => {
      const p = await pickOr404(input.id);
      await requireJobModule(ctx, p.projectId, "task.edit");
      if (input.setupId) {
        const s = await setupOr404(input.setupId);
        if (s.projectId !== p.projectId) bad("Setup must be on this job");
      }
      await assertSequenceOnJob(p.projectId, input.sequenceTaskId);
      const { id, ...rest } = input;
      const set: Record<string, unknown> = defined(rest);
      // A radius typed over a model-measured one is the PM's number now.
      if (input.radiusFt !== undefined && input.radiusSource === undefined) set.radiusSource = "entered";
      if (!Object.keys(set).length) bad("Nothing to update");
      const d = await db();
      await d.update(liftPicks).set(set).where(eq(liftPicks.id, id));
      return { ok: true };
    }),
    remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      const p = await pickOr404(input.id);
      await requireJobModule(ctx, p.projectId, "task.edit");
      const d = await db();
      await d.delete(liftPicks).where(eq(liftPicks.id, p.id));
      return { ok: true };
    }),
    /** Add picks from the model's lift list; the client measured the radius only where the sheet page has a scale. */
    bulkFromModel: protectedProcedure
      .input(
        z.object({
          projectId: zId,
          setupId: zId,
          picks: z
            .array(z.object({ mark: zText(32).min(1), pieceLb: lb, sequenceTaskId: zId.nullable(), sheetId: zId, page: z.number().int().min(1).max(500), pieceKey: zText(64), radiusFt: ft }))
            .min(1)
            .max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const s = await setupOr404(input.setupId);
        if (s.projectId !== input.projectId) bad("Setup must be on this job");
        await requireJobModule(ctx, s.projectId, "task.edit");
        for (const p of input.picks) await assertSequenceOnJob(s.projectId, p.sequenceTaskId);
        const d = await db();
        const existing = await d
          .select({ pieceKey: liftPicks.pieceKey })
          .from(liftPicks)
          .where(and(eq(liftPicks.setupId, s.id), inArray(liftPicks.pieceKey, input.picks.map(p => p.pieceKey))));
        const have = new Set(existing.map(e => e.pieceKey));
        const fresh = input.picks.filter(p => !have.has(p.pieceKey));
        if (fresh.length)
          await d.insert(liftPicks).values(
            fresh.map(p => ({
              projectId: s.projectId,
              setupId: s.id,
              sequenceTaskId: p.sequenceTaskId,
              mark: p.mark,
              pieceLb: p.pieceLb ?? null,
              riggingLb: null,
              radiusFt: p.radiusFt ?? null,
              radiusSource: p.radiusFt != null ? "model" : "entered",
              sheetId: p.sheetId,
              page: p.page,
              pieceKey: p.pieceKey,
            })),
          );
        await logActivity(ctx, { projectId: s.projectId, entityType: "craneSetup", entityId: s.id, action: "picks", summary: `added ${fresh.length} pick(s) from the lift list to "${s.name}"` });
        return { added: fresh.length, skipped: input.picks.length - fresh.length };
      }),
  }),
});
