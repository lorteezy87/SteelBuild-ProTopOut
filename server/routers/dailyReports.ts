import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  dailyReportCrew,
  dailyReportEquipment,
  dailyReportProgress,
  dailyReports,
  equipment,
  jobRoles,
  projects,
  tasks,
  timeCodes,
  timeEntries,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { effectivePrivileges } from "../security/access";
import {
  hasJobModuleAccess,
  hasPriv,
  requireJobModule,
  sec,
} from "../security/guard";
import { emit, logActivity, notify } from "../services/events";
import { recomputeProject } from "../services/recompute";
import { bad, getProjectOr404, round2, zDay, zId, zText } from "./_util";
import { assertTimeUnlocked, getTimeLock } from "./time";

const crewLine = z.object({
  userId: zId,
  jobRoleId: zId.nullable().optional(),
  taskId: zId.nullable().optional(),
  stHours: z.number().min(0).max(24),
  otHours: z.number().min(0).max(24),
});
const equipLine = z.object({
  equipmentId: zId,
  operatingHours: z.number().min(0).max(24),
  standbyHours: z.number().min(0).max(24),
});
const progressLine = z.object({
  taskId: zId,
  tons: z.number().min(0).max(100000),
  pieces: z.number().int().min(0).max(100000),
  note: zText(500).nullable().optional(),
});

async function loadReport(id: number) {
  const d = await db();
  const [r] = await d
    .select()
    .from(dailyReports)
    .where(eq(dailyReports.id, id))
    .limit(1);
  if (!r) bad("Daily report not found");
  return r;
}

async function rateFor(userId: number) {
  const d = await db();
  const [u] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
  let cost = u?.costRate ?? null;
  let bill = u?.billRate ?? null;
  if ((cost == null || bill == null) && u?.jobRoleId) {
    const [jr] = await d
      .select()
      .from(jobRoles)
      .where(eq(jobRoles.id, u.jobRoleId))
      .limit(1);
    cost = cost ?? jr?.costRate ?? 0;
    bill = bill ?? jr?.billRate ?? 0;
  }
  return { cost: cost ?? 0, bill: bill ?? 0 };
}

import { assertFinalizable, crewTimeLines, progressByTask } from "@shared/dailyPosting";
import { crewInsertValues } from "../services/crew";

