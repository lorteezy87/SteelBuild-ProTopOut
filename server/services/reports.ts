import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { applyFilters, sortRows, type Filter } from "@shared/filters";
import { deliveryRisk } from "@shared/delivery";
import { REPORT_ROW_CAP, REPORT_SOURCES, type ColumnDef, type SourceKey } from "@shared/reports";
import {
  companies,
  dailyReportProgress,
  dailyReports,
  deliveries,
  expenseCodes,
  expenses,
  jobRoles,
  projectCompanies,
  projects,
  taskAssignments,
  tasks,
  timeCodes,
  timeEntries,
  users,
  wfApps,
  wfItems,
  wfStates,
  workspaces,
  type ReportConfig,
} from "../../drizzle/schema";
import { db } from "../db";
import { effectivePrivileges, type SecurityData } from "../security/access";
import { hasJobModuleAccess } from "../security/guard";
import { orgToday } from "./calendars";
import { getDefs, getValues, type FieldDef } from "./customFields";
import { itemLabel } from "./wf";

type Row = Record<string, unknown> & { _projectId: number | null; _id: number };

const cfType = (f: FieldDef): ColumnDef["type"] =>
  ["number", "decimal"].includes(f.fieldType)
    ? "number"
    : f.fieldType === "currency"
      ? "currency"
      : f.fieldType === "date"
        ? "date"
        : f.fieldType === "boolean"
          ? "boolean"
          : f.fieldType === "select"
            ? "enum"
            : f.fieldType === "formula"
              ? "number"
              : "text";

function cfColumns(defs: FieldDef[]): ColumnDef[] {
  return defs
    .filter(f => f.fieldType !== "richtext")
    .map(f => ({
      key: `cf_${f.key}`,
      label: f.label,
      type: cfType(f),
      financial: f.isFinancial,
      options: f.options ? Object.fromEntries(f.options.map(o => [o.value, o.label])) : undefined,
    }));
}

function cfEntityType(source: SourceKey, appKey?: string) {
  if (source === "jobs") return "project";
  if (source === "tasks") return "task";
  if (source === "logs" && appKey) return `app:${appKey}`;
  return null;
}

/** Column catalog for one source, including custom fields. */
export async function sourceColumns(source: SourceKey, appKey?: string): Promise<ColumnDef[]> {
  const base = REPORT_SOURCES[source]?.columns ?? [];
  const et = cfEntityType(source, appKey);
  if (!et) return base;
  return [...base, ...cfColumns(await getDefs(et))];
}

async function attachCustom(rows: Row[], entityType: string) {
  const defs = await getDefs(entityType);
  if (!defs.length || !rows.length) return;
  const vals = await getValues(entityType, rows.map(r => r._id));
  for (const r of rows) {
    const v = vals.get(r._id) ?? {};
    for (const f of defs) r[`cf_${f.key}`] = v[f.key] ?? null;
  }
}

function access(s: SecurityData) {
  const cache = new Map<number, Set<string>>();
  const privs = (pid: number) => {
    if (!cache.has(pid)) cache.set(pid, effectivePrivileges(s, pid) as Set<string>);
    return cache.get(pid)!;
  };
  const visible: number[] = [];
  s.projectWorkspace.forEach((_w, pid) => {
    if (privs(pid).has("project.view")) visible.push(pid);
  });
  return { privs, visible };
}

/** Logs are the only report source included in non-module access tiers. */
export function assertReportSourceAccess(s: SecurityData, source: SourceKey) {
  if (source !== "logs" && !hasJobModuleAccess(s)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your access type only includes Logs and Timesheets" });
  }
}

