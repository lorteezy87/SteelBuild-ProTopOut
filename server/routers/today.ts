import { and, eq, inArray, ne } from "drizzle-orm";
import { todaySummary } from "@shared/today";
import { isBallInCourt } from "@shared/ballInCourt";
import { deliveries, projects, tasks, wfApps, wfItems, wfStates } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { orgToday } from "../services/calendars";
import { itemLabel } from "../services/wf";

/** The PM's daily landing page: what is slipping, arriving, owed and about to lapse across active jobs. */
export const todayRouter = router({
  summary: protectedProcedure.query(async () => {
    const d = await db();
    const today = await orgToday();
    const active = await d.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(eq(projects.state, "active"));
    const ids = active.map(p => p.id);
    if (!ids.length) return { today, jobs: [], ...todaySummary({ today, sequences: [], deliveries: [], logs: [] }) };
    const [seqs, loads, logs] = await Promise.all([
      d
        .select({ id: tasks.id, projectId: tasks.projectId, name: tasks.name, scheduleHealth: tasks.scheduleHealth, projectedFinish: tasks.projectedFinish })
        .from(tasks)
        .where(and(inArray(tasks.projectId, ids), eq(tasks.kind, "sequence"))),
      d
        .select({ id: deliveries.id, projectId: deliveries.projectId, loadNumber: deliveries.loadNumber, status: deliveries.status, promisedDate: deliveries.promisedDate, needDate: deliveries.needDate })
        .from(deliveries)
        .where(inArray(deliveries.projectId, ids)),
      d
        .select({ item: wfItems, appKey: wfApps.key, numberPrefix: wfApps.numberPrefix })
        .from(wfItems)
        .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
        .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
        .where(and(inArray(wfItems.projectId, ids), ne(wfStates.category, "end"))),
    ]);
    const summary = todaySummary({
      today,
      sequences: seqs,
      deliveries: loads,
      logs: logs.map(l => ({
        id: l.item.id,
        projectId: l.item.projectId,
        appKey: l.appKey,
        label: `${itemLabel({ numberPrefix: l.numberPrefix }, l.item)} · ${l.item.title}`,
        open: true,
        ballInCourt: isBallInCourt(l.item.ballInCourt) ? l.item.ballInCourt : "us",
        dueDate: l.item.dueDate,
        slaDueAt: l.item.slaDueAt,
      })),
    });
    return { today, jobs: active, ...summary };
  }),
});
