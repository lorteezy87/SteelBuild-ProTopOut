import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  baselines,
  dailyReportEquipment,
  dailyReports,
  deliveries,
  expenses,
  projectSnapshots,
  projects,
  taskAssignments,
  taskDependencies,
  tasks,
  timeEntries,
} from "../../drizzle/schema";
import { db } from "../db";
import { deliveryRisk } from "@shared/delivery";
import { CycleError, schedule, type SchedTask } from "../engine/scheduler";
import {
  clampPct,
  earnedValue,
  projectHealth,
  projectPercent,
  projectTask,
  type EvaTask,
  type EvaResult,
  type HealthTask,
  type ProgressMethod,
  type ScheduleHealth,
} from "../engine/projection";
import { getCalendar, orgToday } from "./calendars";
import { refreshFormulas, rollupTaskFields } from "./customFields";

const HEALTH_RANK: Record<ScheduleHealth, number> = {
  delayed: 6,
  blocked: 5,
  at_risk: 4,
  on_track: 3,
  future: 2,
  done: 1,
  not_active: 0,
};

export async function projectCosts(projectId: number) {
  const d = await db();
  const [labor] = await d
    .select({
      cost: sql<number>`coalesce(sum(${timeEntries.costAmount}),0)`,
      bill: sql<number>`coalesce(sum(${timeEntries.billAmount}),0)`,
      hours: sql<number>`coalesce(sum(${timeEntries.hours}),0)`,
    })
    .from(timeEntries)
    .where(
      and(eq(timeEntries.projectId, projectId), inArray(timeEntries.state, ["recorded", "invoiced"]))
    );
  const [exp] = await d
    .select({
      cost: sql<number>`coalesce(sum(case when ${expenses.costable} then ${expenses.amount} else 0 end),0)`,
      bill: sql<number>`coalesce(sum(case when ${expenses.billable} then ${expenses.amount} else 0 end),0)`,
    })
    .from(expenses)
    .where(and(eq(expenses.projectId, projectId), inArray(expenses.state, ["recorded", "invoiced"])));
  const [equip] = await d
    .select({ cost: sql<number>`coalesce(sum(${dailyReportEquipment.cost}),0)` })
    .from(dailyReportEquipment)
    .innerJoin(dailyReports, eq(dailyReports.id, dailyReportEquipment.reportId))
    .where(and(eq(dailyReports.projectId, projectId), eq(dailyReports.status, "final")));
  const laborCost = Number(labor?.cost ?? 0);
  const expenseCost = Number(exp?.cost ?? 0);
  const equipmentCost = Number(equip?.cost ?? 0);
  return {
    laborCost,
    laborBill: Number(labor?.bill ?? 0),
    laborHours: Number(labor?.hours ?? 0),
    expenseCost,
    expenseBill: Number(exp?.bill ?? 0),
    equipmentCost,
    total: laborCost + expenseCost + equipmentCost,
  };
}

