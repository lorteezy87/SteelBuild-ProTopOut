import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { BALL_IN_COURT_LABELS, isBallInCourt } from "@shared/ballInCourt";
import { lookahead, plusDays, weekStartOf, weeklyTons } from "@shared/lookahead";
import { dailyReportProgress, dailyReports, deliveries, tasks, wfApps, wfItems, wfStates } from "../../drizzle/schema";
import { gcReportPhoto } from "@shared/photos";
import { weatherDayCalls, weatherDayCount } from "@shared/weather";
import { jobPhotos } from "./photos";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule } from "../security/guard";
import { itemLabel } from "../services/wf";
import { getProjectOr404, zDay, zId } from "./_util";

const MAX_PHOTOS = 12;

async function scheduleRows(projectId: number) {
  const d = await db();
  return d
    .select({ id: tasks.id, name: tasks.name, kind: tasks.kind, isSummary: tasks.isSummary, startDate: tasks.startDate, finishDate: tasks.finishDate, status: tasks.status, percentComplete: tasks.percentComplete })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.sortOrder));
}

/** Open RFIs / COs / delay notices on the job, with ball-in-court and due date. */
async function openLogs(projectId: number) {
  const d = await db();
  const rows = await d
    .select({ item: wfItems, key: wfApps.key, prefix: wfApps.numberPrefix, state: wfStates.name })
    .from(wfItems)
    .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
    .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
    .where(and(eq(wfItems.projectId, projectId), inArray(wfApps.key, ["rfi", "co", "delay"]), ne(wfStates.category, "end")))
    .orderBy(asc(wfItems.number));
  const out = (key: string) =>
    rows
      .filter(r => r.key === key)
      .map(r => ({
        id: r.item.id,
        label: itemLabel({ numberPrefix: r.prefix }, r.item),
        title: r.item.title,
        state: r.state,
        ballInCourt: isBallInCourt(r.item.ballInCourt) ? BALL_IN_COURT_LABELS[r.item.ballInCourt] : "—",
        dueDate: r.item.dueDate ?? (r.item.slaDueAt ? r.item.slaDueAt.toISOString().slice(0, 10) : null),
        costImpact: r.item.costImpact,
        scheduleImpactDays: r.item.scheduleImpactDays,
      }));
  return { rfis: out("rfi"), cos: out("co"), delays: out("delay") };
}

/** 3-week look-ahead and the weekly report a GC asks for. */
export const gcReportRouter = router({
  lookahead: protectedProcedure.input(z.object({ projectId: zId, from: zDay })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId, "project.view");
    const job = await getProjectOr404(input.projectId);
    const from = weekStartOf(input.from);
    return { job: { id: job.id, code: job.code, name: job.name }, from, ...lookahead(await scheduleRows(input.projectId), from, 3) };
  }),

  weekly: protectedProcedure.input(z.object({ projectId: zId, weekStart: zDay })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId, "project.view");
    const job = await getProjectOr404(input.projectId);
    const weekStart = weekStartOf(input.weekStart);
    const weekEnd = plusDays(weekStart, 6);
    const nextMonday = plusDays(weekStart, 7);
    const d = await db();
    const sched = await scheduleRows(input.projectId);
    const seqs = await d
      .select({ id: tasks.id, name: tasks.name, plannedTons: tasks.plannedTons, erectedTons: tasks.erectedTons })
      .from(tasks)
      .where(and(eq(tasks.projectId, input.projectId), eq(tasks.kind, "sequence"), eq(tasks.isSummary, false)))
      .orderBy(asc(tasks.sortOrder));
    const finals = await d
      .select({ id: dailyReports.id, reportDate: dailyReports.reportDate, weatherDelay: dailyReports.weatherDelay, weather: dailyReports.weather })
      .from(dailyReports)
      .where(and(eq(dailyReports.projectId, input.projectId), eq(dailyReports.status, "final"), gte(dailyReports.reportDate, weekStart), lte(dailyReports.reportDate, weekEnd)));
    // Weather days the PM marked on final reports: this week, and the job's count through the week's end.
    const toDate = await d
      .select({ reportDate: dailyReports.reportDate, weatherDelay: dailyReports.weatherDelay })
      .from(dailyReports)
      .where(and(eq(dailyReports.projectId, input.projectId), eq(dailyReports.status, "final"), lte(dailyReports.reportDate, weekEnd)));
    const finalIds = finals.map(f => f.id);
    // Every posted set line from final reports up to the week's end: "to date" is as of that week, not as of today.
    const posted = await d
      .select({ taskId: dailyReportProgress.taskId, stage: dailyReportProgress.stage, reportDate: dailyReportProgress.reportDate, tons: dailyReportProgress.tons })
      .from(dailyReportProgress)
      .innerJoin(dailyReports, eq(dailyReports.id, dailyReportProgress.reportId))
      .where(
        and(
          eq(dailyReportProgress.projectId, input.projectId),
          eq(dailyReportProgress.posted, true),
          eq(dailyReportProgress.stage, "set"),
          eq(dailyReports.status, "final"),
          lte(dailyReportProgress.reportDate, weekEnd),
        ),
      );
    const loads = await d
      .select()
      .from(deliveries)
      .where(eq(deliveries.projectId, input.projectId))
      .orderBy(asc(deliveries.needDate));
    const loadDate = (l: (typeof loads)[number]) => l.receivedDate ?? l.promisedDate ?? l.needDate;
    const inRange = (l: (typeof loads)[number], a: string, b: string) => {
      const x = loadDate(l);
      return x != null && x >= a && x <= b;
    };
    const loadRow = (l: (typeof loads)[number]) => ({ id: l.id, loadNumber: l.loadNumber, description: l.description, status: l.status, date: loadDate(l), tons: l.tons, pieces: l.pieces, sequenceTaskId: l.sequenceTaskId });
    // Job photos taken in the week plus that week's final reports — never photos on logs (incidents, punch, backcharges).
    const photos = (await jobPhotos(input.projectId))
      .filter(p => gcReportPhoto(p, { weekStart, weekEnd, finalReportIds: finalIds }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id)
      .slice(0, MAX_PHOTOS)
      .map(p => ({ id: p.id, name: p.caption || p.name, url: p.url, reportDate: p.day, estimated: p.estimated }));
    return {
      job: { id: job.id, code: job.code, name: job.name },
      weekStart,
      weekEnd,
      tons: weeklyTons(seqs, posted, weekStart, finals.length),
      lookahead: { from: nextMonday, ...lookahead(sched, nextMonday, 3) },
      ...(await openLogs(input.projectId)),
      deliveries: { thisWeek: loads.filter(l => inRange(l, weekStart, weekEnd)).map(loadRow), nextWeek: loads.filter(l => inRange(l, nextMonday, plusDays(nextMonday, 6))).map(loadRow) },
      photos,
      weather: {
        // One line per date (several crews' reports on a rain day are one weather day).
        days: [...weatherDayCalls(finals)]
          .filter((e): e is [string, "full" | "partial"] => e[1] === "full" || e[1] === "partial")
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, delay]) => ({ date, delay, weather: finals.find(f => f.reportDate === date && f.weather)?.weather ?? null })),
        toDate: weatherDayCount(toDate),
        allowed: job.weatherDaysAllowed,
      },
    };
  }),
});
