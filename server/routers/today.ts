import { and, eq, inArray, ne } from "drizzle-orm";
import { GATE_LOOKAHEAD_DAYS, todaySummary } from "@shared/today";
import { gateStatusFor } from "../services/gates";

const addCalendarDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
import { isBallInCourt } from "@shared/ballInCourt";
import { certifications, deliveries, projects, tasks, users, wfApps, wfItems, wfStates } from "../../drizzle/schema";
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
    // Certifications belong to crew, not jobs, so they show even with no active job.
    const certs = (
      await d
        .select({ id: certifications.id, userId: certifications.userId, name: users.name, certType: certifications.certType, expiresOn: certifications.expiresOn })
        .from(certifications)
        .innerJoin(users, eq(users.id, certifications.userId))
        .where(eq(users.isActive, true))
    ).map(c => ({ ...c, name: c.name ?? `#${c.userId}` }));
    if (!ids.length) return { today, jobs: [], ...todaySummary({ today, sequences: [], deliveries: [], logs: [], certs }) };
    const [seqs, loads, logs] = await Promise.all([
      d
        .select({ id: tasks.id, projectId: tasks.projectId, name: tasks.name, scheduleHealth: tasks.scheduleHealth, projectedFinish: tasks.projectedFinish, status: tasks.status, startDate: tasks.startDate, isSummary: tasks.isSummary })
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
    // Only sequences about to start need their gate computed.
    const horizon = addCalendarDays(today, GATE_LOOKAHEAD_DAYS);
    const candidates = seqs.filter(s => !s.isSummary && s.status === "not_started" && s.startDate != null && s.startDate <= horizon);
    const gates = await gateStatusFor(candidates.map(s => s.id));
    const summary = todaySummary({
      today,
      certs,
      sequences: seqs,
      gates: candidates.map(s => ({ id: s.id, projectId: s.projectId, name: s.name, status: s.status, startDate: s.startDate, gate: gates.get(s.id) ?? "unknown" })),
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