export function wbsCodes(rows: { id: number; parentId: number | null; sortOrder: number }[]): Map<number, string> {
  const kids = new Map<number | null, typeof rows>();
  const ids = new Set(rows.map(r => r.id));
  for (const r of rows) {
    const p = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(r);
  }
  const out = new Map<number, string>();
  const walk = (parent: number | null, prefix: string) => {
    const list = (kids.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    list.forEach((r, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.set(r.id, code);
      walk(r.id, code);
    });
  };
  walk(null, "");
  return out;
}

/** EVA weights and BAC are frozen with the active baseline, including zero budgets. */
export function evaPlan(
  rows: Pick<typeof tasks.$inferSelect, "id" | "kind" | "isSummary" | "percentComplete" | "durationDays" | "budgetCost" | "startDate" | "finishDate">[],
  currentBudget: number,
  baseline?: Pick<typeof baselines.$inferSelect, "budget" | "taskData"> | null,
  currentPercent = 0
): { tasks: EvaTask[]; budget: number; percentComplete: number } {
  const byTask = new Map(rows.map(t => [t.id, t]));
  const currentPlan = rows.filter(t => !t.isSummary).map(t => ({
    id: t.id, kind: t.kind, durationDays: t.durationDays, budgetCost: t.budgetCost,
    plannedStart: t.startDate, plannedFinish: t.finishDate,
  }));
  if (!baseline) return { tasks: currentPlan, budget: currentBudget, percentComplete: currentPercent };
  const frozenPlan: EvaTask[] = baseline.taskData
    .filter(t => !(t.isSummary ?? byTask.get(t.taskId)?.isSummary ?? false))
    .map(t => {
      const current = byTask.get(t.taskId);
      return {
        id: t.taskId,
        kind: t.kind ?? current?.kind ?? "task",
        durationDays: t.durationDays ?? current?.durationDays ?? 0,
        budgetCost: t.budgetCost ?? current?.budgetCost ?? 0,
        plannedStart: t.startDate,
        plannedFinish: t.finishDate,
      };
    });
  const sumBudget = frozenPlan.reduce((sum, t) => sum + t.budgetCost, 0);
  const weight = (t: EvaTask) => sumBudget > 0 ? t.budgetCost : t.kind === "milestone" ? 0 : Math.max(1, t.durationDays);
  const totalWeight = frozenPlan.reduce((sum, t) => sum + weight(t), 0);
  return {
    budget: baseline.budget ?? currentBudget,
    tasks: frozenPlan,
    percentComplete: totalWeight > 0
      ? frozenPlan.reduce((sum, t) => sum + weight(t) * clampPct(byTask.get(t.id)?.percentComplete ?? 0), 0) / totalWeight
      : 0,
  };
}

/** The engine falls back to task budgets for BAC=0; a frozen zero BAC must stay zero. */
export function frozenBaselineEva(eva: EvaResult, baselineBudget?: number): EvaResult {
  if (baselineBudget !== 0) return eva;
  return { ...eva, bac: 0, pv: 0, ev: 0, cpi: eva.ac > 0 ? 0 : null, spi: null, cv: -eva.ac, sv: 0, eac: 0, vac: 0 };
}

export async function recomputeProject(projectId: number) {
  const d = await db();
  const [project] = await d.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return;
  const cal = await getCalendar(project.calendarId);
  const today = await orgToday();
  const method = (project.progressMethod || "tonnage") as ProgressMethod;
  const active = project.state === "active";

  const rows = await d.select().from(tasks).where(eq(tasks.projectId, projectId));
  const original = new Map(rows.map(r => [r.id, { ...r }]));
  const ids = rows.map(r => r.id);
  const deps = ids.length
    ? await d
        .select()
        .from(taskDependencies)
        .where(or(inArray(taskDependencies.successorId, ids), inArray(taskDependencies.predecessorId, ids)))
    : [];
  const idSet = new Set(ids);
  const externalIds = Array.from(
    new Set(deps.filter(x => idSet.has(x.successorId) && !idSet.has(x.predecessorId)).map(x => x.predecessorId))
  );
  const external = externalIds.length ? await d.select().from(tasks).where(inArray(tasks.id, externalIds)) : [];
  const assigns = ids.length ? await d.select().from(taskAssignments).where(inArray(taskAssignments.taskId, ids)) : [];
  const alloc = new Map<number, number>();
  for (const a of assigns) {
    if (a.equipmentId) continue;
    alloc.set(a.taskId, (alloc.get(a.taskId) ?? 0) + (a.allocationPct || 0) / 100);
  }

  const parentIds = new Set(rows.filter(r => r.parentId != null).map(r => r.parentId!));
  // Sequence progress from tonnage / pieces.
  for (const r of rows) {
    if (r.kind !== "sequence" || parentIds.has(r.id)) continue;
    if (method === "tonnage" && r.plannedTons > 0) r.percentComplete = clampPct((r.erectedTons / r.plannedTons) * 100);
    if (method === "pieces" && r.plannedPieces > 0)
      r.percentComplete = clampPct((r.erectedPieces / r.plannedPieces) * 100);
  }

  const toSched = (r: typeof rows[number], ext = false): SchedTask => ({
    id: r.id,
    parentId: ext ? null : r.parentId,
    kind: r.kind,
    schedulingMode: r.schedulingMode,
    constraintType: r.constraintType,
    constraintDate: r.constraintDate,
    startDate: r.startDate,
    finishDate: r.finishDate,
    durationDays: r.durationDays,
    effortHours: r.effortHours,
    actualStart: r.actualStart,
    actualFinish: r.actualFinish,
    percentComplete: r.percentComplete,
    allocation: alloc.get(r.id) ?? 0,
    external: ext,
  });

  const projectStart =
    project.startDate ??
    rows
      .map(r => r.startDate)
      .filter((x): x is string => !!x)
      .sort()[0] ??
    today;

  let sched: ReturnType<typeof schedule> | null = null;
  try {
    sched = schedule(
      [...rows.map(r => toSched(r)), ...external.map(r => toSched(r, true))],
      deps.map(x => ({ predecessorId: x.predecessorId, successorId: x.successorId, type: x.type, lagDays: x.lagDays })),
      cal,
      projectStart
    );
  } catch (e) {
    if (!(e instanceof CycleError)) throw e;
    console.warn(`[recompute] project ${projectId} has a dependency cycle`, e.taskIds);
  }

  const wbs = wbsCodes(rows);
  const byId = new Map(rows.map(r => [r.id, r]));

  // Apply schedule.
  for (const r of rows) {
    const s = sched?.get(r.id);
    if (s) {
      r.startDate = s.startDate;
      r.finishDate = s.finishDate;
      if (s.isSummary || r.schedulingMode === "manual" || r.kind === "milestone") r.durationDays = s.durationDays;
      r.totalFloat = s.totalFloat;
      r.isCritical = s.isCritical;
      r.constraintViolated = s.constraintViolated;
    }
    r.isSummary = parentIds.has(r.id);
  }

  // Summary rollups: percent (duration-weighted), tons, pieces, budget.
  const children = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.parentId != null && byId.has(r.parentId)) {
      if (!children.has(r.parentId)) children.set(r.parentId, []);
      children.get(r.parentId)!.push(r);
    }
  }
  const roll = (r: typeof rows[number]) => {
    const kids = children.get(r.id);
    if (!kids?.length) return;
    kids.forEach(roll);
    const w = (k: typeof r) => (k.kind === "milestone" ? 0 : Math.max(1, k.durationDays));
    const tw = kids.reduce((s, k) => s + w(k), 0);
    r.percentComplete = tw > 0 ? kids.reduce((s, k) => s + w(k) * k.percentComplete, 0) / tw : 0;
    r.plannedTons = kids.reduce((s, k) => s + k.plannedTons, 0);
    r.erectedTons = kids.reduce((s, k) => s + k.erectedTons, 0);
    r.plannedPieces = kids.reduce((s, k) => s + k.plannedPieces, 0);
    r.erectedPieces = kids.reduce((s, k) => s + k.erectedPieces, 0);
    r.budgetCost = kids.reduce((s, k) => s + k.budgetCost, 0);
  };
  rows.filter(r => r.parentId == null || !byId.has(r.parentId)).forEach(roll);

  // Projections.
  const leaves = rows.filter(r => !r.isSummary);
  const asHealth = (r: typeof rows[number]): HealthTask => ({
    id: r.id,
    isSummary: r.isSummary,
    kind: r.kind,
    status: r.status,
    startDate: r.startDate,
    finishDate: r.finishDate,
    durationDays: r.durationDays,
    effortHours: r.effortHours,
    percentComplete: r.percentComplete,
    plannedTons: r.plannedTons,
    erectedTons: r.erectedTons,
    plannedPieces: r.plannedPieces,
    erectedPieces: r.erectedPieces,
    budgetCost: r.budgetCost,
  });
  const projections = new Map<number, ReturnType<typeof projectTask>>();
  for (const r of leaves) projections.set(r.id, projectTask(asHealth(r), today, cal, active, method));
  const summaryHealth = (r: typeof rows[number]): { health: ScheduleHealth; projectedFinish: string | null } => {
    const kids = children.get(r.id) ?? [];
    const ps = kids.map(k => (k.isSummary ? summaryHealth(k) : projections.get(k.id)!)).filter(Boolean);
    const worst = ps.reduce<ScheduleHealth>(
      (w, p) => (HEALTH_RANK[p.health] > HEALTH_RANK[w] ? p.health : w),
      active ? "done" : "not_active"
    );
    const pf = ps
      .map(p => p.projectedFinish)
      .filter((x): x is string => !!x)
      .sort();
    const out = { health: worst, projectedFinish: pf[pf.length - 1] ?? r.finishDate };
    projections.set(r.id, out);
    return out;
  };
  // Late / at-risk fabricator loads put their sequence at risk.
  if (active) {
    const loads = await d.select().from(deliveries).where(eq(deliveries.projectId, projectId));
    const flagged = new Set(
      loads
        .filter(l => l.sequenceTaskId && ["late", "at_risk"].includes(deliveryRisk(l, today)))
        .map(l => l.sequenceTaskId!)
    );
    flagged.forEach(tid => {
      const pr = projections.get(tid);
      if (pr && (pr.health === "on_track" || pr.health === "future")) projections.set(tid, { ...pr, health: "at_risk" });
    });
  }
  rows.filter(r => r.isSummary && (r.parentId == null || !byId.has(r.parentId))).forEach(summaryHealth);

  // Project-level metrics.
  const pct = projectPercent(leaves.map(asHealth), method);
  const costs = await projectCosts(projectId);
  const roots = rows.filter(r => r.parentId == null || !byId.has(r.parentId));
  const starts = roots.map(r => r.startDate).filter((x): x is string => !!x).sort();
  const finishes = roots.map(r => r.finishDate).filter((x): x is string => !!x).sort();
  const plannedStart = starts[0] ?? project.startDate;
  const plannedFinish = finishes[finishes.length - 1] ?? project.deadline;

  const [baseline] = project.activeBaselineId
    ? await d.select().from(baselines).where(eq(baselines.id, project.activeBaselineId)).limit(1)
    : [];
  const activeBaseline = baseline?.projectId === projectId ? baseline : undefined;
  const plan = evaPlan(rows, project.budget, activeBaseline, pct);
  const eva = frozenBaselineEva(earnedValue(
    plan.tasks,
    plan.budget,
    plan.percentComplete,
    costs.total,
    today,
    cal
  ), activeBaseline?.budget);
  const health = projectHealth(
    {
      active,
      today,
      deadline: project.deadline,
      plannedFinish,
      plannedStart,
      budget: project.budget,
      actualCost: costs.total,
      percentComplete: pct,
      taskProjections: leaves.map(r => projections.get(r.id)!).filter(Boolean),
    },
    cal
  );

  // Persist only task rows whose computed fields changed.
  for (const r of rows) {
    const p = projections.get(r.id);
    const next = {
        wbs: wbs.get(r.id) ?? null,
        startDate: r.startDate,
        finishDate: r.finishDate,
        durationDays: r.durationDays,
        totalFloat: r.totalFloat,
        isCritical: r.isCritical,
        constraintViolated: r.constraintViolated,
        isSummary: r.isSummary,
        percentComplete: Math.round(r.percentComplete * 10) / 10,
        plannedTons: r.plannedTons,
        erectedTons: r.erectedTons,
        plannedPieces: r.plannedPieces,
        erectedPieces: r.erectedPieces,
        budgetCost: r.budgetCost,
        scheduleHealth: p?.health ?? (active ? "future" : "not_active"),
        projectedFinish: p?.projectedFinish ?? r.finishDate,
    };
    const before = original.get(r.id) as Record<string, unknown>;
    const changed = Object.entries(next).some(([k, v]) => {
      const b = before[k];
      if (typeof v === "number" && typeof b === "number") return Math.abs(v - b) > 1e-6;
      return (b ?? null) !== (v ?? null);
    });
    if (changed) await d.update(tasks).set(next).where(eq(tasks.id, r.id));
  }

  await d
    .update(projects)
    .set({
      percentComplete: Math.round(pct * 10) / 10,
      plannedStart,
      plannedFinish,
      projectedFinish: health.projectedFinish,
      projectedCost: health.projectedCost,
      scheduleHealth: health.scheduleHealth,
      costHealth: health.costHealth,
      plannedValue: eva.pv,
      earnedValue: eva.ev,
      actualCost: costs.total,
      lastForecastAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  const plannedTonsTotal = leaves.filter(r => r.kind === "sequence").reduce((s, r) => s + r.plannedTons, 0);
  const erectedTonsTotal = leaves.filter(r => r.kind === "sequence").reduce((s, r) => s + r.erectedTons, 0);
  await d
    .insert(projectSnapshots)
    .values({
      projectId,
      snapDate: today,
      percentComplete: pct,
      plannedValue: eva.pv,
      earnedValue: eva.ev,
      actualCost: costs.total,
      erectedTons: erectedTonsTotal,
      plannedTons: plannedTonsTotal,
    })
    .onDuplicateKeyUpdate({
      set: {
        percentComplete: pct,
        plannedValue: eva.pv,
        earnedValue: eva.ev,
        actualCost: costs.total,
        erectedTons: erectedTonsTotal,
        plannedTons: plannedTonsTotal,
      },
    });

  // Post-order task refresh uses final dates/progress and fresh child rollups.
  await rollupTaskFields(projectId, today);
  const [updatedProject] = await d.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (updatedProject) await refreshFormulas("project", projectId, updatedProject, today);

  // Successors in other projects depend on this project's dates.
  const outward = deps.filter(x => idSet.has(x.predecessorId) && !idSet.has(x.successorId)).map(x => x.successorId);
  return { eva, health, costs, percentComplete: pct, downstreamTaskIds: outward };
}

type ProjectEdge = { predecessorProjectId: number; successorProjectId: number };

/** Transitive BFS followed by Kahn's topological sort; every job is visited at most once. */
export function projectRecomputeOrder(projectIds: number[], edges: ProjectEdge[], roots = projectIds): number[] {
  const known = new Set(projectIds);
  const downstream = new Map<number, Set<number>>();
  for (const edge of edges) {
    const { predecessorProjectId: from, successorProjectId: to } = edge;
    if (from === to || !known.has(from) || !known.has(to)) continue;
    if (!downstream.has(from)) downstream.set(from, new Set());
    downstream.get(from)!.add(to);
  }
  const affected = new Set(roots.filter(id => known.has(id)));
  const queue = [...affected];
  const maxIterations = known.size;
  for (let i = 0; i < queue.length && i < maxIterations; i++) {
    for (const next of downstream.get(queue[i]) ?? []) {
      if (affected.has(next)) continue;
      affected.add(next);
      queue.push(next);
    }
  }
  const indegree = new Map([...affected].map(id => [id, 0]));
  for (const from of affected) for (const to of downstream.get(from) ?? []) {
    if (affected.has(to)) indegree.set(to, indegree.get(to)! + 1);
  }
  const ready = [...affected].filter(id => indegree.get(id) === 0).sort((a, b) => a - b);
  const order: number[] = [];
  while (ready.length && order.length < maxIterations) {
    const id = ready.shift()!;
    order.push(id);
    for (const to of downstream.get(id) ?? []) {
      if (!affected.has(to)) continue;
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) {
        ready.push(to);
        ready.sort((a, b) => a - b);
      }
    }
  }
  // Corrupt/cyclic project graphs have no topological order: finish once, never loop.
  const visited = new Set(order);
  return [...order, ...[...affected].filter(id => !visited.has(id)).sort((a, b) => a - b)];
}

