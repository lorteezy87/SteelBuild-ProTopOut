import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { CONTRACT_TYPES, PROGRESS_METHODS, PROJECT_STATES, PROJECT_COMPANY_ROLES } from "@shared/domain";
import {
  activities,
  baselines,
  checklistItems,
  comments,
  dailyReportCrew,
  dailyReportEquipment,
  dailyReportProgress,
  dailyReports,
  deliveries,
  documents,
  documentVersions,
  expenses,
  projectCompanies,
  projectSnapshots,
  projects,
  taskAssignments,
  taskDependencies,
  tasks,
  timeEntries,
  users,
  wfEvents,
  wfItems,
  wfStates,
  drawingRevisions,
  drawingSetIssues,
  drawingSets,
  drawingSheets,
  drawingMarks,
  drawingScales,
  drawingTitleBlocks,
  modelJobs,
  modelReads,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { effectivePrivileges } from "../security/access";
import { hasJobModuleAccess, hasPriv, requireJobModule, requirePriv, resetSec, sec, visibleProjects } from "../security/guard";
import { getCalendar, orgToday } from "../services/calendars";
import { earnedValue } from "../engine/projection";
import { deleteValues, getDefs, getValues, maskFinancial, saveValues } from "../services/customFields";
import { emit, follow, logActivity } from "../services/events";
import { evaPlan, frozenBaselineEva, projectCosts, recomputeProject, recomputeWithDownstream } from "../services/recompute";
import { applyErectionTemplate } from "../services/templates";
import { refreshItemsForProject } from "../services/wf";
import { bad, defined, getProjectOr404, zDayOpt, zId, zText } from "./_util";

const enumOf = <T extends Record<string, string>>(o: T) => z.enum(Object.keys(o) as [string, ...string[]]);

const projectFields = z.object({
  code: zText(32).nullable().optional(),
  name: zText(255).min(1),
  description: z.string().max(20000).nullable().optional(),
  state: enumOf(PROJECT_STATES).optional(),
  projectType: zText(64).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  managerId: zId.nullable().optional(),
  calendarId: zId.nullable().optional(),
  startDate: zDayOpt,
  deadline: zDayOpt,
  contractType: enumOf(CONTRACT_TYPES).optional(),
  contractValue: z.number().min(0).optional(),
  budget: z.number().min(0).optional(),
  totalTons: z.number().min(0).optional(),
  totalPieces: z.number().int().min(0).optional(),
  retainagePct: z.number().min(0).max(100).optional(),
  noticeHours: z.number().int().min(1).max(24 * 60).optional(),
  siteAddress: z.string().max(2000).nullable().optional(),
  progressMethod: enumOf(PROGRESS_METHODS).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const FINANCIAL_KEYS = ["contractValue", "budget", "retainagePct"] as const;

type ProjectRow = typeof projects.$inferSelect;

export function maskProject<T extends Partial<ProjectRow>>(p: T, canFin: boolean): T {
  if (canFin) return p;
  return {
    ...p,
    contractValue: null,
    budget: null,
    actualCost: null,
    projectedCost: null,
    plannedValue: null,
    earnedValue: null,
    costHealth: null,
    retainagePct: null,
  } as T;
}

/** Keep the job/log header contract, without revealing schedule or cost modules. */
function projectHeader(p: ProjectRow): ProjectRow {
  return {
    ...maskProject(p, false),
    calendarId: null,
    plannedStart: null,
    plannedFinish: null,
    projectedFinish: null,
    totalTons: 0,
    totalPieces: 0,
    percentComplete: 0,
    scheduleHealth: "not_active",
    progressMethod: "tonnage",
    contractType: "lump_sum",
    lastForecastAt: null,
    activeBaselineId: null,
  };
}

async function tonnageByProject(ids: number[]) {
  if (!ids.length) return new Map<number, { planned: number; erected: number }>();
  const d = await db();
  const rows = await d
    .select({
      projectId: tasks.projectId,
      planned: sql<number>`coalesce(sum(${tasks.plannedTons}),0)`,
      erected: sql<number>`coalesce(sum(${tasks.erectedTons}),0)`,
    })
    .from(tasks)
    .where(and(inArray(tasks.projectId, ids), eq(tasks.kind, "sequence"), eq(tasks.isSummary, false)))
    .groupBy(tasks.projectId);
  return new Map(rows.map(r => [r.projectId, { planned: Number(r.planned), erected: Number(r.erected) }]));
}

export const projectsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          states: z.array(z.string()).optional(),
          search: z.string().max(100).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const d = await db();
      const ids = await visibleProjects(ctx);
      if (!ids.length) return [];
      const s = await sec(ctx);
      const modules = hasJobModuleAccess(s);
      let rows = await d.select().from(projects).where(inArray(projects.id, ids)).orderBy(desc(projects.updatedAt));
      if (input?.states?.length) rows = rows.filter(r => input.states!.includes(r.state));
      if (input?.search) {
        const q = input.search.toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q));
      }
      const pids = rows.map(r => r.id);
      const moduleIds = modules ? pids : [];
      const links = moduleIds.length
        ? await d.select().from(projectCompanies).where(inArray(projectCompanies.projectId, pids))
        : [];
      const tons = await tonnageByProject(moduleIds);
      const openLogs = pids.length
        ? await d
            .select({ projectId: wfItems.projectId, n: sql<number>`count(*)`, delayed: sql<number>`sum(case when ${wfItems.slaStatus} = 'delayed' then 1 else 0 end)` })
            .from(wfItems)
            .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
            .where(and(inArray(wfItems.projectId, pids), sql`${wfStates.category} <> 'end'`))
            .groupBy(wfItems.projectId)
        : [];
      const today = await orgToday();
      const lateDel = moduleIds.length
        ? await d
            .select({ projectId: deliveries.projectId, n: sql<number>`count(*)` })
            .from(deliveries)
            .where(
              and(
                inArray(deliveries.projectId, pids),
                inArray(deliveries.status, ["scheduled", "shipped"]),
                sql`(${deliveries.promisedDate} > ${deliveries.needDate} or ${deliveries.needDate} < ${today})`
              )
            )
            .groupBy(deliveries.projectId)
        : [];
      return rows.map(r => {
        const fin = modules && effectivePrivileges(s, r.id).has("project.financials");
        return {
          ...(modules ? maskProject(r, fin) : projectHeader(r)),
          canFinancials: fin,
          companies: links.filter(l => l.projectId === r.id),
          plannedTons: tons.get(r.id)?.planned ?? 0,
          erectedTons: tons.get(r.id)?.erected ?? 0,
          openLogs: Number(openLogs.find(o => o.projectId === r.id)?.n ?? 0),
          delayedLogs: Number(openLogs.find(o => o.projectId === r.id)?.delayed ?? 0),
          lateDeliveries: Number(lateDel.find(o => o.projectId === r.id)?.n ?? 0),
        };
      });
    }),

  get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    await requirePriv(ctx, "project.view", input.id);
    const d = await db();
    const p = await getProjectOr404(input.id);
    const s = await sec(ctx);
    const privs = Array.from(effectivePrivileges(s, input.id));
    if (!hasJobModuleAccess(s)) {
      return {
        project: projectHeader(p),
        privileges: privs,
        canFinancials: false,
        companies: [] as typeof projectCompanies.$inferSelect[],
        customFieldDefs: [] as Awaited<ReturnType<typeof getDefs>>,
        customFields: {} as Record<string, unknown>,
        costs: null,
        plannedPercent: 0,
        eva: null,
        tons: { planned: 0, erected: 0 },
        counts: { tasks: 0, critical: 0, delayed: 0, violated: 0 },
      };
    }
    const fin = privs.includes("project.financials");
    const links = await d.select().from(projectCompanies).where(eq(projectCompanies.projectId, input.id));
    const defs = await getDefs("project", p.projectType);
    const cf = (await getValues("project", [p.id])).get(p.id) ?? {};
    const costs = fin ? await projectCosts(p.id) : null;
    const tons = (await tonnageByProject([p.id])).get(p.id) ?? { planned: 0, erected: 0 };
    const [counts] = await d
      .select({
        tasks: sql<number>`count(*)`,
        critical: sql<number>`sum(case when ${tasks.isCritical} and not ${tasks.isSummary} then 1 else 0 end)`,
        delayed: sql<number>`sum(case when ${tasks.scheduleHealth} = 'delayed' and not ${tasks.isSummary} then 1 else 0 end)`,
        violated: sql<number>`sum(case when ${tasks.constraintViolated} and not ${tasks.isSummary} then 1 else 0 end)`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, p.id));
    // Planned progress is operational data even when financial amounts are hidden.
    // Use the same calendar, baseline dates and weighting as the EVA engine.
    const taskRows = await d.select().from(tasks).where(eq(tasks.projectId, p.id));
    const [activeBaseline] = p.activeBaselineId
      ? await d.select().from(baselines).where(eq(baselines.id, p.activeBaselineId)).limit(1)
      : [];
    const baseline = activeBaseline?.projectId === p.id ? activeBaseline : undefined;
    const plan = evaPlan(taskRows, p.budget, baseline, p.percentComplete);
    const eva = frozenBaselineEva(earnedValue(
      plan.tasks,
      plan.budget,
      plan.percentComplete,
      costs?.total ?? p.actualCost,
      await orgToday(),
      await getCalendar(p.calendarId)
    ), baseline?.budget);
    return {
      project: maskProject(p, fin),
      privileges: privs,
      canFinancials: fin,
      companies: links,
      customFieldDefs: fin ? defs : defs.filter(x => !x.isFinancial),
      customFields: maskFinancial(defs, cf, fin),
      costs,
      plannedPercent: eva.plannedPercent,
      eva: fin ? eva : null,
      tons,
      counts: {
        tasks: Number(counts?.tasks ?? 0),
        critical: Number(counts?.critical ?? 0),
        delayed: Number(counts?.delayed ?? 0),
        violated: Number(counts?.violated ?? 0),
      },
    };
  }),

  create: protectedProcedure
    .input(
      projectFields.extend({
        template: z.enum(["blank", "erection"]).default("erection"),
        sequenceCount: z.number().int().min(1).max(40).default(4),
        companies: z.array(z.object({ companyId: zId, role: enumOf(PROJECT_COMPANY_ROLES) })).optional(),
        fromBidItemId: zId.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requirePriv(ctx, "project.create");
      const d = await db();
      const { template, sequenceCount, companies: links, customFields, fromBidItemId: _bid, ...fields } = input;
      const year = new Date().getFullYear();
      let code = fields.code?.trim() || null;
      if (!code) {
        const [c] = await d.select({ n: sql<number>`count(*)` }).from(projects);
        code = `${year}-${String(Number(c?.n ?? 0) + 1).padStart(3, "0")}`;
      }
      const [{ id }] = await d
        .insert(projects)
        .values({
          ...fields,
          code,
          managerId: fields.managerId ?? ctx.user.id,
          state: fields.state ?? "draft",
          createdBy: ctx.user.id,
        })
        .$returningId();
      if (links?.length) await d.insert(projectCompanies).values(links.map(l => ({ ...l, projectId: id })));
      if (template === "erection") {
        await applyErectionTemplate(id, {
          sequenceCount,
          totalTons: fields.totalTons ?? 0,
          totalPieces: fields.totalPieces ?? 0,
          userId: ctx.user.id,
        });
      }
      if (customFields && Object.keys(customFields).length) {
        await saveValues({
          entityType: "project",
          entityId: id,
          values: customFields,
          base: { ...fields },
          canFinancial: true,
          today: await orgToday(),
        });
      }
      resetSec(ctx);
      await follow("project", id, ctx.user.id);
      await recomputeProject(id);
      await logActivity(ctx, { projectId: id, entityType: "project", entityId: id, action: "create", summary: `created job ${code} ${fields.name}` });
      await emit(ctx, "project", "add", { id, code, name: fields.name });
      return { id };
    }),

  update: protectedProcedure
    .input(projectFields.partial().extend({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.id, "project.edit");
      const fin = await hasPriv(ctx, "project.financials", input.id);
      const { id, customFields, ...rest } = input;
      const set: Record<string, unknown> = defined(rest);
      for (const k of FINANCIAL_KEYS) {
        if (k in set && !fin) throw new TRPCError({ code: "FORBIDDEN", message: "Missing privilege: project.financials" });
      }
      const d = await db();
      const before = await getProjectOr404(id);
      if (Object.keys(set).length) await d.update(projects).set(set).where(eq(projects.id, id));
      if (customFields) {
        await saveValues({
          entityType: "project",
          entityId: id,
          values: customFields,
          base: { ...before, ...set },
          canFinancial: fin,
          today: await orgToday(),
        });
      }
      if ("managerId" in set) resetSec(ctx);
      await recomputeWithDownstream(id);
      if ("noticeHours" in set && set.noticeHours !== before.noticeHours) await refreshItemsForProject(id);
      const changed = Object.keys(set).filter(k => (before as Record<string, unknown>)[k] !== set[k]);
      if (changed.length) {
        await logActivity(ctx, {
          projectId: id,
          entityType: "project",
          entityId: id,
          action: "update",
          summary: set.state && set.state !== before.state ? `changed state to ${set.state}` : `updated ${changed.join(", ")}`,
        });
      }
      await emit(ctx, "project", "update", { id, changed });
      return { ok: true };
    }),

  setCompanies: protectedProcedure
    .input(z.object({ projectId: zId, links: z.array(z.object({ companyId: zId, role: enumOf(PROJECT_COMPANY_ROLES) })) }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.edit");
      const d = await db();
      await d.delete(projectCompanies).where(eq(projectCompanies.projectId, input.projectId));
      if (input.links.length)
        await d.insert(projectCompanies).values(input.links.map(l => ({ ...l, projectId: input.projectId })));
      return { ok: true };
    }),

  delete: protectedProcedure.input(z.object({ id: zId, confirm: z.string() })).mutation(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.id, "project.delete");
    const p = await getProjectOr404(input.id);
    if (input.confirm !== (p.code ?? p.name)) bad("Type the job number to confirm deletion");
    const d = await db();
    const taskRows = await d.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, p.id));
    const tids = taskRows.map(t => t.id);
    if (tids.length) {
      await d.delete(taskDependencies).where(inArray(taskDependencies.successorId, tids));
      await d.delete(taskDependencies).where(inArray(taskDependencies.predecessorId, tids));
      await d.delete(taskAssignments).where(inArray(taskAssignments.taskId, tids));
      await d.delete(checklistItems).where(inArray(checklistItems.taskId, tids));
      await deleteValues("task", tids);
    }
    await d.delete(tasks).where(eq(tasks.projectId, p.id));
    const reports = await d.select({ id: dailyReports.id }).from(dailyReports).where(eq(dailyReports.projectId, p.id));
    const rids = reports.map(r => r.id);
    if (rids.length) {
      await d.delete(dailyReportCrew).where(inArray(dailyReportCrew.reportId, rids));
      await d.delete(dailyReportEquipment).where(inArray(dailyReportEquipment.reportId, rids));
      await d.delete(dailyReportProgress).where(inArray(dailyReportProgress.reportId, rids));
    }
    await d.delete(dailyReports).where(eq(dailyReports.projectId, p.id));
    await d.delete(deliveries).where(eq(deliveries.projectId, p.id));
    await d.delete(baselines).where(eq(baselines.projectId, p.id));
    await d.delete(projectSnapshots).where(eq(projectSnapshots.projectId, p.id));
    await d.delete(timeEntries).where(eq(timeEntries.projectId, p.id));
    await d.delete(expenses).where(eq(expenses.projectId, p.id));
    const items = await d.select({ id: wfItems.id }).from(wfItems).where(eq(wfItems.projectId, p.id));
    if (items.length) await d.delete(wfEvents).where(inArray(wfEvents.itemId, items.map(i => i.id)));
    await d.delete(wfItems).where(eq(wfItems.projectId, p.id));
    const docs = await d.select({ id: documents.id }).from(documents).where(eq(documents.projectId, p.id));
    if (docs.length) await d.delete(documentVersions).where(inArray(documentVersions.documentId, docs.map(x => x.id)));
    await d.delete(documents).where(eq(documents.projectId, p.id));
    const dsheets = await d.select({ id: drawingSheets.id }).from(drawingSheets).where(eq(drawingSheets.projectId, p.id));
    if (dsheets.length) await d.delete(drawingRevisions).where(inArray(drawingRevisions.sheetId, dsheets.map(x => x.id)));
    if (dsheets.length) await d.delete(drawingScales).where(inArray(drawingScales.sheetId, dsheets.map(x => x.id)));
    await d.delete(drawingMarks).where(eq(drawingMarks.projectId, p.id));
    await d.delete(drawingTitleBlocks).where(eq(drawingTitleBlocks.projectId, p.id));
    await d.delete(modelReads).where(eq(modelReads.projectId, p.id));
    await d.delete(modelJobs).where(eq(modelJobs.projectId, p.id));
    await d.delete(drawingSheets).where(eq(drawingSheets.projectId, p.id));
    await d.delete(drawingSetIssues).where(eq(drawingSetIssues.projectId, p.id));
    await d.delete(drawingSets).where(eq(drawingSets.projectId, p.id));
    await d.delete(comments).where(eq(comments.projectId, p.id));
    await d.delete(activities).where(eq(activities.projectId, p.id));
    await d.delete(projectCompanies).where(eq(projectCompanies.projectId, p.id));
    await deleteValues("project", [p.id]);
    await d.delete(projects).where(eq(projects.id, p.id));
    await emit(ctx, "project", "delete", { id: p.id, code: p.code });
    return { ok: true };
  }),

  reforecast: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.id);
    if (!(await hasPriv(ctx, "project.edit", input.id)) && !(await hasPriv(ctx, "task.progress", input.id))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Missing privilege: project.edit" });
    }
    const r = await recomputeWithDownstream(input.id);
    await refreshItemsForProject(input.id);
    return { ok: true, health: r?.health ?? null };
  }),

  reforecastMany: protectedProcedure.input(z.object({ ids: z.array(zId).max(200) })).mutation(async ({ ctx, input }) => {
    const s = await sec(ctx);
    if (!hasJobModuleAccess(s)) throw new TRPCError({ code: "FORBIDDEN", message: "Your access type only includes Logs and Timesheets" });
    let n = 0;
    for (const id of input.ids) {
      const p = effectivePrivileges(s, id);
      if (p.has("project.edit") || p.has("task.progress")) {
        await recomputeWithDownstream(id);
        await refreshItemsForProject(id);
        n++;
      }
    }
    return { reforecast: n };
  }),

  snapshots: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.id);
    const fin = await hasPriv(ctx, "project.financials", input.id);
    const d = await db();
    const rows = await d
      .select()
      .from(projectSnapshots)
      .where(eq(projectSnapshots.projectId, input.id))
      .orderBy(projectSnapshots.snapDate);
    return rows.map(r => (fin ? r : { ...r, plannedValue: null, earnedValue: null, actualCost: null }));
  }),
});