export async function loadRows(s: SecurityData, source: SourceKey, appKey: string | undefined, today: string): Promise<Row[]> {
  assertReportSourceAccess(s, source);
  const d = await db();
  const { privs, visible } = access(s);
  const projRows = visible.length ? await d.select().from(projects).where(inArray(projects.id, visible)) : [];
  const projMap = new Map(projRows.map(p => [p.id, p]));
  const userRows = await d.select({ id: users.id, name: users.name, jobRoleId: users.jobRoleId }).from(users);
  const uname = new Map(userRows.map(u => [u.id, u.name ?? `User ${u.id}`]));
  const pcode = (pid: number | null) => (pid ? projMap.get(pid)?.code ?? null : null);
  const pname = (pid: number | null) => (pid ? projMap.get(pid)?.name ?? null : null);

  switch (source) {
    case "jobs": {
      if (!projRows.length) return [];
      const ws = await d.select().from(workspaces);
      const links = await d
        .select({ projectId: projectCompanies.projectId, role: projectCompanies.role, name: companies.name })
        .from(projectCompanies)
        .innerJoin(companies, eq(companies.id, projectCompanies.companyId))
        .where(inArray(projectCompanies.projectId, visible));
      const tons = await d
        .select({ projectId: tasks.projectId, erected: tasks.erectedTons, kind: tasks.kind })
        .from(tasks)
        .where(inArray(tasks.projectId, visible));
      const erected = new Map<number, number>();
      for (const t of tons) if (t.kind === "sequence") erected.set(t.projectId, (erected.get(t.projectId) ?? 0) + t.erected);
      const rows: Row[] = projRows.map(p => ({
        _id: p.id,
        _projectId: p.id,
        id: p.id,
        code: p.code,
        name: p.name,
        state: p.state,
        projectType: p.projectType,
        priority: p.priority,
        managerName: p.managerId ? uname.get(p.managerId) ?? null : null,
        workspaceName: ws.find(w => w.id === p.workspaceId)?.name ?? null,
        gcName: links.find(l => l.projectId === p.id && l.role === "gc")?.name ?? null,
        fabricatorName: links.find(l => l.projectId === p.id && l.role === "fabricator")?.name ?? null,
        startDate: p.startDate,
        deadline: p.deadline,
        plannedFinish: p.plannedFinish,
        projectedFinish: p.projectedFinish,
        percentComplete: p.percentComplete,
        scheduleHealth: p.scheduleHealth,
        costHealth: p.costHealth,
        contractType: p.contractType,
        contractValue: p.contractValue,
        budget: p.budget,
        actualCost: p.actualCost,
        projectedCost: p.projectedCost,
        plannedValue: p.plannedValue,
        earnedValue: p.earnedValue,
        totalTons: p.totalTons,
        erectedTons: Math.round((erected.get(p.id) ?? 0) * 100) / 100,
        totalPieces: p.totalPieces,
      }));
      await attachCustom(rows, "project");
      return rows;
    }
    case "tasks": {
      if (!visible.length) return [];
      const trows = await d.select().from(tasks).where(inArray(tasks.projectId, visible));
      const ids = trows.map(t => t.id);
      const asg = ids.length
        ? await d.select().from(taskAssignments).where(inArray(taskAssignments.taskId, ids))
        : [];
      const roles = await d.select().from(jobRoles);
      const names = new Map<number, string[]>();
      for (const a of asg) {
        const n = a.userId ? uname.get(a.userId) : a.jobRoleId ? `[${roles.find(r => r.id === a.jobRoleId)?.name ?? "Role"}]` : null;
        if (!n) continue;
        if (!names.has(a.taskId)) names.set(a.taskId, []);
        names.get(a.taskId)!.push(n);
      }
      const rows: Row[] = trows.map(t => ({
        _id: t.id,
        _projectId: t.projectId,
        id: t.id,
        projectId: t.projectId,
        projectCode: pcode(t.projectId),
        projectName: pname(t.projectId),
        wbs: t.wbs,
        name: t.name,
        kind: t.isSummary ? "summary" : t.kind,
        status: t.status,
        priority: t.priority,
        assignees: (names.get(t.id) ?? []).join(", ") || null,
        location: t.location,
        startDate: t.startDate,
        finishDate: t.finishDate,
        actualStart: t.actualStart,
        actualFinish: t.actualFinish,
        projectedFinish: t.projectedFinish,
        durationDays: t.durationDays,
        effortHours: t.effortHours,
        percentComplete: t.percentComplete,
        scheduleHealth: t.scheduleHealth,
        isCritical: t.isCritical,
        totalFloat: t.totalFloat,
        plannedTons: t.plannedTons,
        erectedTons: t.erectedTons,
        plannedPieces: t.plannedPieces,
        erectedPieces: t.erectedPieces,
        budgetCost: t.budgetCost,
      }));
      await attachCustom(rows, "task");
      return rows;
    }
    case "time": {
      // Own entries, plus entries on jobs where the user approves time or sees financials.
      const managed = visible.filter(pid => privs(pid).has("time.approve") || privs(pid).has("project.financials"));
      const cond = managed.length
        ? or(eq(timeEntries.userId, s.userId), inArray(timeEntries.projectId, managed))
        : eq(timeEntries.userId, s.userId);
      const rows = await d
        .select({ e: timeEntries, task: tasks.name, code: timeCodes.name })
        .from(timeEntries)
        .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .leftJoin(timeCodes, eq(timeCodes.id, timeEntries.timeCodeId))
        .where(cond)
        .limit(REPORT_ROW_CAP * 2);
      const roles = await d.select().from(jobRoles);
      const userRole = new Map(userRows.map(u => [u.id, roles.find(r => r.id === u.jobRoleId)?.name ?? null]));
      const projAll = await d.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects);
      const pm = new Map(projAll.map(p => [p.id, p]));
      return rows.map(r => ({
        _id: r.e.id,
        _projectId: r.e.projectId,
        _own: r.e.userId === s.userId,
        id: r.e.id,
        entryDate: r.e.entryDate,
        userName: uname.get(r.e.userId) ?? null,
        jobRole: userRole.get(r.e.userId) ?? null,
        projectCode: pm.get(r.e.projectId)?.code ?? null,
        projectName: pm.get(r.e.projectId)?.name ?? null,
        taskName: r.task,
        timeCode: r.code,
        hours: r.e.hours,
        state: r.e.state,
        source: r.e.source,
        costAmount: r.e.costAmount,
        billAmount: r.e.billAmount,
        notes: r.e.notes,
      }));
    }
    case "expenses": {
      const managed = visible.filter(pid => privs(pid).has("expense.approve") || privs(pid).has("project.financials"));
      const cond = managed.length
        ? or(eq(expenses.userId, s.userId), inArray(expenses.projectId, managed))
        : eq(expenses.userId, s.userId);
      const rows = await d
        .select({ e: expenses, code: expenseCodes.name })
        .from(expenses)
        .leftJoin(expenseCodes, eq(expenseCodes.id, expenses.expenseCodeId))
        .where(cond)
        .limit(REPORT_ROW_CAP * 2);
      const projAll = await d.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects);
      const pm = new Map(projAll.map(p => [p.id, p]));
      return rows.map(r => ({
        _id: r.e.id,
        _projectId: r.e.projectId,
        _own: r.e.userId === s.userId,
        id: r.e.id,
        expenseDate: r.e.expenseDate,
        userName: uname.get(r.e.userId) ?? null,
        projectCode: pm.get(r.e.projectId)?.code ?? null,
        projectName: pm.get(r.e.projectId)?.name ?? null,
        expenseCode: r.code,
        vendor: r.e.vendor,
        description: r.e.description,
        amount: r.e.amount,
        billable: r.e.billable,
        state: r.e.state,
      }));
    }
    case "logs": {
      if (!appKey) return [];
      const [app] = await d.select().from(wfApps).where(eq(wfApps.key, appKey)).limit(1);
      if (!app) return [];
      let cond;
      if (app.scope === "global") {
        const globalPrivs = effectivePrivileges(s, null) as Set<string>;
        if (!globalPrivs.has("bid.manage")) return [];
        cond = eq(wfItems.appId, app.id);
      } else {
        const ok = visible.filter(pid => privs(pid).has("log.view"));
        if (!ok.length) return [];
        cond = and(eq(wfItems.appId, app.id), inArray(wfItems.projectId, ok));
      }
      const rows = await d
        .select({ i: wfItems, state: wfStates.name, category: wfStates.category })
        .from(wfItems)
        .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
        .where(cond);
      const now = Date.parse(`${today}T12:00:00Z`);
      const out: Row[] = rows.map(r => {
        const created = r.i.createdAt instanceof Date ? r.i.createdAt : new Date(r.i.createdAt);
        const end = r.category === "end" && r.i.closedAt ? new Date(r.i.closedAt).getTime() : now;
        return {
          _id: r.i.id,
          _projectId: r.i.projectId,
          id: r.i.id,
          label: itemLabel(app, r.i),
          title: r.i.title,
          projectCode: pcode(r.i.projectId),
          projectName: pname(r.i.projectId),
          state: r.state,
          stateCategory: r.category,
          priority: r.i.priority,
          assigneeName: r.i.assigneeId ? uname.get(r.i.assigneeId) ?? null : null,
          responsibleParty: r.i.responsibleParty,
          dueDate: r.i.dueDate,
          createdDate: created.toISOString().slice(0, 10),
          ageDays: Math.max(0, Math.floor((end - created.getTime()) / 86_400_000)),
          slaStatus: r.category === "end" ? "ok" : r.i.slaStatus,
          costImpact: r.i.costImpact,
          scheduleImpactDays: r.i.scheduleImpactDays,
          score: r.i.score,
        };
      });
      await attachCustom(out, `app:${app.key}`);
      return out;
    }
    case "deliveries": {
      if (!visible.length) return [];
      const rows = await d
        .select({ dl: deliveries, seq: tasks.name, fab: companies.name })
        .from(deliveries)
        .leftJoin(tasks, eq(tasks.id, deliveries.sequenceTaskId))
        .leftJoin(companies, eq(companies.id, deliveries.fabricatorCompanyId))
        .where(inArray(deliveries.projectId, visible));
      return rows.map(r => ({
        _id: r.dl.id,
        _projectId: r.dl.projectId,
        id: r.dl.id,
        projectCode: pcode(r.dl.projectId),
        projectName: pname(r.dl.projectId),
        loadNumber: r.dl.loadNumber,
        sequence: r.seq,
        fabricator: r.fab,
        needDate: r.dl.needDate,
        promisedDate: r.dl.promisedDate,
        shippedDate: r.dl.shippedDate,
        receivedDate: r.dl.receivedDate,
        tons: r.dl.tons,
        pieces: r.dl.pieces,
        ticketNumber: r.dl.ticketNumber,
        status: r.dl.status,
        risk: deliveryRisk(r.dl, today),
      }));
    }
    case "progress": {
      if (!visible.length) return [];
      const rows = await d
        .select({ p: dailyReportProgress, seq: tasks.name })
        .from(dailyReportProgress)
        .innerJoin(dailyReports, eq(dailyReports.id, dailyReportProgress.reportId))
        .leftJoin(tasks, eq(tasks.id, dailyReportProgress.taskId))
        .where(and(inArray(dailyReportProgress.projectId, visible), eq(dailyReports.status, "approved")));
      return rows.map(r => ({
        _id: r.p.id,
        _projectId: r.p.projectId,
        id: r.p.id,
        reportDate: r.p.reportDate,
        projectCode: pcode(r.p.projectId),
        projectName: pname(r.p.projectId),
        sequence: r.seq,
        tons: r.p.tons,
        pieces: r.p.pieces,
        note: r.p.note,
      }));
    }
  }
  return [];
}

