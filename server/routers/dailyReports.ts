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
  sequenceGateOverrides,
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
import { bad, getProjectOr404, notFound, round2, zDay, zId, zText } from "./_util";
import { TRPCError } from "@trpc/server";
import { SAVE_ERROR_MESSAGE, saveDecision } from "@shared/offline";
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
  stage: z.enum(STAGE_KEYS as [Stage, ...Stage[]]).default("set"),
});

/** Rows changed by a conditional UPDATE (mysql2 returns [ResultSetHeader, …]). */
const affected = (res: unknown) => Number((res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);

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


import { assertFinalizable, assertReopenable, crewTimeLines, progressByTask, reopenStartReset } from "@shared/dailyPosting";
import { crewInsertValues } from "../services/crew";
import { certGapsFor } from "../services/certs";
import { rateFor } from "../services/rates";
import { STAGE_KEYS, stageColumns, type Stage } from "@shared/stages";
import { plannedRateByDay, productionSeries } from "@shared/production";
import { missingGateReasons } from "@shared/gate";
import { gateRefusal, gatesFor, openItemsText } from "../services/gates";

export const dailyReportsRouter = router({
  /** Production chart: posted tons/pieces per day by foreman at one stage, against the planned daily rate of dated sequences. */
  production: protectedProcedure
    .input(z.object({ projectId: zId, stage: z.enum(STAGE_KEYS as [Stage, ...Stage[]]).default("set") }))
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.view");
      const d = await db();
      const rows = await d
        .select({ reportDate: dailyReportProgress.reportDate, foremanId: dailyReports.foremanId, tons: dailyReportProgress.tons, pieces: dailyReportProgress.pieces })
        .from(dailyReportProgress)
        .innerJoin(dailyReports, eq(dailyReports.id, dailyReportProgress.reportId))
        .where(
          and(
            eq(dailyReportProgress.projectId, input.projectId),
            eq(dailyReportProgress.stage, input.stage),
            eq(dailyReportProgress.posted, true),
            eq(dailyReports.status, "final"),
          ),
        );
      const seqs = await d
        .select({ plannedTons: tasks.plannedTons, plannedPieces: tasks.plannedPieces, durationDays: tasks.durationDays, startDate: tasks.startDate, finishDate: tasks.finishDate })
        .from(tasks)
        .where(and(eq(tasks.projectId, input.projectId), eq(tasks.kind, "sequence"), eq(tasks.isSummary, false)));
      // Plan line per day: only sequences scheduled on that day count (null when nothing is dated — unknown, not 0).
      const dated = seqs.filter(t => t.startDate && t.finishDate && t.durationDays > 0 && t.plannedTons > 0);
      const series = productionSeries(rows, { tonsPerDay: null, piecesPerDay: null });
      const planByDay = dated.length ? plannedRateByDay(dated, series.days.map(d => d.date)) : null;
      return { ...series, planByDay };
    }),

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
        certGaps: await certGapsFor(crew, r.reportDate),
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
        /** The PM's call; null/omitted = not recorded. */
        weatherDelay: z.enum(["none", "partial", "full"]).nullable().optional(),
        /** Offline replay: idempotency key for a new report, and the version the edit started from. */
        clientKey: z.string().uuid().optional(),
        /** This save's revision (a device sends a fresh one per save, so a resend of the same save is recognized). */
        saveRev: z.string().uuid().optional(),
        /** The revision the edit started from; present (even null) means "refuse if the report changed since". */
        baseRev: z.string().uuid().nullable().optional(),
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
      const { clientKey, saveRev: sentRev, baseRev, ...fields } = head;
      const [existing] = id
        ? await d.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1)
        : clientKey
          ? await d.select().from(dailyReports).where(eq(dailyReports.clientKey, clientKey)).limit(1)
          : [];
      const decision = saveDecision({ existing: existing ?? null, input: { id, projectId: input.projectId, clientKey, saveRev: sentRev, baseRev } });
      if ("error" in decision) {
        if (decision.error === "conflict") throw new TRPCError({ code: "CONFLICT", message: SAVE_ERROR_MESSAGE.conflict });
        if (decision.error === "missing") notFound("Daily report");
        bad(SAVE_ERROR_MESSAGE[decision.error]);
      }
      // This exact save already landed (its answer was lost): report success without writing it again.
      if (decision.action === "done") return { id: decision.id, saveRev: sentRev! };
      const saveRev = sentRev ?? randomUUID();
      let reportId = decision.action === "update" ? decision.id : undefined;
      if (reportId) {
        const id = reportId;
        await d
          .update(dailyReports)
          .set({ ...fields, saveRev, status: "draft", rejectReason: null })
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
            ...fields,
            clientKey: clientKey ?? null,
            saveRev,
            foremanId: fields.foremanId ?? ctx.user.id,
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
      const created = decision.action === "insert";
      if (created)
        await logActivity(ctx, {
          projectId: input.projectId,
          entityType: "dailyReport",
          entityId: rid,
          action: "create",
          summary: `started daily report for ${input.reportDate}`,
        });
      await emit(ctx, "dailyReport", created ? "add" : "update", {
        id: rid,
        projectId: input.projectId,
        reportDate: input.reportDate,
      });
      return { id: rid, saveRev };
    }),

  /** Finalizing posts crew hours as time entries, equipment cost, and erected tons/pieces to sequences. */
  finalize: protectedProcedure
    .input(z.object({ id: zId, gateReasons: z.record(z.string(), zText(500)).optional() }))
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
      // Sequences this report would start (set-stage steel on a not-started sequence) must clear the ready-to-erect gate or carry a reason.
      const setLines = await d
        .select({ taskId: dailyReportProgress.taskId })
        .from(dailyReportProgress)
        .where(and(eq(dailyReportProgress.reportId, r.id), eq(dailyReportProgress.stage, "set")));
      const startIds = Array.from(new Set(setLines.map(l => l.taskId)));
      const starting = startIds.length
        ? await d
            .select({ id: tasks.id, name: tasks.name })
            .from(tasks)
            .where(and(inArray(tasks.id, startIds), eq(tasks.kind, "sequence"), eq(tasks.status, "not_started")))
        : [];
      const gates = starting.length ? await gatesFor(starting.map(t => t.id)) : new Map();
      const reasons = input.gateReasons ?? {};
      const missing = missingGateReasons(
        starting.map(t => ({ taskId: t.id, name: t.name, status: gates.get(t.id)?.status ?? "unknown" })),
        reasons,
      );
      if (missing.length) gateRefusal(missing.map(m => ({ taskId: m.taskId, name: m.name, open: gates.get(m.taskId) ? openItemsText(gates.get(m.taskId)!) : "unknown" })));
      const overrides = starting
        .filter(t => gates.get(t.id)?.status !== "ready")
        .map(t => ({ taskId: t.id, name: t.name, reason: reasons[String(t.id)]!.trim() }));
      const codes = await d.select().from(timeCodes);
      const regular = codes.find(c => c.name.toLowerCase() === "regular") ?? codes[0];
      const overtime = codes.find(c => c.name.toLowerCase().startsWith("overtime")) ?? regular;
      const now = new Date();
      // One transaction, and the draft → final claim comes first: a double-click or retry finds the report already
      // final and posts nothing; a failure part-way rolls every posting back.
      const posted = await d.transaction(async tx => {
        const claimed = await tx
          .update(dailyReports)
          .set({ status: "final", approvedBy: ctx.user.id, approvedAt: now, saveRev: randomUUID() })
          .where(and(eq(dailyReports.id, r.id), eq(dailyReports.status, "draft")));
        if (affected(claimed) !== 1) bad("Report is already final");
        if (overrides.length)
          await tx.insert(sequenceGateOverrides).values(overrides.map(o => ({ taskId: o.taskId, reason: o.reason, source: "daily", sourceId: r.id })));
        const crew = await tx.select().from(dailyReportCrew).where(eq(dailyReportCrew.reportId, r.id));
        const progress = await tx.select().from(dailyReportProgress).where(eq(dailyReportProgress.reportId, r.id));
        let hours = 0;
        for (const l of crewTimeLines(crew)) {
          const rate = await rateFor(l.userId);
          const code = l.kind === "ot" ? overtime : regular;
          const mult = code?.multiplier ?? 1;
          hours += l.hours;
          await tx.insert(timeEntries).values({
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
          });
        }
        const byTask = progressByTask(progress);
        for (const add of Array.from(byTask.values())) {
          const [t] = await tx.select().from(tasks).where(eq(tasks.id, add.taskId)).limit(1).for("update");
          if (!t) continue;
          if (add.stage !== "set") {
            // Later stages only add their own quantities; starting and completing a sequence follow "set" (hung) steel.
            const c = stageColumns(add.stage);
            await tx
              .update(tasks)
              .set({ [c.tons]: round2(t[c.tons] + add.tons), [c.pieces]: t[c.pieces] + add.pieces })
              .where(eq(tasks.id, t.id));
            continue;
          }
          const erectedTons = round2(t.erectedTons + add.tons);
          // Sequences that reach planned tonnage are complete.
          const complete = t.kind === "sequence" && t.plannedTons > 0 && erectedTons >= t.plannedTons - 1e-6 && t.status !== "done";
          await tx
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
        if (progress.length) await tx.update(dailyReportProgress).set({ posted: true }).where(eq(dailyReportProgress.reportId, r.id));
        const totals = Array.from(byTask.values()).filter(p => p.stage === "set");
        return { hours: round2(hours), tons: round2(totals.reduce((s, p) => s + p.tons, 0)), pieces: totals.reduce((s, p) => s + p.pieces, 0), crew: crew.length };
      });
      await recomputeProject(r.projectId);
      for (const o of overrides)
        await logActivity(ctx, { projectId: r.projectId, entityType: "task", entityId: o.taskId, action: "gate", summary: `started "${o.name}" with the ready-to-erect gate open: ${o.reason}` });
      await logActivity(ctx, {
        projectId: r.projectId,
        entityType: "dailyReport",
        entityId: r.id,
        action: "finalize",
        summary: `finalized daily report ${r.reportDate} (${posted.crew} crew, ${posted.tons} tons)`,
      });
      await emit(ctx, "dailyReport", "update", { id: r.id, projectId: r.projectId, status: "final" });
      return { posted: { hours: posted.hours, tons: posted.tons, pieces: posted.pieces } };
    }),

  /** Reverse a finalized report (removes posted time and progress) so it can be corrected. */
  reopen: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReport(input.id);
      await requireJobModule(ctx, r.projectId, "dailyreport.approve");
      if (r.status !== "final") bad("Only final reports can be reopened");
      const timeLockedThrough = await getTimeLock();
      assertTimeUnlocked(r.reportDate, timeLockedThrough);
      const d = await db();
      await d.transaction(async tx => {
        const claimed = await tx
          .update(dailyReports)
          .set({ status: "draft", approvedBy: null, approvedAt: null, saveRev: randomUUID() })
          .where(and(eq(dailyReports.id, r.id), eq(dailyReports.status, "final")));
        if (affected(claimed) !== 1) bad("Only final reports can be reopened");
        const postedTime = await tx
          .select()
          .from(timeEntries)
          .where(and(eq(timeEntries.source, "daily_report"), eq(timeEntries.sourceId, r.id)))
          .for("update");
        try {
          assertReopenable(postedTime);
        } catch (e) {
          bad(e instanceof Error ? e.message : String(e));
        }
        for (const e of postedTime) assertTimeUnlocked(e.entryDate, timeLockedThrough);
        await tx.delete(timeEntries).where(and(eq(timeEntries.source, "daily_report"), eq(timeEntries.sourceId, r.id)));
        const progress = await tx.select().from(dailyReportProgress).where(eq(dailyReportProgress.reportId, r.id));
        for (const p of progress.filter(x => x.posted)) {
          const [t] = await tx.select().from(tasks).where(eq(tasks.id, p.taskId)).limit(1).for("update");
          if (!t) continue;
          if (p.stage && p.stage !== "set") {
            const c = stageColumns(p.stage as Stage);
            await tx
              .update(tasks)
              .set({ [c.tons]: Math.max(0, round2(t[c.tons] - p.tons)), [c.pieces]: Math.max(0, t[c.pieces] - p.pieces) })
              .where(eq(tasks.id, t.id));
            await tx.update(dailyReportProgress).set({ posted: false }).where(eq(dailyReportProgress.id, p.id));
            continue;
          }
          const tons = Math.max(0, round2(t.erectedTons - p.tons));
          const reopened = t.status === "done" && tons < t.plannedTons;
          await tx
            .update(tasks)
            .set({
              erectedTons: tons,
              erectedPieces: Math.max(0, t.erectedPieces - p.pieces),
              status: reopened ? "in_progress" : t.status,
              actualFinish: reopened ? null : t.actualFinish,
            })
            .where(eq(tasks.id, t.id));
          await tx.update(dailyReportProgress).set({ posted: false }).where(eq(dailyReportProgress.id, p.id));
        }
        // A sequence this report started goes back to not started when no posted set steel remains on it, so the
        // ready-to-erect gate applies again; the gate overrides this report recorded go with it.
        const setTaskIds = Array.from(new Set(progress.filter(x => x.posted && (x.stage ?? "set") === "set").map(x => x.taskId)));
        for (const taskId of setTaskIds) {
          const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).for("update");
          if (!t) continue;
          const [other] = await tx
            .select({ id: dailyReportProgress.id })
            .from(dailyReportProgress)
            .where(and(eq(dailyReportProgress.taskId, taskId), eq(dailyReportProgress.stage, "set"), eq(dailyReportProgress.posted, true)))
            .limit(1);
          const reset = reopenStartReset({ status: t.status, actualStart: t.actualStart, erectedTonsAfter: t.erectedTons, otherPostedSet: !!other }, r.reportDate);
          if (reset) await tx.update(tasks).set(reset).where(eq(tasks.id, taskId));
        }
        await tx.delete(sequenceGateOverrides).where(and(eq(sequenceGateOverrides.source, "daily"), eq(sequenceGateOverrides.sourceId, r.id)));
      });
      await recomputeProject(r.projectId);
      await logActivity(ctx, {
        projectId: r.projectId,
        entityType: "dailyReport",
        entityId: r.id,
        action: "reopen",
        summary: `reopened daily report ${r.reportDate}`,
      });
      await emit(ctx, "dailyReport", "update", { id: r.id, projectId: r.projectId, status: "draft" });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReport(input.id);
      await requireJobModule(ctx, r.projectId, "dailyreport.create");
      if (r.status === "final")
        bad("Reopen the report before deleting it");
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