export const dailyReportsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: zId }))
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.view");
      const d = await db();
      const rows = await d
        .select()
        .from(dailyReports)
        .where(eq(dailyReports.projectId, input.projectId))
        .orderBy(desc(dailyReports.reportDate));
      const ids = rows.map(r => r.id);
      const crew = ids.length
        ? await d
            .select()
            .from(dailyReportCrew)
            .where(inArray(dailyReportCrew.reportId, ids))
        : [];
      const prog = ids.length
        ? await d
            .select()
            .from(dailyReportProgress)
            .where(inArray(dailyReportProgress.reportId, ids))
        : [];
      return rows.map(r => ({
        ...r,
        crewCount: crew.filter(c => c.reportId === r.id).length,
        crewHours: round2(
          crew
            .filter(c => c.reportId === r.id)
            .reduce((s, c) => s + c.stHours + c.otHours, 0)
        ),
        tons: round2(
          prog.filter(p => p.reportId === r.id).reduce((s, p) => s + p.tons, 0)
        ),
        pieces: prog
          .filter(p => p.reportId === r.id)
          .reduce((s, p) => s + p.pieces, 0),
      }));
    }),

  /** Submitted reports awaiting approval on jobs where the user holds dailyreport.approve. */
  get: protectedProcedure
    .input(z.object({ id: zId }))
    .query(async ({ ctx, input }) => {
      const r = await loadReport(input.id);
      await requireJobModule(ctx, r.projectId, "project.view");
      const d = await db();
      const [crew, equip, progress] = await Promise.all([
        d
          .select()
          .from(dailyReportCrew)
          .where(eq(dailyReportCrew.reportId, r.id)),
        d
          .select()
          .from(dailyReportEquipment)
          .where(eq(dailyReportEquipment.reportId, r.id)),
        d
          .select()
          .from(dailyReportProgress)
          .where(eq(dailyReportProgress.reportId, r.id)),
      ]);
      const fin = await hasPriv(ctx, "project.financials", r.projectId);
      return {
        report: r,
        crew,
        equipment: equip.map(e => ({ ...e, cost: fin ? e.cost : null })),
        progress,
        canApprove: await hasPriv(ctx, "dailyreport.approve", r.projectId),
        canEdit:
          (await hasPriv(ctx, "dailyreport.create", r.projectId)) &&
          r.status === "draft",
      };
    }),

  save: protectedProcedure
    .input(
      z.object({
        id: zId.optional(),
        projectId: zId,
        reportDate: zDay,
        foremanId: zId.nullable().optional(),
        weather: zText(128).nullable().optional(),
        temperature: zText(32).nullable().optional(),
        workPerformed: z.string().max(20000).nullable().optional(),
        safetyNotes: z.string().max(20000).nullable().optional(),
        delayNotes: z.string().max(20000).nullable().optional(),
        crew: z.array(crewLine).max(200),
        equipment: z.array(equipLine).max(50),
        progress: z.array(progressLine).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "dailyreport.create");
      const d = await db();
      const { id, crew, equipment: eqLines, progress, ...head } = input;
      if (progress.length) {
        const ts = await d
          .select({ id: tasks.id, projectId: tasks.projectId })
          .from(tasks)
          .where(
            inArray(
              tasks.id,
              progress.map(p => p.taskId)
            )
          );
        if (
          ts.some(t => t.projectId !== input.projectId) ||
          ts.length !== new Set(progress.map(p => p.taskId)).size
        ) {
          bad("Progress lines must reference sequences on this job");
        }
      }
      let reportId = id;
      if (id) {
        const r = await loadReport(id);
        if (r.projectId !== input.projectId)
          bad("Report belongs to another job");
        if (r.status !== "draft")
          bad("Only draft reports can be edited");
        await d
          .update(dailyReports)
          .set({ ...head, status: "draft", rejectReason: null })
          .where(eq(dailyReports.id, id));
        await d.delete(dailyReportCrew).where(eq(dailyReportCrew.reportId, id));
        await d
          .delete(dailyReportEquipment)
          .where(eq(dailyReportEquipment.reportId, id));
        await d
          .delete(dailyReportProgress)
          .where(eq(dailyReportProgress.reportId, id));
      } else {
        [{ id: reportId }] = await d
          .insert(dailyReports)
          .values({
            ...head,
            foremanId: head.foremanId ?? ctx.user.id,
            createdBy: ctx.user.id,
          })
          .$returningId();
      }
      const rid = reportId!;
      if (crew.length)
        await d
          .insert(dailyReportCrew)
          .values(
            crew.map(c => ({
              ...c,
              reportId: rid,
              jobRoleId: c.jobRoleId ?? null,
              taskId: c.taskId ?? null,
            }))
          );
      if (eqLines.length) {
        const eqRows = await d
          .select()
          .from(equipment)
          .where(
            inArray(
              equipment.id,
              eqLines.map(e => e.equipmentId)
            )
          );
        await d.insert(dailyReportEquipment).values(
          eqLines.map(e => {
            const row = eqRows.find(x => x.id === e.equipmentId);
            const cost = row
              ? e.operatingHours * row.hourlyRate +
                e.standbyHours * row.standbyRate
              : 0;
            return { ...e, reportId: rid, cost: round2(cost) };
          })
        );
      }
      if (progress.length) {
        await d
          .insert(dailyReportProgress)
          .values(
            progress.map(p => ({
              ...p,
              note: p.note ?? null,
              reportId: rid,
              projectId: input.projectId,
              reportDate: input.reportDate,
            }))
          );
      }
      if (!id)
        await logActivity(ctx, {
          projectId: input.projectId,
          entityType: "dailyReport",
          entityId: rid,
          action: "create",
          summary: `started daily report for ${input.reportDate}`,
        });
      await emit(ctx, "dailyReport", id ? "update" : "add", {
        id: rid,
        projectId: input.projectId,
        reportDate: input.reportDate,
      });
      return { id: rid };
    }),

  /** Finalizing posts crew hours as time entries, equipment cost, and erected tons/pieces to sequences. */
  finalize: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReport(input.id);
      await requireJobModule(ctx, r.projectId, "dailyreport.approve");
      try {
        assertFinalizable(r.status);
      } catch (e) {
        bad(e instanceof Error ? e.message : String(e));
      }
      assertTimeUnlocked(r.reportDate, await getTimeLock());
      const d = await db();
      const crew = await d.select().from(dailyReportCrew).where(eq(dailyReportCrew.reportId, r.id));
      const progress = await d.select().from(dailyReportProgress).where(eq(dailyReportProgress.reportId, r.id));
      const codes = await d.select().from(timeCodes);
      const regular = codes.find(c => c.name.toLowerCase() === "regular") ?? codes[0];
      const overtime = codes.find(c => c.name.toLowerCase().startsWith("overtime")) ?? regular;
      const now = new Date();
      let hours = 0;
      for (const l of crewTimeLines(crew)) {
        const rate = await rateFor(l.userId);
        const code = l.kind === "ot" ? overtime : regular;
        const mult = code?.multiplier ?? 1;
        hours += l.hours;
        const [{ id: entryId }] = await d
          .insert(timeEntries)
          .values({
            userId: l.userId,
            projectId: r.projectId,
            taskId: l.taskId,
            timeCodeId: code?.id ?? null,
            entryDate: r.reportDate,
            hours: l.hours,
            notes: `Daily report ${r.reportDate}`,
            state: "recorded",
            source: "daily_report",
            sourceId: r.id,
            costAmount: round2(l.hours * rate.cost * mult),
            billAmount: code?.billable === false ? 0 : round2(l.hours * rate.bill * mult),
            approvedBy: ctx.user.id,
            approvedAt: now,
          })
          .$returningId();
        await emit(ctx, "timeEntry", "add", { id: entryId, projectId: r.projectId, entryDate: r.reportDate, source: "daily_report", sourceId: r.id, state: "recorded" });
      }
      const byTask = progressByTask(progress);
      for (const [taskId, add] of Array.from(byTask)) {
        const [t] = await d.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!t) continue;
        const erectedTons = round2(t.erectedTons + add.tons);
        // Sequences that reach planned tonnage are complete.
        const complete = t.kind === "sequence" && t.plannedTons > 0 && erectedTons >= t.plannedTons - 1e-6 && t.status !== "done";
        await d
          .update(tasks)
          .set({
            erectedTons,
            erectedPieces: t.erectedPieces + add.pieces,
            actualStart: t.actualStart ?? r.reportDate,
            status: complete ? "done" : t.status === "not_started" ? "in_progress" : t.status,
            ...(complete ? { percentComplete: 100, actualFinish: r.reportDate } : {}),
          })
          .where(eq(tasks.id, t.id));
      }
      if (progress.length) await d.update(dailyReportProgress).set({ posted: true }).where(eq(dailyReportProgress.reportId, r.id));
      await d.update(dailyReports).set({ status: "final", approvedBy: ctx.user.id, approvedAt: now }).where(eq(dailyReports.id, r.id));
      await recomputeProject(r.projectId);
      const tons = round2(Array.from(byTask.values()).reduce((s, p) => s + p.tons, 0));
      const pieces = Array.from(byTask.values()).reduce((s, p) => s + p.pieces, 0);
      await logActivity(ctx, {
        projectId: r.projectId,
        entityType: "dailyReport",
        entityId: r.id,
        action: "finalize",
        summary: `finalized daily report ${r.reportDate} (${crew.length} crew, ${tons} tons)`,
      });
      await emit(ctx, "dailyReport", "update", { id: r.id, projectId: r.projectId, status: "final" });
      return { posted: { hours: round2(hours), tons, pieces } };
    }),

  /** Reverse a finalized report (removes posted time and progress) so it can be corrected. */
  reopen: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReport(input.id);
      await requireJobModule(ctx, r.projectId, "dailyreport.approve");
      if (r.status !== "final") bad("Only final reports can be reopened");
      assertTimeUnlocked(r.reportDate, await getTimeLock());
      const d = await db();
      const postedTime = await d
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.source, "daily_report"),
            eq(timeEntries.sourceId, r.id)
          )
        );
      const timeLockedThrough = await getTimeLock();
      for (const e of postedTime)
        assertTimeUnlocked(e.entryDate, timeLockedThrough);
      await d
        .delete(timeEntries)
        .where(
          and(
            eq(timeEntries.source, "daily_report"),
            eq(timeEntries.sourceId, r.id)
          )
        );
      for (const e of postedTime)
        await emit(ctx, "timeEntry", "delete", {
          id: e.id,
          projectId: e.projectId,
          sourceId: r.id,
        });
      const progress = await d
        .select()
        .from(dailyReportProgress)
        .where(eq(dailyReportProgress.reportId, r.id));
      for (const p of progress.filter(x => x.posted)) {
        const [t] = await d
          .select()
          .from(tasks)
          .where(eq(tasks.id, p.taskId))
          .limit(1);
        if (!t) continue;
        const tons = Math.max(0, round2(t.erectedTons - p.tons));
        await d
          .update(tasks)
          .set({
            erectedTons: tons,
            erectedPieces: Math.max(0, t.erectedPieces - p.pieces),
            status:
              t.status === "done" && tons < t.plannedTons
                ? "in_progress"
                : t.status,
            actualFinish:
              t.status === "done" && tons < t.plannedTons
                ? null
                : t.actualFinish,
          })
          .where(eq(tasks.id, t.id));
        await d
          .update(dailyReportProgress)
          .set({ posted: false })
          .where(eq(dailyReportProgress.id, p.id));
      }
      await d
        .update(dailyReports)
        .set({ status: "draft", approvedBy: null, approvedAt: null })
        .where(eq(dailyReports.id, r.id));
      await recomputeProject(r.projectId);
      await logActivity(ctx, {
        projectId: r.projectId,
        entityType: "dailyReport",
        entityId: r.id,
        action: "reopen",
        summary: `reopened daily report ${r.reportDate}`,
      });
      await emit(ctx, "dailyReport", "update", {
        id: r.id,
        projectId: r.projectId,
        status: "draft",
      });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReport(input.id);
      await requireJobModule(ctx, r.projectId, "dailyreport.create");
      if (r.status === "final")
        bad("Reopen or reject the report before deleting it");
      const d = await db();
      await d.delete(dailyReportCrew).where(eq(dailyReportCrew.reportId, r.id));
      await d
        .delete(dailyReportEquipment)
        .where(eq(dailyReportEquipment.reportId, r.id));
      await d
        .delete(dailyReportProgress)
        .where(eq(dailyReportProgress.reportId, r.id));
      await d.delete(dailyReports).where(eq(dailyReports.id, r.id));
      await emit(ctx, "dailyReport", "delete", {
        id: r.id,
        projectId: r.projectId,
      });
      return { ok: true };
    }),

  /** Field shortcut: add a crew member as a Passive (no-login) resource. */
  addCrewMember: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        name: zText(200).min(1),
        jobRoleId: zId.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "dailyreport.create");
      const d = await db();
      const [{ id }] = await d
        .insert(users)
        .values(crewInsertValues({ name: input.name, jobRoleId: input.jobRoleId ?? null }))
        .$returningId();
      return { id };
    }),
});