function maskRows(rows: Row[], cols: ColumnDef[], s: SecurityData) {
  const fin = cols.filter(c => c.financial).map(c => c.key);
  if (!fin.length || s.isAdmin) return;
  const cache = new Map<number, boolean>();
  for (const r of rows) {
    const pid = r._projectId;
    let ok = false;
    if (pid == null) ok = (effectivePrivileges(s, null) as Set<string>).has("bid.manage");
    else {
      if (!cache.has(pid)) cache.set(pid, (effectivePrivileges(s, pid) as Set<string>).has("project.financials"));
      ok = cache.get(pid)!;
    }
    // People always see the dollar amounts of their own expenses.
    if (!ok && r._own === true && "amount" in r) {
      for (const k of fin) if (k !== "amount") r[k] = null;
      continue;
    }
    if (!ok) for (const k of fin) r[k] = null;
  }
}

/** Rows for a source with financial columns masked per the caller's privileges (used by REST v2). */
export async function loadMaskedRows(s: SecurityData, source: SourceKey, appKey: string | undefined, today: string) {
  const [cols, rows] = await Promise.all([sourceColumns(source, appKey), loadRows(s, source, appKey, today)]);
  maskRows(rows, cols, s);
  return rows;
}

function bucketOf(date: unknown, bucket: "day" | "week" | "month"): string | null {
  if (typeof date !== "string" || date.length < 10) return null;
  const day = date.slice(0, 10);
  if (bucket === "day") return day;
  if (bucket === "month") return day.slice(0, 7);
  const t = Date.parse(`${day}T00:00:00Z`);
  const wd = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - wd * 86_400_000).toISOString().slice(0, 10);
}