async function projectDependencyGraph() {
  const d = await db();
  const [projectRows, taskRows, deps] = await Promise.all([
    d.select({ id: projects.id }).from(projects),
    d.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks),
    d.select({ predecessorId: taskDependencies.predecessorId, successorId: taskDependencies.successorId }).from(taskDependencies),
  ]);
  const byTask = new Map(taskRows.map(t => [t.id, t.projectId]));
  const edges: ProjectEdge[] = [];
  for (const dep of deps) {
    const from = byTask.get(dep.predecessorId);
    const to = byTask.get(dep.successorId);
    if (from != null && to != null && from !== to) edges.push({ predecessorProjectId: from, successorProjectId: to });
  }
  return { projectIds: projectRows.map(p => p.id), edges };
}

/** Recompute all transitively affected jobs, with predecessors before successors. */
export async function recomputeWithDownstream(projectId: number) {
  const graph = await projectDependencyGraph();
  const order = projectRecomputeOrder(graph.projectIds, graph.edges, [projectId]);
  let result: Awaited<ReturnType<typeof recomputeProject>>;
  for (const id of order) {
    const current = await recomputeProject(id);
    if (id === projectId) result = current;
  }
  return result;
}

export async function recomputeAll() {
  const graph = await projectDependencyGraph();
  for (const id of projectRecomputeOrder(graph.projectIds, graph.edges)) await recomputeProject(id);
  return graph.projectIds.length;
}
