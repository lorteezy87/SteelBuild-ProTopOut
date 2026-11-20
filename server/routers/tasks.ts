import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { CONSTRAINT_TYPES, DEP_TYPES, PRIORITIES, TASK_KINDS, TASK_STATUSES } from "@shared/domain";
import {
  baselines,
  calendarExceptions,
  calendars,
  checklistItems,
  comments,
  equipment,
  jobRoles,
  projects,
  taskAssignments,
  taskDependencies,
  tasks,
  drawingSheets,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { findCycle } from "../engine/scheduler";
import { effectivePrivileges } from "../security/access";
import { financialChecker, hasJobModuleAccess, hasPriv, requireJobModule, requirePriv, resetSec, sec, visibleProjects } from "../security/guard";
import { getCalendar, orgToday } from "../services/calendars";
import { deleteValues, getDefs, getValues, maskFinancial, saveValues } from "../services/customFields";
import { emit, follow, logActivity, notify } from "../services/events";
import { recomputeWithDownstream } from "../services/recompute";
import { leafIds, mergeAssignments, planMove, planShift, resourceKey } from "@shared/taskOps";
import { bad, defined, getProjectOr404, getTaskOr404, zDay, zDayOpt, zId, zText } from "./_util";

const enumOf = <T extends Record<string, string>>(o: T) => z.enum(Object.keys(o) as [string, ...string[]]);

const editFields = {
  name: zText(255).min(1),
  description: z.string().max(20000).nullable(),
  kind: enumOf(TASK_KINDS),
  priority: enumOf(PRIORITIES),
  schedulingMode: z.enum(["auto", "manual"]),
  constraintType: enumOf(CONSTRAINT_TYPES),
  constraintDate: zDay.nullable(),
  startDate: zDay.nullable(),
  finishDate: zDay.nullable(),
  durationDays: z.number().min(0).max(2000),
  effortHours: z.number().min(0).max(100000),
  budgetCost: z.number().min(0),
  location: zText(128).nullable(),
  plannedTons: z.number().min(0),
  plannedPieces: z.number().int().min(0),
};
const progressFields = {
  status: enumOf(TASK_STATUSES),
  percentComplete: z.number().min(0).max(100),
  actualStart: zDay.nullable(),
  actualFinish: zDay.nullable(),
  erectedTons: z.number().min(0),
  erectedPieces: z.number().int().min(0),
};

const updateInput = z
  .object({ id: zId, customFields: z.record(z.string(), z.unknown()).optional() })
  .extend(Object.fromEntries(Object.entries({ ...editFields, ...progressFields }).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof editFields | keyof typeof progressFields]: z.ZodOptional<
      (typeof editFields & typeof progressFields)[K]
    >;
  });

