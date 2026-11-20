import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { deliveryRisk } from "@shared/delivery";
import { plannedFraction } from "../engine/projection";
import { addCalendarDays, parseDay } from "../engine/calendar";
import {
  companies,
  dailyReportProgress,
  dailyReports,
  deliveries,
  projects,
  tasks,
  timeEntries,
  users,
  wfApps,
  wfItems,
  wfStates,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { effectivePrivileges } from "../security/access";
import { hasJobModuleAccess, sec } from "../security/guard";
import { getCalendar, orgToday } from "../services/calendars";
import { itemLabel } from "../services/wf";
import { changeOrderTotals } from "./financials";
import { round2, zId } from "./_util";

const weekStartOf = (day: string) => {
  const t = parseDay(day);
  const wd = (new Date(t * 86_400_000).getUTCDay() + 6) % 7;
  return addCalendarDays(day, -wd);
};

/** Planned vs erected tons by week (cumulative) for a set of jobs. */
export async function tonsCurve(projectIds: number[], today: string) {
  if (!projectIds.length) return [];
  const d = await db();
  const seqs = await d
    .select()
    .from(tasks)
    .where(
      and(inArray(tasks.projectId, projectIds), eq(tasks.kind, "sequence"), eq(tasks.isSummary, false))
    );
  const projRows = await d
    .select({ id: projects.id, calendarId: projects.calendarId })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  const planned = new Map<string, number>();
  for (const s of seqs) {
    if (!s.startDate || !s.finishDate || s.plannedTons <= 0) continue;
    const cal = await getCalendar(
      projRows.find(p => p.id === s.projectId)?.calendarId
    );
    const days = Math.max(1, cal.workDaysBetween(s.startDate, s.finishDate));
    const perDay = s.plannedTons / days;
    let cur = cal.nextWorkDay(s.startDate);
    for (let i = 0; i < days && cur <= s.finishDate; i++) {
      const wk = weekStartOf(cur);
      planned.set(wk, (planned.get(wk) ?? 0) + perDay);
      cur = cal.addWorkDays(cur, 1);
    }
  }
  const prog = await d
    .select({
      date: dailyReportProgress.reportDate,
      tons: dailyReportProgress.tons,
    })
    .from(dailyReportProgress)
    .innerJoin(dailyReports, eq(dailyReports.id, dailyReportProgress.reportId))
    .where(
      and(
        inArray(dailyReportProgress.projectId, projectIds),
        eq(dailyReports.status, "approved")
      )
    );
  const actual = new Map<string, number>();
  for (const p of prog) {
    const wk = weekStartOf(p.date);
    actual.set(wk, (actual.get(wk) ?? 0) + p.tons);
  }
  const weeks = Array.from(
    new Set([...Array.from(planned.keys()), ...Array.from(actual.keys())])
  ).sort();
  if (!weeks.length) return [];
  const all: string[] = [];
  for (
    let w = weeks[0];
    w <= weeks[weeks.length - 1];
    w = addCalendarDays(w, 7)
  )
    all.push(w);
  let cp = 0;
  let ca = 0;
  const thisWeek = weekStartOf(today);
  return all.map(w => {
    cp += planned.get(w) ?? 0;
    ca += actual.get(w) ?? 0;
    return {
      week: w,
      planned: round2(cp),
      erected: w <= thisWeek ? round2(ca) : null,
    };
  });
}

export const dashboardRouter = router({
  portfolio: protectedProcedure
    .query(async ({ ctx, input }) => {
      const s = await sec(ctx);
      const d = await db();
      const today = await orgToday();
      const visible: number[] = [];
      s.projectIds.forEach(pid => {
        if (effectivePrivileges(s, pid).has("project.view")) visible.push(pid);
      });
      const empty = {
        today,
        counts: { active: 0, draft: 0, onHold: 0, completed: 0 },
        scheduleRag: {} as Record<string, number>,
        costRag: {} as Record<string, number>,
        jobs: [] as never[],
        milestones: [] as never[],
        delayedTasks: [] as never[],
        deliveries: [] as never[],
        rfiAging: [] as { bucket: string; count: number }[],
        delayNotices: [] as never[],
        money: null as null | {
          coPending: number;
          coApproved: number;
          bcOutstanding: number;
          bcRecovered: number;
        },
        crewHours: {
          total: 0,
          byJob: [] as {
            projectId: number;
            code: string | null;
            name: string;
            hours: number;
          }[],
        },
        tons: [] as Awaited<ReturnType<typeof tonsCurve>>,
      };
      // "/" remains the landing page for Logs/Timesheet-only users.
      if (!hasJobModuleAccess(s) || !visible.length) return empty;
      const projRows = await d
        .select()
        .from(projects)
        .where(inArray(projects.id, visible));
      const active = projRows.filter(p => p.state === "active");
      const activeIds = active.map(p => p.id);
      const fin = (pid: number) =>
        effectivePrivileges(s, pid).has("project.financials");
      const managers = await d
        .select({ id: users.id, name: users.name })
        .from(users);

      const scheduleRag: Record<string, number> = {};
      const costRag: Record<string, number> = {};
      for (const p of active) {
        scheduleRag[p.scheduleHealth] =
          (scheduleRag[p.scheduleHealth] ?? 0) + 1;
        if (fin(p.id)) costRag[p.costHealth] = (costRag[p.costHealth] ?? 0) + 1;
      }

      // Tons per job
      const seqRows = activeIds.length
        ? await d
            .select({
              projectId: tasks.projectId,
              planned: sql<number>`sum(${tasks.plannedTons})`,
              erected: sql<number>`sum(${tasks.erectedTons})`,
            })
            .from(tasks)
            .where(
              and(
                inArray(tasks.projectId, activeIds),
                eq(tasks.kind, "sequence"),
                eq(tasks.isSummary, false)
              )
            )
            .groupBy(tasks.projectId)
        : [];

      // Current-plan target at today, weighted by the job's progress method.
      const planTasks = activeIds.length
        ? await d
            .select()
            .from(tasks)
            .where(
              and(
                inArray(tasks.projectId, activeIds),
                eq(tasks.isSummary, false)
              )
            )
        : [];
      const plannedProgress = new Map<number, number>();
      for (const p of active) {
        const cal = await getCalendar(p.calendarId);
        const rows = planTasks.filter(t => t.projectId === p.id);
        const quantityTotal = rows.reduce(
          (sum, t) =>
            sum +
            (t.kind === "sequence"
              ? p.progressMethod === "pieces"
                ? t.plannedPieces
                : t.plannedTons
              : 0),
          0
        );
        const weight = (t: (typeof rows)[number]) =>
          p.progressMethod === "tonnage" && quantityTotal > 0
            ? t.kind === "sequence"
              ? t.plannedTons
              : 0
            : p.progressMethod === "pieces" && quantityTotal > 0
              ? t.kind === "sequence"
                ? t.plannedPieces
                : 0
              : t.kind === "milestone"
                ? 0
                : p.progressMethod === "effort" && t.effortHours > 0
                  ? t.effortHours
                  : Math.max(1, t.durationDays);
        const total = rows.reduce((sum, t) => sum + weight(t), 0);
        plannedProgress.set(
          p.id,
          total > 0
            ? round2(
                (100 *
                  rows.reduce(
                    (sum, t) =>
                      sum +
                      weight(t) *
                        plannedFraction(t.startDate, t.finishDate, today, cal),
                    0
                  )) /
                  total
              )
            : 0
        );
      }

      const jobs = active
        .map(p => {
          const t = seqRows.find(x => x.projectId === p.id);
          const f = fin(p.id);
          return {
            id: p.id,
            code: p.code,
            name: p.name,
            managerName: managers.find(m => m.id === p.managerId)?.name ?? null,
            percentComplete: p.percentComplete,
            plannedPercentComplete: plannedProgress.get(p.id) ?? 0,
            scheduleHealth: p.scheduleHealth,
            costHealth: f ? p.costHealth : null,
            deadline: p.deadline,
            projectedFinish: p.projectedFinish,
            budget: f ? p.budget : null,
            actualCost: f ? p.actualCost : null,
            projectedCost: f ? p.projectedCost : null,
            totalTons: p.totalTons,
            plannedTons: round2(Number(t?.planned ?? 0)),
            erectedTons: round2(Number(t?.erected ?? 0)),
          };
        })
        .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));

      const code = (pid: number) =>
        projRows.find(p => p.id === pid)?.code ?? null;
      const pname = (pid: number) =>
        projRows.find(p => p.id === pid)?.name ?? "";

      const horizon = addCalendarDays(today, 30);
      const milestones = activeIds.length
        ? await d
            .select({
              id: tasks.id,
              projectId: tasks.projectId,
              name: tasks.name,
              finishDate: tasks.finishDate,
              status: tasks.status,
              health: tasks.scheduleHealth,
            })
            .from(tasks)
            .where(
              and(
                inArray(tasks.projectId, activeIds),
                eq(tasks.kind, "milestone"),
                gte(tasks.finishDate, addCalendarDays(today, -7)),
                lte(tasks.finishDate, horizon)
              )
            )
            .orderBy(tasks.finishDate)
            .limit(25)
        : [];

      const delayedTasks = activeIds.length
        ? await d
            .select({
              id: tasks.id,
              projectId: tasks.projectId,
              name: tasks.name,
              wbs: tasks.wbs,
              finishDate: tasks.finishDate,
              projectedFinish: tasks.projectedFinish,
              percentComplete: tasks.percentComplete,
              health: tasks.scheduleHealth,
              isCritical: tasks.isCritical,
            })
            .from(tasks)
            .where(
              and(
                inArray(tasks.projectId, activeIds),
                eq(tasks.isSummary, false),
                inArray(tasks.scheduleHealth, ["delayed", "at_risk", "blocked"])
              )
            )
            .orderBy(tasks.finishDate)
            .limit(30)
        : [];

      // Deliveries: late or at risk, not yet received clean.
      const delRows = activeIds.length
        ? await d
            .select({ dl: deliveries, seq: tasks.name, fab: companies.name })
            .from(deliveries)
            .leftJoin(tasks, eq(tasks.id, deliveries.sequenceTaskId))
            .leftJoin(
              companies,
              eq(companies.id, deliveries.fabricatorCompanyId)
            )
            .where(inArray(deliveries.projectId, activeIds))
        : [];
      const riskyDeliveries = delRows
        .map(r => ({
          ...r.dl,
          sequenceName: r.seq,
          fabricatorName: r.fab,
          risk: deliveryRisk(r.dl, today),
          projectCode: code(r.dl.projectId),
          projectName: pname(r.dl.projectId),
        }))
        .filter(
          r =>
            (r.risk === "late" || r.risk === "at_risk") &&
            (r.receivedDate == null ||
              r.receivedDate >= addCalendarDays(today, -14))
        )
        .sort((a, b) =>
          (a.needDate ?? "9999").localeCompare(b.needDate ?? "9999")
        )
        .slice(0, 25);

      // Logs: RFI aging, delay notices at risk of late notice.
      const apps = await d
        .select()
        .from(wfApps)
        .where(inArray(wfApps.key, ["rfi", "delay"]));
      const rfiApp = apps.find(a => a.key === "rfi");
      const delayApp = apps.find(a => a.key === "delay");
      const logVisible = activeIds.filter(pid =>
        effectivePrivileges(s, pid).has("log.view")
      );
      const rfiAging = [
        { bucket: "0–7 d", count: 0 },
        { bucket: "8–14 d", count: 0 },
        { bucket: "15–30 d", count: 0 },
        { bucket: "30+ d", count: 0 },
      ];
      const now = Date.now();
      if (rfiApp && logVisible.length) {
        const open = await d
          .select({ createdAt: wfItems.createdAt })
          .from(wfItems)
          .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
          .where(
            and(
              eq(wfItems.appId, rfiApp.id),
              inArray(wfItems.projectId, logVisible),
              sql`${wfStates.category} <> 'end'`
            )
          );
        for (const r of open) {
          const age = (now - new Date(r.createdAt).getTime()) / 86_400_000;
          rfiAging[age <= 7 ? 0 : age <= 14 ? 1 : age <= 30 ? 2 : 3].count++;
        }
      }
      let delayNotices: {
        id: number;
        projectId: number | null;
        projectCode: string | null;
        label: string;
        title: string;
        stateName: string;
        slaStatus: string;
        slaDueAt: Date | null;
      }[] = [];
      if (delayApp && logVisible.length) {
        const rows = await d
          .select({ i: wfItems, stateName: wfStates.name })
          .from(wfItems)
          .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
          .where(
            and(
              eq(wfItems.appId, delayApp.id),
              inArray(wfItems.projectId, logVisible),
              eq(wfStates.category, "start")
            )
          );
        delayNotices = rows
          .map(r => ({
            id: r.i.id,
            projectId: r.i.projectId,
            projectCode: r.i.projectId ? code(r.i.projectId) : null,
            label: itemLabel(delayApp, r.i),
            title: r.i.title,
            stateName: r.stateName,
            slaStatus: r.i.slaStatus,
            slaDueAt: r.i.slaDueAt,
          }))
          .sort((a, b) =>
            String(a.slaDueAt ?? "").localeCompare(String(b.slaDueAt ?? ""))
          );
      }

      // Money (only jobs with financial access)
      const finIds = activeIds.filter(fin);
      let money: typeof empty.money = null;
      if (finIds.length) {
        money = {
          coPending: 0,
          coApproved: 0,
          bcOutstanding: 0,
          bcRecovered: 0,
        };
        for (const pid of finIds) {
          const t = await changeOrderTotals(pid);
          money.coPending += t.coPending;
          money.coApproved += t.coApproved;
          money.bcOutstanding += t.bcOutstanding;
          money.bcRecovered += t.bcRecovered;
        }
        money = Object.fromEntries(
          Object.entries(money).map(([k, v]) => [k, round2(v)])
        ) as typeof money;
      }

      // Crew hours this week (Mon–Sun), all sources.
      const ws = weekStartOf(today);
      const we = addCalendarDays(ws, 6);
      const hrs = activeIds.length
        ? await d
            .select({
              projectId: timeEntries.projectId,
              hours: sql<number>`sum(${timeEntries.hours})`,
            })
            .from(timeEntries)
            .where(
              and(
                inArray(timeEntries.projectId, activeIds),
                gte(timeEntries.entryDate, ws),
                lte(timeEntries.entryDate, we)
              )
            )
            .groupBy(timeEntries.projectId)
        : [];
      const byJob = hrs.map(h => ({
        projectId: h.projectId,
        code: code(h.projectId),
        name: pname(h.projectId),
        hours: round2(Number(h.hours)),
      }));

      return {
        today,
        counts: {
          active: active.length,
          draft: projRows.filter(p => p.state === "draft").length,
          onHold: projRows.filter(p => p.state === "on_hold").length,
          completed: projRows.filter(p => p.state === "completed").length,
        },
        scheduleRag,
        costRag,
        jobs,
        milestones: milestones.map(m => ({
          ...m,
          projectCode: code(m.projectId),
        })),
        delayedTasks: delayedTasks.map(t => ({
          ...t,
          projectCode: code(t.projectId),
        })),
        deliveries: riskyDeliveries,
        rfiAging,
        delayNotices,
        money,
        crewHours: {
          total: round2(byJob.reduce((a, b) => a + b.hours, 0)),
          byJob,
        },
        tons: await tonsCurve(activeIds, today),
      };
    }),

  /** Planned vs erected tons curve for one job. */
  jobTons: protectedProcedure
    .input(z.object({ projectId: zId }))
    .query(async ({ ctx, input }) => {
      const s = await sec(ctx);
      if (!hasJobModuleAccess(s) || !effectivePrivileges(s, input.projectId).has("project.view"))
        return [];
      return tonsCurve([input.projectId], await orgToday());
    }),
});