function labelOf(v: unknown, col?: ColumnDef): string {
  if (v == null || v === "") return "(blank)";
  if (Array.isArray(v)) return v.map(x => labelOf(x, col)).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return col?.options?.[s] ?? s;
}

function aggregate(values: number[], agg: string): number {
  if (agg === "count") return values.length;
  const nums = values.filter(n => Number.isFinite(n));
  if (!nums.length) return 0;
  if (agg === "sum") return nums.reduce((a, b) => a + b, 0);
  if (agg === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agg === "min") return Math.min(...nums);
  if (agg === "max") return Math.max(...nums);
  return nums.length;
}

export type ReportResult = {
  output: ReportConfig["output"];
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
  groups?: { key: string; label: string; count: number; totals: Record<string, number> }[];
  series?: { label: string; value: number }[];
};

export async function runReport(s: SecurityData, cfg: ReportConfig): Promise<ReportResult> {
  const source = cfg.source as SourceKey;
  if (!REPORT_SOURCES[source]) throw new Error("Unknown report source");
  assertReportSourceAccess(s, source);
  const today = await orgToday();
  const allCols = await sourceColumns(source, cfg.appKey);
  let rows = await loadRows(s, source, cfg.appKey, today);
  maskRows(rows, allCols, s);
  const known = new Set(allCols.map(c => c.key));
  rows = applyFilters(rows, (cfg.filters ?? []).filter(f => known.has(f.field)) as Filter[], today);
  const totalRows = rows.length;
  const truncated = rows.length > REPORT_ROW_CAP;
  if (truncated) rows = rows.slice(0, REPORT_ROW_CAP);
  if (cfg.sort?.length) rows = sortRows(rows, cfg.sort.filter(x => known.has(x.field)));
  const colKeys = (cfg.columns?.length ? cfg.columns : REPORT_SOURCES[source].defaultColumns).filter(k => known.has(k));
  const columns = colKeys.map(k => allCols.find(c => c.key === k)!);
  const groupCol = cfg.groupBy ? allCols.find(c => c.key === cfg.groupBy) : undefined;
  const metric = cfg.metric ?? { agg: "count" as const };
  const metricCol = metric.field ? allCols.find(c => c.key === metric.field) : undefined;
  const num = (r: Record<string, unknown>) => {
    const v = metricCol ? r[metricCol.key] : 1;
    return typeof v === "number" ? v : v == null ? NaN : Number(v);
  };

  if (cfg.output === "table") {
    const limit = Math.min(cfg.limit ?? REPORT_ROW_CAP, REPORT_ROW_CAP);
    const outRows = rows.slice(0, limit).map(r => {
      const o: Record<string, unknown> = { id: r.id, _projectId: r._projectId };
      for (const k of colKeys) o[k] = r[k];
      return o;
    });
    let groups: ReportResult["groups"];
    if (groupCol) {
      const numericCols = columns.filter(c => ["number", "currency"].includes(c.type));
      const map = new Map<string, { key: string; label: string; count: number; totals: Record<string, number> }>();
      for (const r of rows) {
        const key = groupCol.type === "date" ? bucketOf(r[groupCol.key], cfg.dateBucket ?? "month") ?? "" : String(r[groupCol.key] ?? "");
        if (!map.has(key)) map.set(key, { key, label: labelOf(key || null, groupCol), count: 0, totals: {} });
        const g = map.get(key)!;
        g.count++;
        for (const c of numericCols) {
          const v = r[c.key];
          if (typeof v === "number") g.totals[c.key] = (g.totals[c.key] ?? 0) + v;
        }
      }
      groups = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    }
    return { output: "table", columns, rows: outRows, totalRows, truncated, groups };
  }

  if (cfg.output === "line") {
    const dateCol = groupCol && groupCol.type === "date" ? groupCol : allCols.find(c => c.type === "date");
    if (!dateCol) return { output: "line", columns, rows: [], totalRows, truncated, series: [] };
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const b = bucketOf(r[dateCol.key], cfg.dateBucket ?? "week");
      if (!b) continue;
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(num(r));
    }
    const keys = Array.from(map.keys()).sort();
    let run = 0;
    const series = keys.map(k => {
      const v = aggregate(map.get(k)!, metric.agg);
      run += v;
      return { label: k, value: Math.round((cfg.cumulative ? run : v) * 100) / 100 };
    });
    return { output: "line", columns, rows: [], totalRows, truncated, series };
  }

  // bar / pie
  const gcol = groupCol ?? allCols.find(c => c.type === "enum") ?? allCols[0];
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const raw = gcol.type === "date" ? bucketOf(r[gcol.key], cfg.dateBucket ?? "month") : r[gcol.key];
    const key = labelOf(raw, gcol);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(num(r));
  }
  let series = Array.from(map.entries()).map(([label, vals]) => ({ label, value: Math.round(aggregate(vals, metric.agg) * 100) / 100 }));
  if (gcol.type === "date") series.sort((a, b) => a.label.localeCompare(b.label));
  else series.sort((a, b) => b.value - a.value);
  if (cfg.output === "pie" && series.length > 12) {
    const head = series.slice(0, 11);
    const rest = series.slice(11).reduce((a, b) => a + b.value, 0);
    series = [...head, { label: "Other", value: Math.round(rest * 100) / 100 }];
  }
  return { output: cfg.output, columns, rows: [], totalRows, truncated, series };
}