async function siblingsOf(projectId: number, parentId: number | null) {
  const d = await db();
  const all = await d
    .select({ id: tasks.id, parentId: tasks.parentId, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
  return all.filter(t => (t.parentId ?? null) === parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

async function renumber(ids: number[]) {
  const d = await db();
  for (let i = 0; i < ids.length; i++) await d.update(tasks).set({ sortOrder: i * 10 }).where(eq(tasks.id, ids[i]));
}

async function subtreeIds(projectId: number, rootId: number) {
  const d = await db();
  const all = await d.select({ id: tasks.id, parentId: tasks.parentId }).from(tasks).where(eq(tasks.projectId, projectId));
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const t of all) if (t.parentId === out[i]) out.push(t.id);
  return out;
}

async function isSummaryTask(taskId: number) {
  const d = await db();
  const kids = await d.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, taskId)).limit(1);
  return kids.length > 0;
}

/** Couple status / % complete / actual dates the way field crews expect. */
function applyProgressRules(
  before: typeof tasks.$inferSelect,
  set: Record<string, unknown>,
  today: string
) {
  if (set.status === "done" && set.percentComplete === undefined) set.percentComplete = 100;
  if (typeof set.percentComplete === "number") {
    const pct = set.percentComplete;
    if (pct >= 100) {
      if (set.status === undefined) set.status = "done";
      if (!before.actualFinish && set.actualFinish === undefined) set.actualFinish = today;
    } else if (pct > 0 && (set.status ?? before.status) === "not_started") set.status = "in_progress";
    if (pct > 0 && !before.actualStart && set.actualStart === undefined) {
      set.actualStart = before.startDate && before.startDate < today ? before.startDate : today;
    }
    if (pct < 100 && before.actualFinish && set.actualFinish === undefined) set.actualFinish = null;
  }
  if (set.status === "in_progress" && !before.actualStart && set.actualStart === undefined) set.actualStart = today;
}

export const tasksRouter = router({
  list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    const s = await requireJobModule(ctx, input.projectId);
    const d = await db();
    const p = await getProjectOr404(input.projectId);
    const rows = await d.select().from(tasks).where(eq(tasks.projectId, input.projectId)).orderBy(asc(tasks.sortOrder), asc(tasks.id));
    const ids = rows.map(r => r.id);
    const deps = ids.length
      ? await d
          .select()
          .from(taskDependencies)
          .where(or(inArray(taskDependencies.successorId, ids), inArray(taskDependencies.predecessorId, ids)))
      : [];
    const assigns = ids.length ? await d.select().from(taskAssignments).where(inArray(taskAssignments.taskId, ids)) : [];
    const checklist = ids.length ? await d.select().from(checklistItems).where(inArray(checklistItems.taskId, ids)) : [];
    const externalIds = deps
      .flatMap(x => [x.predecessorId, x.successorId])
      .filter(x => !ids.includes(x));
    const external = externalIds.length
      ? await d
          .select({ id: tasks.id, name: tasks.name, projectId: tasks.projectId, startDate: tasks.startDate, finishDate: tasks.finishDate, projectName: projects.name })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(inArray(tasks.id, externalIds))
      : [];
    let baseline: { taskId: number; startDate: string | null; finishDate: string | null }[] = [];
    if (p.activeBaselineId) {
      const [bl] = await d.select().from(baselines).where(eq(baselines.id, p.activeBaselineId)).limit(1);
      baseline = bl?.taskData.map(t => ({ taskId: t.taskId, startDate: t.startDate, finishDate: t.finishDate })) ?? [];
    }
    const fin = await hasPriv(ctx, "project.financials", input.projectId);
    const defs = await getDefs("task", p.projectType);
    const values = await getValues("task", ids);
    const cal = await getCalendar(p.calendarId);
    const calRows = await d.select().from(calendars);
    const calRow = calRows.find(c => c.id === p.calendarId) ?? calRows.find(c => c.isDefault) ?? calRows[0];
    const holidays = calRow
      ? await d.select().from(calendarExceptions).where(eq(calendarExceptions.calendarId, calRow.id))
      : [];
    return {
      tasks: rows.map(r => ({
        ...r,
        budgetCost: fin ? r.budgetCost : null,
        assignments: assigns.filter(a => a.taskId === r.id),
        checklistTotal: checklist.filter(c => c.taskId === r.id).length,
        checklistDone: checklist.filter(c => c.taskId === r.id && c.done).length,
        customFields: maskFinancial(defs, values.get(r.id) ?? {}, fin),
      })),
      dependencies: deps,
      external: external.map(t => {
        if (hasJobModuleAccess(s) && effectivePrivileges(s, t.projectId).has("project.view")) {
          return { ...t, external: true, restricted: false };
        }
        // Keep the endpoint id for scheduling arrows, but disclose no remote job details.
        return { id: t.id, external: true, restricted: true, name: null, projectId: null, startDate: null, finishDate: null, projectName: null };
      }),
      baseline,
      customFieldDefs: fin ? defs : defs.filter(x => !x.isFinancial),
      calendar: {
        hoursPerDay: cal.hoursPerDay,
        holidays: holidays.filter(h => !h.isWorking).map(h => ({ date: h.date, name: h.name })),
        /** Exceptions that make an otherwise non-working day (e.g. a Saturday) a work day. */
        workingDates: holidays.filter(h => h.isWorking).map(h => h.date),
        workDays: calRow?.workDays ?? [1, 2, 3, 4, 5],
      },
    };
  }),

  get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    const t = await getTaskOr404(input.id);
    const s = await requireJobModule(ctx, t.projectId);
    const d = await db();
    const preds = await d
      .select({ dep: taskDependencies, name: tasks.name, wbs: tasks.wbs, projectId: tasks.projectId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.predecessorId))
      .where(eq(taskDependencies.successorId, t.id));
    const succs = await d
      .select({ dep: taskDependencies, name: tasks.name, wbs: tasks.wbs, projectId: tasks.projectId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.successorId))
      .where(eq(taskDependencies.predecessorId, t.id));
    const visibleEndpoint = (endpoint: typeof preds[number]) => {
      const external = endpoint.projectId !== t.projectId;
      if (!external || (hasJobModuleAccess(s) && effectivePrivileges(s, endpoint.projectId).has("project.view"))) {
        return { ...endpoint, external, restricted: false };
      }
      return { dep: endpoint.dep, external: true, restricted: true, name: null, wbs: null, projectId: null };
    };
    const assigns = await d.select().from(taskAssignments).where(eq(taskAssignments.taskId, t.id));
    const checklist = await d.select().from(checklistItems).where(eq(checklistItems.taskId, t.id)).orderBy(asc(checklistItems.sortOrder));
    const fin = await hasPriv(ctx, "project.financials", t.projectId);
    const p = await getProjectOr404(t.projectId);
    const defs = await getDefs("task", p.projectType);
    const cf = (await getValues("task", [t.id])).get(t.id) ?? {};
    const privs = Array.from(effectivePrivileges(await sec(ctx), t.projectId));
    const [cc] = await d
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.entityType, "task"), eq(comments.entityId, t.id)))
      .limit(1);
    return {
      task: { ...t, budgetCost: fin ? t.budgetCost : null },
      isSummary: await isSummaryTask(t.id),
      predecessors: preds.map(visibleEndpoint),
      successors: succs.map(visibleEndpoint),
      assignments: assigns,
      checklist,
      customFieldDefs: fin ? defs : defs.filter(x => !x.isFinancial),
      customFields: maskFinancial(defs, cf, fin),
      privileges: privs,
      hasComments: !!cc,
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        parentId: zId.nullable().optional(),
        afterId: zId.nullable().optional(),
        name: zText(255).min(1),
        kind: enumOf(TASK_KINDS).default("task"),
        durationDays: z.number().min(0).max(2000).optional(),
        startDate: zDayOpt,
        plannedTons: z.number().min(0).optional(),
        plannedPieces: z.number().int().min(0).optional(),
        location: zText(128).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "task.edit");
      const d = await db();
      const parentId = input.parentId ?? null;
      if (parentId) {
        const parent = await getTaskOr404(parentId);
        if (parent.projectId !== input.projectId) bad("Parent task is in a different job");
        // A task that becomes a summary cannot keep dependencies.
        await d.delete(taskDependencies).where(or(eq(taskDependencies.successorId, parentId), eq(taskDependencies.predecessorId, parentId)));
      }
      const sibs = await siblingsOf(input.projectId, parentId);
      const [{ id }] = await d
        .insert(tasks)
        .values({
          projectId: input.projectId,
          parentId,
          sortOrder: 0,
          name: input.name,
          kind: input.kind,
          durationDays: input.kind === "milestone" ? 0 : input.durationDays ?? (input.kind === "sequence" ? 5 : 1),
          startDate: input.startDate ?? null,
          constraintType: input.startDate ? "snet" : "asap",
          constraintDate: input.startDate ?? null,
          plannedTons: input.plannedTons ?? 0,
          plannedPieces: input.plannedPieces ?? 0,
          location: input.location ?? null,
          createdBy: ctx.user.id,
        })
        .$returningId();
      const order = sibs.map(s => s.id);
      const at = input.afterId ? order.indexOf(input.afterId) : -1;
      if (at >= 0) order.splice(at + 1, 0, id);
      else order.push(id);
      await renumber(order);
      await recomputeWithDownstream(input.projectId);
      await logActivity(ctx, { projectId: input.projectId, entityType: "task", entityId: id, action: "create", summary: `added ${TASK_KINDS[input.kind as keyof typeof TASK_KINDS].toLowerCase()} "${input.name}"` });
      await emit(ctx, "task", "add", { id, projectId: input.projectId, name: input.name });
      return { id };
    }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const before = await getTaskOr404(input.id);
    const { id, customFields, ...rest } = input;
    const set: Record<string, unknown> = defined(rest);
    const editKeys = Object.keys(set).filter(k => k in editFields);
    const progKeys = Object.keys(set).filter(k => k in progressFields);
    const hasCustomChanges = !!customFields && Object.keys(customFields).length > 0;
    if (!editKeys.length && !progKeys.length && !hasCustomChanges) bad("Nothing to update");
    if (editKeys.length || hasCustomChanges) await requireJobModule(ctx, before.projectId, "task.edit");
    else {
      const privilege = await hasPriv(ctx, "task.edit", before.projectId) ? "task.edit" : "task.progress";
      await requireJobModule(ctx, before.projectId, privilege);
    }
    if ("budgetCost" in set) await requirePriv(ctx, "project.financials", before.projectId);
    const today = await orgToday();
    if (set.kind === "milestone") set.durationDays = 0;
    if (set.constraintType && set.constraintType !== "asap" && !(set.constraintDate ?? before.constraintDate)) {
      bad("Pick a constraint date for this constraint type");
    }
    if (set.constraintType === "asap") set.constraintDate = null;
    if (set.startDate && set.finishDate && String(set.finishDate) < String(set.startDate)) bad("Finish is before start");
    applyProgressRules(before, set, today);
    if (set.erectedTons !== undefined && before.kind === "sequence" && before.plannedTons > 0 && set.percentComplete === undefined) {
      const pct = Math.min(100, (Number(set.erectedTons) / before.plannedTons) * 100);
      set.percentComplete = Math.round(pct * 10) / 10;
      applyProgressRules(before, set, today);
    }
    const d = await db();
    if (Object.keys(set).length) await d.update(tasks).set(set).where(eq(tasks.id, id));
    if (customFields) {
      await saveValues({
        entityType: "task",
        entityId: id,
        values: customFields,
        base: { ...before, ...set },
        canFinancial: await hasPriv(ctx, "project.financials", before.projectId),
        today,
      });
    }
    await recomputeWithDownstream(before.projectId);
    if (set.status && set.status !== before.status) {
      await logActivity(ctx, { projectId: before.projectId, entityType: "task", entityId: id, action: "status", summary: `moved "${before.name}" to ${TASK_STATUSES[set.status as keyof typeof TASK_STATUSES]}` });
    } else if (set.percentComplete !== undefined && set.percentComplete !== before.percentComplete) {
      await logActivity(ctx, { projectId: before.projectId, entityType: "task", entityId: id, action: "progress", summary: `updated "${before.name}" to ${Math.round(Number(set.percentComplete))}%` });
    }
    await emit(ctx, "task", "update", { id, projectId: before.projectId, changed: Object.keys(set) });
    return { ok: true };
  }),

  /** Gantt drag: move an auto task (via SNET constraint) or shift a manual task. */
  moveDates: protectedProcedure
    .input(z.object({ id: zId, startDate: zDay, durationDays: z.number().min(0).max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const t = await getTaskOr404(input.id);
      await requireJobModule(ctx, t.projectId, "task.edit");
      if (await isSummaryTask(t.id)) bad("Summary tasks move with their children");
      const p = await getProjectOr404(t.projectId);
      const cal = await getCalendar(p.calendarId);
      const start = cal.nextWorkDay(input.startDate);
      const dur = input.durationDays ?? t.durationDays;
      const d = await db();
      if (t.schedulingMode === "manual") {
        const finish = t.kind === "milestone" ? start : cal.addWorkDays(start, Math.max(1, Math.ceil(dur)) - 1);
        await d.update(tasks).set({ startDate: start, finishDate: finish, durationDays: t.kind === "milestone" ? 0 : dur }).where(eq(tasks.id, t.id));
      } else {
        await d
          .update(tasks)
          .set({ constraintType: "snet", constraintDate: start, durationDays: t.kind === "milestone" ? 0 : dur })
          .where(eq(tasks.id, t.id));
      }
      await recomputeWithDownstream(t.projectId);
      return { ok: true };
    }),

  delete: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const t = await getTaskOr404(input.id);
    await requireJobModule(ctx, t.projectId, "task.edit");
    const ids = await subtreeIds(t.projectId, t.id);
    const d = await db();
    await d.delete(taskDependencies).where(or(inArray(taskDependencies.successorId, ids), inArray(taskDependencies.predecessorId, ids)));
    await d.delete(taskAssignments).where(inArray(taskAssignments.taskId, ids));
    await d.delete(checklistItems).where(inArray(checklistItems.taskId, ids));
    await deleteValues("task", ids);
    await d.delete(tasks).where(inArray(tasks.id, ids));
    await d.update(drawingSheets).set({ sequenceTaskId: null }).where(inArray(drawingSheets.sequenceTaskId, ids));
    resetSec(ctx);
    await recomputeWithDownstream(t.projectId);
    await logActivity(ctx, { projectId: t.projectId, entityType: "task", entityId: t.id, action: "delete", summary: `deleted "${t.name}"${ids.length > 1 ? ` and ${ids.length - 1} subtasks` : ""}` });
    await emit(ctx, "task", "delete", { id: t.id, projectId: t.projectId });
    return { ok: true, deleted: ids.length };
  }),

  /** Reorder / reparent. position = index among the new siblings. */
  move: protectedProcedure
    .input(z.object({ id: zId, parentId: zId.nullable(), position: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const t = await getTaskOr404(input.id);
      await requireJobModule(ctx, t.projectId, "task.edit");
      if (input.parentId) {
        const sub = await subtreeIds(t.projectId, t.id);
        if (sub.includes(input.parentId)) bad("A task cannot be moved under itself");
        const parent = await getTaskOr404(input.parentId);
        if (parent.projectId !== t.projectId) bad("Parent is in a different job");
      }
      const d = await db();
      if (input.parentId) {
        await d.delete(taskDependencies).where(or(eq(taskDependencies.successorId, input.parentId), eq(taskDependencies.predecessorId, input.parentId)));
      }
      await d.update(tasks).set({ parentId: input.parentId }).where(eq(tasks.id, t.id));
      const sibs = (await siblingsOf(t.projectId, input.parentId)).map(s => s.id).filter(x => x !== t.id);
      sibs.splice(Math.min(input.position, sibs.length), 0, t.id);
      await renumber(sibs);
      await recomputeWithDownstream(t.projectId);
      return { ok: true };
    }),

  indent: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const t = await getTaskOr404(input.id);
    await requireJobModule(ctx, t.projectId, "task.edit");
    const sibs = await siblingsOf(t.projectId, t.parentId ?? null);
    const idx = sibs.findIndex(s => s.id === t.id);
    if (idx <= 0) bad("Nothing above to indent under");
    const newParent = sibs[idx - 1].id;
    const d = await db();
    await d.delete(taskDependencies).where(or(eq(taskDependencies.successorId, newParent), eq(taskDependencies.predecessorId, newParent)));
    const kids = (await siblingsOf(t.projectId, newParent)).map(s => s.id);
    await d.update(tasks).set({ parentId: newParent }).where(eq(tasks.id, t.id));
    await renumber([...kids, t.id]);
    await recomputeWithDownstream(t.projectId);
    return { ok: true };
  }),

  outdent: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const t = await getTaskOr404(input.id);
    await requireJobModule(ctx, t.projectId, "task.edit");
    if (!t.parentId) bad("Already at the top level");
    const parent = await getTaskOr404(t.parentId);
    const d = await db();
    await d.update(tasks).set({ parentId: parent.parentId ?? null }).where(eq(tasks.id, t.id));
    const sibs = (await siblingsOf(t.projectId, parent.parentId ?? null)).map(s => s.id).filter(x => x !== t.id);
    sibs.splice(sibs.indexOf(parent.id) + 1, 0, t.id);
    await renumber(sibs);
    await recomputeWithDownstream(t.projectId);
    return { ok: true };
  }),

  /* ---------------- Bulk move / shift / assign ---------------- */

  /**
   * Drag-and-drop and "Move to…": move one or more rows (with their subtrees)
   * under `parentId`, placed before `beforeId` (null = end). Relative order kept.
   */
  bulkMove: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        ids: z.array(zId).min(1).max(500),
        parentId: zId.nullable(),
        beforeId: zId.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "task.edit");
      const d = await db();
      const nodes = await d
        .select({ id: tasks.id, parentId: tasks.parentId, sortOrder: tasks.sortOrder, name: tasks.name })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));
      const known = new Set(nodes.map(n => n.id));
      if (input.ids.some(id => !known.has(id))) bad("Some of those tasks are not in this job");
      if (input.parentId != null && !known.has(input.parentId)) bad("Target sequence is not in this job");
      const plan = planMove(nodes, input.ids, input.parentId, input.beforeId ?? null);
      if (!plan.ok) bad(plan.error);
      let removedLinks = 0;
      await d.transaction(async tx => {
        if (plan.parentId != null) {
          // A task that becomes a summary cannot keep dependencies (same rule as create/move/indent).
          const links = await tx
            .select({ id: taskDependencies.id })
            .from(taskDependencies)
            .where(or(eq(taskDependencies.successorId, plan.parentId), eq(taskDependencies.predecessorId, plan.parentId)));
          removedLinks = links.length;
          if (links.length) await tx.delete(taskDependencies).where(inArray(taskDependencies.id, links.map(l => l.id)));
        }
        await tx.update(tasks).set({ parentId: plan.parentId }).where(inArray(tasks.id, plan.moved));
        for (let i = 0; i < plan.order.length; i++) {
          await tx.update(tasks).set({ sortOrder: i * 10 }).where(eq(tasks.id, plan.order[i]));
        }
      });
      await recomputeWithDownstream(input.projectId);
      const byId = new Map(nodes.map(n => [n.id, n]));
      const first = byId.get(plan.moved[0])!;
      const target = plan.parentId != null ? byId.get(plan.parentId) : null;
      const what = plan.moved.length === 1 ? `"${first.name}"` : `${plan.moved.length} tasks`;
      await logActivity(ctx, {
        projectId: input.projectId,
        entityType: "task",
        entityId: first.id,
        action: "move",
        summary: `moved ${what} ${target ? `into "${target.name}"` : "to the top level"}`,
      });
      for (const id of plan.moved) await emit(ctx, "task", "update", { id, projectId: input.projectId, changed: ["parentId", "sortOrder"] });
      return { ok: true, moved: plan.moved.length, removedLinks, parentId: plan.parentId };
    }),

  /**
   * Shift detail tasks (summaries expand to their detail tasks) by N work days.
   * Started / finished tasks keep their actual dates and are skipped.
   */
  shiftDates: protectedProcedure
    .input(z.object({ projectId: zId, ids: z.array(zId).min(1).max(500), workDays: z.number().int().min(-260).max(260) }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "task.edit");
      if (!input.workDays) bad("Enter a non-zero number of work days");
      const p = await getProjectOr404(input.projectId);
      const d = await db();
      const rows = await d.select().from(tasks).where(eq(tasks.projectId, input.projectId));
      const known = new Set(rows.map(r => r.id));
      if (input.ids.some(id => !known.has(id))) bad("Some of those tasks are not in this job");
      const byId = new Map(rows.map(r => [r.id, r]));
      const leaves = leafIds(rows, input.ids).map(id => byId.get(id)!);
      const started = leaves.filter(t => !!t.actualStart || t.status === "done" || t.percentComplete >= 100);
      const movable = leaves.filter(t => !started.includes(t));
      if (!movable.length) bad("Every selected task has already started; actual dates are not shifted");
      const ids = movable.map(t => t.id);
      const deps = await d
        .select({ predecessorId: taskDependencies.predecessorId, successorId: taskDependencies.successorId })
        .from(taskDependencies)
        .where(inArray(taskDependencies.successorId, ids));
      const cal = await getCalendar(p.calendarId);
      const updates = planShift(movable, deps, input.workDays, (date, n) => cal.addWorkDays(date, n));
      await d.transaction(async tx => {
        for (const u of updates) if (Object.keys(u.set).length) await tx.update(tasks).set(u.set).where(eq(tasks.id, u.id));
      });
      await recomputeWithDownstream(input.projectId);
      const after = new Map(
        (await d.select({ id: tasks.id, startDate: tasks.startDate }).from(tasks).where(inArray(tasks.id, ids))).map(r => [r.id, r.startDate])
      );
      const held = updates.filter(u => u.expectedStart && after.get(u.id) !== u.expectedStart);
      const n = input.workDays;
      await logActivity(ctx, {
        projectId: input.projectId,
        entityType: "task",
        entityId: ids[0],
        action: "shift",
        summary: `shifted ${updates.length === 1 ? `"${byId.get(updates[0].id)?.name}"` : `${updates.length} tasks`} ${n > 0 ? "+" : ""}${n} work day${Math.abs(n) === 1 ? "" : "s"}`,
      });
      for (const u of updates) if (Object.keys(u.set).length) await emit(ctx, "task", "update", { id: u.id, projectId: input.projectId, changed: Object.keys(u.set) });
      return {
        ok: true,
        shifted: updates.length,
        skippedStarted: started.length,
        held: held.length,
        heldNames: held.slice(0, 3).map(u => byId.get(u.id)?.name ?? `Task ${u.id}`),
      };
    }),

  /**
   * Add / remove / replace people, crew roles and equipment on many tasks.
   * Summary rows expand to their detail tasks (workload counts detail tasks only).
   */
  bulkAssign: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        taskIds: z.array(zId).min(1).max(500),
        mode: z.enum(["add", "remove", "replace"]),
        resources: z
          .array(
            z.object({
              userId: zId.nullable().optional(),
              jobRoleId: zId.nullable().optional(),
              equipmentId: zId.nullable().optional(),
              allocationPct: z.number().min(1).max(400).default(100),
            })
          )
          .max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "task.edit");
      if (input.mode !== "replace" && !input.resources.length) bad("Pick at least one person, crew role or equipment");
      for (const r of input.resources) {
        if (!r.userId && !r.jobRoleId && !r.equipmentId) bad("Each assignment needs a person, a crew role or equipment");
      }
      const d = await db();
      const rows = await d
        .select({ id: tasks.id, parentId: tasks.parentId, sortOrder: tasks.sortOrder, name: tasks.name })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));
      const known = new Set(rows.map(r => r.id));
      if (input.taskIds.some(id => !known.has(id))) bad("Some of those tasks are not in this job");
      const targets = leafIds(rows, input.taskIds);
      if (!targets.length) bad("No detail tasks to assign");
      const userIds = input.resources.map(r => r.userId).filter((u): u is number => !!u);
      const roleIds = input.resources.map(r => r.jobRoleId).filter((u): u is number => !!u);
      const equipIds = input.resources.map(r => r.equipmentId).filter((u): u is number => !!u);
      const [uRows, rRows, eRows] = await Promise.all([
        userIds.length ? d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
        roleIds.length ? d.select({ id: jobRoles.id, name: jobRoles.name }).from(jobRoles).where(inArray(jobRoles.id, roleIds)) : [],
        equipIds.length ? d.select({ id: equipment.id, name: equipment.name }).from(equipment).where(inArray(equipment.id, equipIds)) : [],
      ]);
      if (uRows.length !== new Set(userIds).size || rRows.length !== new Set(roleIds).size || eRows.length !== new Set(equipIds).size) {
        bad("A selected person, crew role or equipment no longer exists");
      }
      const existing = await d.select().from(taskAssignments).where(inArray(taskAssignments.taskId, targets));
      const sig = (list: { userId: number | null; jobRoleId: number | null; equipmentId: number | null; allocationPct: number }[]) =>
        list.map(a => `${resourceKey(a)}@${a.allocationPct}`).sort().join("|");
      const changes: { taskId: number; next: ReturnType<typeof mergeAssignments>; addedUsers: number[] }[] = [];
      for (const taskId of targets) {
        const cur = existing.filter(a => a.taskId === taskId);
        const next = mergeAssignments(cur, input.resources, input.mode);
        if (next.length > 50) bad("A task can have at most 50 assignments");
        if (sig(cur) === sig(next)) continue;
        const prev = new Set(cur.map(a => a.userId).filter(Boolean));
        changes.push({ taskId, next, addedUsers: Array.from(new Set(next.map(a => a.userId).filter((u): u is number => !!u && !prev.has(u)))) });
      }
      if (changes.length) {
        await d.transaction(async tx => {
          for (const c of changes) {
            await tx.delete(taskAssignments).where(eq(taskAssignments.taskId, c.taskId));
            if (c.next.length) await tx.insert(taskAssignments).values(c.next.map(a => ({ ...a, taskId: c.taskId })));
          }
        });
      }
      const nameOf = new Map(rows.map(r => [r.id, r.name]));
      const perUser = new Map<number, number[]>();
      for (const c of changes) for (const u of c.addedUsers) perUser.set(u, [...(perUser.get(u) ?? []), c.taskId]);
      const p = await getProjectOr404(input.projectId);
      for (const [u, list] of Array.from(perUser.entries())) {
        for (const taskId of list) await follow("task", taskId, u);
        await notify(ctx, [u], {
          title: list.length === 1 ? `Assigned: ${nameOf.get(list[0])}` : `Assigned to ${list.length} tasks on ${p.name}`,
          link: list.length === 1 ? `/jobs/${input.projectId}/schedule?task=${list[0]}` : `/jobs/${input.projectId}/tasks`,
        });
      }
      resetSec(ctx);
      if (changes.length) {
        await recomputeWithDownstream(input.projectId);
        const labels = [...uRows, ...rRows, ...eRows].map(x => x.name ?? "resource");
        const who = input.mode === "replace" && !labels.length ? "all resources" : labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");
        const verb = input.mode === "remove" ? `removed ${who} from` : input.mode === "replace" ? `set ${who} on` : `assigned ${who} to`;
        await logActivity(ctx, {
          projectId: input.projectId,
          entityType: "task",
          entityId: changes[0].taskId,
          action: "assign",
          summary: `${verb} ${changes.length === 1 ? `"${nameOf.get(changes[0].taskId)}"` : `${changes.length} tasks`}`,
        });
        for (const c of changes) await emit(ctx, "task", "update", { id: c.taskId, projectId: input.projectId, changed: ["assignments"] });
      }
      return { ok: true, tasks: targets.length, changed: changes.length };
    }),

  /* ---------------- Dependencies ---------------- */
  addDependency: protectedProcedure
    .input(
      z.object({
        predecessorId: zId,
        successorId: zId,
        type: enumOf(DEP_TYPES).default("FS"),
        lagDays: z.number().min(-365).max(365).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.predecessorId === input.successorId) bad("A task cannot depend on itself");
      const succ = await getTaskOr404(input.successorId);
      const pred = await getTaskOr404(input.predecessorId);
      await requireJobModule(ctx, succ.projectId, "task.edit");
      await requireJobModule(ctx, pred.projectId);
      if ((await isSummaryTask(succ.id)) || (await isSummaryTask(pred.id))) {
        bad("Link the detail tasks, not summary tasks");
      }
      const d = await db();
      const all = await d.select().from(taskDependencies);
      if (all.some(x => x.predecessorId === input.predecessorId && x.successorId === input.successorId)) {
        bad("These tasks are already linked");
      }
      const cycle = findCycle([
        ...all.map(x => ({ predecessorId: x.predecessorId, successorId: x.successorId, type: x.type, lagDays: x.lagDays })),
        { ...input },
      ]);
      if (cycle) bad("That link would create a loop in the schedule");
      await d.insert(taskDependencies).values(input);
      await recomputeWithDownstream(succ.projectId);
      if (pred.projectId !== succ.projectId) await recomputeWithDownstream(pred.projectId);
      return { ok: true };
    }),

  updateDependency: protectedProcedure
    .input(z.object({ id: zId, type: enumOf(DEP_TYPES), lagDays: z.number().min(-365).max(365) }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [dep] = await d.select().from(taskDependencies).where(eq(taskDependencies.id, input.id)).limit(1);
      if (!dep) bad("Link not found");
      const succ = await getTaskOr404(dep.successorId);
      await requireJobModule(ctx, succ.projectId, "task.edit");
      await d.update(taskDependencies).set({ type: input.type, lagDays: input.lagDays }).where(eq(taskDependencies.id, input.id));
      await recomputeWithDownstream(succ.projectId);
      return { ok: true };
    }),

  removeDependency: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const [dep] = await d.select().from(taskDependencies).where(eq(taskDependencies.id, input.id)).limit(1);
    if (!dep) return { ok: true };
    const succ = await getTaskOr404(dep.successorId);
    await requireJobModule(ctx, succ.projectId, "task.edit");
    await d.delete(taskDependencies).where(eq(taskDependencies.id, input.id));
    await recomputeWithDownstream(succ.projectId);
    return { ok: true };
  }),

  /* ---------------- Assignments ---------------- */
  setAssignments: protectedProcedure
    .input(
      z.object({
        taskId: zId,
        assignments: z
          .array(
            z.object({
              userId: zId.nullable().optional(),
              jobRoleId: zId.nullable().optional(),
              equipmentId: zId.nullable().optional(),
              allocationPct: z.number().min(1).max(400).default(100),
            })
          )
          .max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const t = await getTaskOr404(input.taskId);
      await requireJobModule(ctx, t.projectId, "task.edit");
      for (const a of input.assignments) {
        if (!a.userId && !a.jobRoleId && !a.equipmentId) bad("Each assignment needs a person, a job role or equipment");
      }
      const d = await db();
      const before = await d.select().from(taskAssignments).where(eq(taskAssignments.taskId, t.id));
      await d.delete(taskAssignments).where(eq(taskAssignments.taskId, t.id));
      if (input.assignments.length) {
        await d.insert(taskAssignments).values(
          input.assignments.map(a => ({
            taskId: t.id,
            userId: a.userId ?? null,
            jobRoleId: a.jobRoleId ?? null,
            equipmentId: a.equipmentId ?? null,
            allocationPct: a.allocationPct,
          }))
        );
      }
      const prevUsers = new Set(before.map(b => b.userId).filter(Boolean));
      const added = input.assignments.map(a => a.userId).filter((u): u is number => !!u && !prevUsers.has(u));
      for (const u of added) await follow("task", t.id, u);
      await notify(ctx, added, { title: `Assigned: ${t.name}`, link: `/jobs/${t.projectId}/schedule?task=${t.id}` });
      resetSec(ctx);
      await recomputeWithDownstream(t.projectId);
      return { ok: true };
    }),

  /* ---------------- Checklist ---------------- */
  addChecklist: protectedProcedure
    .input(z.object({ taskId: zId, text: zText(500).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const t = await getTaskOr404(input.taskId);
      await requireJobModule(ctx, t.projectId, "task.progress");
      const d = await db();
      const existing = await d.select({ id: checklistItems.id }).from(checklistItems).where(eq(checklistItems.taskId, t.id));
      await d.insert(checklistItems).values({ taskId: t.id, text: input.text, sortOrder: existing.length });
      return { ok: true };
    }),
  toggleChecklist: protectedProcedure
    .input(z.object({ id: zId, done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [c] = await d.select().from(checklistItems).where(eq(checklistItems.id, input.id)).limit(1);
      if (!c) bad("Checklist item not found");
      const t = await getTaskOr404(c.taskId);
      await requireJobModule(ctx, t.projectId, "task.progress");
      await d.update(checklistItems).set({ done: input.done }).where(eq(checklistItems.id, input.id));
      return { ok: true };
    }),
  removeChecklist: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const [c] = await d.select().from(checklistItems).where(eq(checklistItems.id, input.id)).limit(1);
    if (!c) return { ok: true };
    const t = await getTaskOr404(c.taskId);
    await requireJobModule(ctx, t.projectId, "task.progress");
    await d.delete(checklistItems).where(eq(checklistItems.id, input.id));
    return { ok: true };
  }),

  /* ---------------- My work ---------------- */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const s = await sec(ctx);
    if (!hasJobModuleAccess(s)) return [];
    const fin = financialChecker(s);
    const d = await db();
    const visible = await visibleProjects(ctx);
    const rows = await d
      .select({ task: tasks, projectName: projects.name, projectCode: projects.code, allocationPct: taskAssignments.allocationPct })
      .from(taskAssignments)
      .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(taskAssignments.userId, ctx.user.id), ne(tasks.status, "done"), eq(projects.state, "active")));
    return rows.filter(r => visible.includes(r.task.projectId)).map(r => ({
      ...r,
      task: { ...r.task, budgetCost: fin(r.task.projectId) ? r.task.budgetCost : null },
    }));
  }),

  /** Search task modules across visible jobs. Timesheet-only names come from time.week. */
  search: protectedProcedure
    .input(z.object({ q: z.string().max(100), projectId: zId.optional(), leavesOnly: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      if (input.projectId) await requireJobModule(ctx, input.projectId);
      else if (!hasJobModuleAccess(await sec(ctx))) return [];
      const d = await db();
      const visible = await visibleProjects(ctx);
      if (!visible.length) return [];
      const ids = input.projectId ? visible.filter(v => v === input.projectId) : visible;
      if (!ids.length) return [];
      const rows = await d
        .select({ id: tasks.id, name: tasks.name, wbs: tasks.wbs, projectId: tasks.projectId, isSummary: tasks.isSummary, kind: tasks.kind, projectName: projects.name, projectCode: projects.code })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(inArray(tasks.projectId, ids))
        .limit(2000);
      const q = input.q.toLowerCase();
      return rows
        .filter(r => (!input.leavesOnly || !r.isSummary) && (!q || r.name.toLowerCase().includes(q) || (r.projectCode ?? "").toLowerCase().includes(q)))
        .slice(0, 50);
    }),
});
