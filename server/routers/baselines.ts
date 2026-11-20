import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { baselines, projects, tasks } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasJobModuleAccess, hasPriv, requireJobModule, sec } from "../security/guard";
import { getCalendar } from "../services/calendars";
import { logActivity } from "../services/events";
import { recomputeProject } from "../services/recompute";
import { bad, getProjectOr404, zId, zText } from "./_util";

export const baselinesRouter = router({
  list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const d = await db();
    const p = await getProjectOr404(input.projectId);
    const fin = await hasPriv(ctx, "project.financials", input.projectId);
    const rows = await d.select().from(baselines).where(eq(baselines.projectId, input.projectId)).orderBy(desc(baselines.createdAt));
    return {
      activeBaselineId: p.activeBaselineId,
      baselines: rows.map(({ taskData, ...b }) => ({ ...b, budget: fin ? b.budget : null, taskCount: taskData.length })),
    };
  }),

  create: protectedProcedure
    .input(z.object({ projectId: zId, name: zText(128).min(1), setActive: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "baseline.manage");
      const d = await db();
      await recomputeProject(input.projectId);
      const p = await getProjectOr404(input.projectId);
      const rows = await d.select().from(tasks).where(eq(tasks.projectId, input.projectId));
      const [{ id }] = await d
        .insert(baselines)
        .values({
          projectId: input.projectId,
          name: input.name,
          plannedStart: p.plannedStart,
          plannedFinish: p.plannedFinish,
          budget: p.budget,
          taskData: rows.map(r => ({
            taskId: r.id,
            name: r.name,
            kind: r.kind,
            isSummary: r.isSummary,
            startDate: r.startDate,
            finishDate: r.finishDate,
            durationDays: r.durationDays,
            effortHours: r.effortHours,
            budgetCost: r.budgetCost,
            plannedTons: r.plannedTons,
          })),
          createdBy: ctx.user.id,
        })
        .$returningId();
      if (input.setActive) await d.update(projects).set({ activeBaselineId: id }).where(eq(projects.id, input.projectId));
      await recomputeProject(input.projectId);
      await logActivity(ctx, { projectId: input.projectId, entityType: "baseline", entityId: id, action: "create", summary: `saved baseline "${input.name}"` });
      return { id };
    }),

  setActive: protectedProcedure
    .input(z.object({ projectId: zId, baselineId: zId.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "baseline.manage");
      const d = await db();
      if (input.baselineId) {
        const [b] = await d.select({ projectId: baselines.projectId }).from(baselines).where(eq(baselines.id, input.baselineId)).limit(1);
        if (!b || b.projectId !== input.projectId) bad("Baseline not found on this job");
      }
      await d.update(projects).set({ activeBaselineId: input.baselineId }).where(eq(projects.id, input.projectId));
      await recomputeProject(input.projectId);
      return { ok: true };
    }),

  remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    if (!hasJobModuleAccess(await sec(ctx))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Your access type only includes Logs and Timesheets" });
    }
    const d = await db();
    const [b] = await d.select().from(baselines).where(eq(baselines.id, input.id)).limit(1);
    if (!b) return { ok: true };
    await requireJobModule(ctx, b.projectId, "baseline.manage");
    const p = await getProjectOr404(b.projectId);
    if (p.activeBaselineId === b.id) await d.update(projects).set({ activeBaselineId: null }).where(eq(projects.id, p.id));
    await d.delete(baselines).where(eq(baselines.id, input.id));
    await recomputeProject(p.id);
    return { ok: true };
  }),

  /** Variance of the current schedule against a baseline (work days; + = later). */
  compare: protectedProcedure
    .input(z.object({ projectId: zId, baselineId: zId }))
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      const p = await getProjectOr404(input.projectId);
      const [b] = await d.select().from(baselines).where(eq(baselines.id, input.baselineId)).limit(1);
      if (!b || b.projectId !== p.id) bad("Baseline not found on this job");
      const cal = await getCalendar(p.calendarId);
      const fin = await hasPriv(ctx, "project.financials", p.id);
      const rows = await d.select().from(tasks).where(eq(tasks.projectId, p.id));
      const byId = new Map(rows.map(r => [r.id, r]));
      const variance = (a: string | null, bDate: string | null) => {
        if (!a || !bDate) return null;
        if (a === bDate) return 0;
        return a > bDate ? cal.workDaysBetween(bDate, a) - 1 : -(cal.workDaysBetween(a, bDate) - 1);
      };
      const items = b.taskData.map(bt => {
        const cur = byId.get(bt.taskId);
        return {
          taskId: bt.taskId,
          name: cur?.name ?? bt.name,
          wbs: cur?.wbs ?? null,
          isSummary: cur?.isSummary ?? false,
          removed: !cur,
          baselineStart: bt.startDate,
          baselineFinish: bt.finishDate,
          currentStart: cur?.startDate ?? null,
          currentFinish: cur?.finishDate ?? null,
          startVariance: variance(cur?.startDate ?? null, bt.startDate),
          finishVariance: variance(cur?.finishDate ?? null, bt.finishDate),
          baselineDuration: bt.durationDays,
          currentDuration: cur?.durationDays ?? null,
          baselineCost: fin ? bt.budgetCost : null,
          currentCost: fin ? cur?.budgetCost ?? null : null,
        };
      });
      const added = rows
        .filter(r => !b.taskData.some(t => t.taskId === r.id))
        .map(r => ({ taskId: r.id, name: r.name, wbs: r.wbs, currentStart: r.startDate, currentFinish: r.finishDate }));
      return {
        baseline: { id: b.id, name: b.name, plannedStart: b.plannedStart, plannedFinish: b.plannedFinish, budget: fin ? b.budget : null, createdAt: b.createdAt },
        project: { plannedStart: p.plannedStart, plannedFinish: p.plannedFinish, budget: fin ? p.budget : null },
        finishVariance: variance(p.plannedFinish, b.plannedFinish),
        items: items.sort((x, y) => (x.wbs ?? "").localeCompare(y.wbs ?? "", undefined, { numeric: true })),
        added,
      };
    }),
});
