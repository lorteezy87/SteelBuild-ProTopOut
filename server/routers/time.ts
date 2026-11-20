import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import { addCalendarDays } from "../engine/calendar";
import {
  jobRoles,
  projects,
  taskAssignments,
  tasks,
  timeCodes,
  timeEntries,
  users,
  wfItems,
  wfApps,
  wfStates,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getSetting } from "../bootstrap";
import { db } from "../db";
import {
  effectivePrivileges,
  type SecurityData,
} from "../security/access";
import {
  financialChecker,
  hasJobModuleAccess,
  loadSecurity,
  sec,
} from "../security/guard";
import { emit, notify } from "../services/events";
import { recomputeProject } from "../services/recompute";
import { bad, round2, zDay, zId } from "./_util";
import { getCalendar } from "../services/calendars";

export async function getTimeLock(): Promise<string | null> {
  const org = await getSetting<{ timeLockedThrough?: string | null }>(
    "org",
    {}
  );
  return org.timeLockedThrough || null;
}

export function assertTimeUnlocked(day: string, lockedThrough: string | null) {
  if (lockedThrough && day <= lockedThrough)
    bad(
      `Time is locked through ${lockedThrough}. Entries dated ${day} cannot be changed.`
    );
}

async function rates(userId: number) {
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

function weekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
}

async function loggableProjects(ctx: Parameters<typeof sec>[0]) {
  const s = await sec(ctx);
  const ids = new Set<number>();
  s.projectIds.forEach(pid => {
    if (effectivePrivileges(s, pid).has("project.view")) ids.add(pid);
  });
  return ids;
}

type ApprovalEntry = { projectId: number; userId: number };
/** Shared by queue visibility, required-approver resolution, and decisions. */
function canApprove(
  s: SecurityData,
  entry: ApprovalEntry,
  supervisorId: number | null
) {
  if (!hasJobModuleAccess(s)) return false;
  return s.isAdmin;
}

/** Resolve active, eligible PM + supervisor; an empty chain permits any eligible holder. */
async function approvalResolver() {
  const d = await db();
  const [people, jobs] = await Promise.all([
    d.select().from(users),
    d.select({ id: projects.id, managerId: projects.managerId }).from(projects),
  ]);
  const peopleById = new Map(people.map(u => [u.id, u]));
  const managers = new Map(jobs.map(p => [p.id, p.managerId]));
  const security = new Map<number, Promise<SecurityData>>();
  return {
    supervisorId: (entry: ApprovalEntry) =>
      peopleById.get(entry.userId)?.supervisorId ?? null,
    async required(entry: ApprovalEntry) {
      const supervisorId = peopleById.get(entry.userId)?.supervisorId ?? null;
      const ids = Array.from(
        new Set(
          [managers.get(entry.projectId), supervisorId].filter(
            (id): id is number => id != null
          )
        )
      );
      const out: { id: number; name: string }[] = [];
      for (const id of ids) {
        const u = peopleById.get(id);
        if (!u?.isActive) continue;
        if (!security.has(id)) security.set(id, loadSecurity(u));
        if (canApprove(await security.get(id)!, entry, supervisorId))
          out.push({ id, name: u.name ?? `User ${id}` });
      }
      return out;
    },
  };
}

const entryKey = (e: {
  projectId: number;
  taskId?: number | null;
  wfItemId?: number | null;
  timeCodeId?: number | null;
  entryDate: string;
}) =>
  `${e.projectId}:${e.taskId ?? ""}:${e.wfItemId ?? ""}:${e.timeCodeId ?? ""}:${e.entryDate}`;

export const timeRouter = router({
  week: protectedProcedure
    .input(z.object({ weekStart: zDay }))
    .query(async ({ ctx, input }) => {
      const d = await db();
      const days = weekDays(input.weekStart);
      const entries = await d
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, ctx.user.id),
            gte(timeEntries.entryDate, days[0]),
            lte(timeEntries.entryDate, days[6])
          )
        );
      const allowed = await loggableProjects(ctx);
      const assigned = await d
        .select({
          taskId: tasks.id,
          taskName: tasks.name,
          wbs: tasks.wbs,
          projectId: tasks.projectId,
        })
        .from(taskAssignments)
        .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(
          and(
            eq(taskAssignments.userId, ctx.user.id),
            eq(projects.state, "active")
          )
        );
      const projIds = Array.from(allowed);
      const projRows = projIds.length
        ? await d
            .select({
              id: projects.id,
              name: projects.name,
              code: projects.code,
              state: projects.state,
            })
            .from(projects)
            .where(inArray(projects.id, projIds))
        : [];
      const taskIds = Array.from(
        new Set(entries.map(e => e.taskId).filter((x): x is number => !!x))
      );
      const taskRows = taskIds.length
        ? await d
            .select({ id: tasks.id, name: tasks.name, wbs: tasks.wbs })
            .from(tasks)
            .where(inArray(tasks.id, taskIds))
        : [];
      const itemIds = Array.from(
        new Set(entries.map(e => e.wfItemId).filter((x): x is number => !!x))
      );
      const itemRows = itemIds.length
        ? await d
            .select({
              id: wfItems.id,
              title: wfItems.title,
              number: wfItems.number,
            })
            .from(wfItems)
            .where(inArray(wfItems.id, itemIds))
        : [];
      const loggableTasks = projIds.length
        ? await d
            .select({
              id: tasks.id,
              name: tasks.name,
              wbs: tasks.wbs,
              projectId: tasks.projectId,
            })
            .from(tasks)
            .where(
              and(inArray(tasks.projectId, projIds), eq(tasks.isSummary, false))
            )
        : [];
      const security = await sec(ctx);
      const fin = financialChecker(security);
      const logProjects = projIds.filter(pid =>
        effectivePrivileges(security, pid).has("log.view")
      );
      const loggableItems = logProjects.length
        ? await d
            .select({
              id: wfItems.id,
              projectId: wfItems.projectId,
              title: wfItems.title,
              number: wfItems.number,
              appKey: wfApps.key,
              prefix: wfApps.numberPrefix,
              category: wfStates.category,
            })
            .from(wfItems)
            .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
            .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
            .where(inArray(wfItems.projectId, logProjects))
        : [];
      const cal = await getCalendar(ctx.user.calendarId);
      const timeLockedThrough = await getTimeLock();
      return {
        days,
        entries: entries.map(e => ({
          ...e,
          costAmount: fin(e.projectId) ? e.costAmount : null,
          billAmount: fin(e.projectId) ? e.billAmount : null,
        })),
        projects: projRows,
        assigned,
        tasks: taskRows,
        items: itemRows,
        codes: await d
          .select()
          .from(timeCodes)
          .where(eq(timeCodes.isActive, true)),
        loggableTasks,
        loggableItems: loggableItems.filter(item => item.category !== "end"),
        capacity: days.map(day => (cal.isWorkDay(day) ? cal.hoursPerDay : 0)),
        timeLockedThrough,
      };
    }),

  /** Replace editable entries only; closed-period and posted entries are preserved. */
  saveWeek: protectedProcedure
    .input(
      z.object({
        weekStart: zDay,
        rows: z
          .array(
            z.object({
              projectId: zId,
              taskId: zId.nullable().optional(),
              wfItemId: zId.nullable().optional(),
              timeCodeId: zId.nullable().optional(),
              notes: z.string().max(500).nullable().optional(),
              hours: z.array(z.number().min(0).max(24)).length(7),
            })
          )
          .max(60),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const days = weekDays(input.weekStart);
      const timeLockedThrough = await getTimeLock();
      const allowed = await loggableProjects(ctx);
      for (const r of input.rows) {
        if (!allowed.has(r.projectId))
          bad("You can't log time to one of these jobs");
        r.hours.forEach((h, i) => {
          if (h > 0) assertTimeUnlocked(days[i], timeLockedThrough);
        });
      }
      const taskIds = input.rows
        .map(r => r.taskId)
        .filter((x): x is number => !!x);
      if (taskIds.length) {
        const ts = await d
          .select({ id: tasks.id, projectId: tasks.projectId })
          .from(tasks)
          .where(inArray(tasks.id, taskIds));
        for (const r of input.rows)
          if (
            r.taskId &&
            ts.find(t => t.id === r.taskId)?.projectId !== r.projectId
          )
            bad("Task does not belong to the selected job");
      }
      const codes = await d.select().from(timeCodes);
      const rate = await rates(ctx.user.id);
      const changes: {
        action: "add" | "update" | "delete";
        data: { id: number; projectId: number; entryDate: string };
      }[] = [];
      await d.transaction(async tx => {
        const existing = await tx
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.userId, ctx.user.id),
              gte(timeEntries.entryDate, days[0]),
              lte(timeEntries.entryDate, days[6])
            )
          )
          .for("update");
        const editable = existing.filter(
          e =>
            e.source === "timesheet" &&
            ["saved", "rejected"].includes(e.state) &&
            (!timeLockedThrough || e.entryDate > timeLockedThrough)
        );
        const locked = existing.filter(e => !editable.includes(e));
        for (let i = 0; i < 7; i++) {
          const total =
            input.rows.reduce((s, r) => s + r.hours[i], 0) +
            locked
              .filter(e => e.entryDate === days[i])
              .reduce((s, e) => s + e.hours, 0);
          if (total > 24) bad(`More than 24 hours on ${days[i]}`);
        }
        const remaining = new Set(editable.map(e => e.id));
        for (const r of input.rows)
          for (let i = 0; i < 7; i++) {
            const h = r.hours[i];
            if (!h) continue;
            const code = codes.find(c => c.id === r.timeCodeId);
            const values = {
              userId: ctx.user.id,
              projectId: r.projectId,
              taskId: r.taskId ?? null,
              wfItemId: r.wfItemId ?? null,
              timeCodeId: r.timeCodeId ?? null,
              entryDate: days[i],
              hours: h,
              notes: r.notes ?? null,
              state: "saved",
              source: "timesheet",
              approvals: [] as number[],
              rejectReason: null,
              approvedBy: null,
              approvedAt: null,
              costAmount: round2(h * rate.cost * (code?.multiplier ?? 1)),
              billAmount:
                code?.billable === false
                  ? 0
                  : round2(h * rate.bill * (code?.multiplier ?? 1)),
            };
            const before = editable.find(
              e => remaining.has(e.id) && entryKey(e) === entryKey(values)
            );
            if (before) {
              remaining.delete(before.id);
              await tx
                .update(timeEntries)
                .set(values)
                .where(eq(timeEntries.id, before.id));
              changes.push({
                action: "update",
                data: {
                  id: before.id,
                  projectId: r.projectId,
                  entryDate: days[i],
                },
              });
            } else {
              const [{ id }] = await tx
                .insert(timeEntries)
                .values(values)
                .$returningId();
              changes.push({
                action: "add",
                data: { id, projectId: r.projectId, entryDate: days[i] },
              });
            }
          }
        if (remaining.size) {
          await tx
            .delete(timeEntries)
            .where(inArray(timeEntries.id, Array.from(remaining)));
          for (const e of editable.filter(e => remaining.has(e.id)))
            changes.push({
              action: "delete",
              data: {
                id: e.id,
                projectId: e.projectId,
                entryDate: e.entryDate,
              },
            });
        }
      });
      for (const change of changes)
        await emit(ctx, "timeEntry", change.action, change.data);
      return { saved: changes.filter(c => c.action !== "delete").length };
    }),

  submitWeek: protectedProcedure
    .input(z.object({ weekStart: zDay }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const days = weekDays(input.weekStart);
      const timeLockedThrough = await getTimeLock();
      const rows = await d.transaction(async tx => {
        const rows = await tx
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.userId, ctx.user.id),
              gte(timeEntries.entryDate, days[0]),
              lte(timeEntries.entryDate, days[6]),
              eq(timeEntries.source, "timesheet"),
              inArray(timeEntries.state, ["saved", "rejected"])
            )
          )
          .for("update");
        if (!rows.length) bad("Nothing to submit for this week");
        for (const row of rows)
          assertTimeUnlocked(row.entryDate, timeLockedThrough);
        await tx
          .update(timeEntries)
          .set({
            state: "submitted",
            rejectReason: null,
            approvals: [],
            approvedBy: null,
            approvedAt: null,
          })
          .where(
            inArray(
              timeEntries.id,
              rows.map(r => r.id)
            )
          );
        return rows;
      });
      const resolver = await approvalResolver();
      const required = await Promise.all(rows.map(r => resolver.required(r)));
      await notify(
        ctx,
        required.flat().map(u => u.id),
        {
          title: `Timesheet submitted: ${ctx.user.name ?? "User"} — week of ${days[0]}`,
          link: "/approvals",
        }
      );
      for (const pid of Array.from(new Set(rows.map(r => r.projectId))))
        await recomputeProject(pid);
      for (const e of rows)
        await emit(ctx, "timeEntry", "update", {
          id: e.id,
          projectId: e.projectId,
          state: "submitted",
          approvals: [],
        });
      return { submitted: rows.length };
    }),

  approvals: protectedProcedure
    .input(
      z
        .object({
          state: z
            .enum(["submitted", "approved", "rejected"])
            .default("submitted"),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const d = await db();
      const s = await sec(ctx);
      if (!hasJobModuleAccess(s)) return [];
      const pids = s.projectIds.filter(
        pid =>
          effectivePrivileges(s, pid).has("time.approve") ||
          (input?.state === "approved" &&
            effectivePrivileges(s, pid).has("project.financials"))
      );
      const supervised = await d
        .select({ id: users.id })
        .from(users)
        .where(eq(users.supervisorId, ctx.user.id));
      const conds = [];
      if (pids.length) conds.push(inArray(timeEntries.projectId, pids));
      if (supervised.length)
        conds.push(
          inArray(
            timeEntries.userId,
            supervised.map(u => u.id)
          )
        );
      if (!conds.length) return [];
      const rows = await d
        .select({
          e: timeEntries,
          userName: users.name,
          supervisorId: users.supervisorId,
          projectName: projects.name,
          projectCode: projects.code,
          taskName: tasks.name,
        })
        .from(timeEntries)
        .innerJoin(users, eq(users.id, timeEntries.userId))
        .innerJoin(projects, eq(projects.id, timeEntries.projectId))
        .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .where(
          and(
            eq(timeEntries.state, input?.state ?? "submitted"),
            eq(timeEntries.source, "timesheet"),
            or(...conds)
          )
        )
        .limit(2000);
      const fin = financialChecker(s);
      const resolver = await approvalResolver();
      const timeLockedThrough = await getTimeLock();
      const visible = rows.filter(
        r =>
          canApprove(s, r.e, r.supervisorId) ||
          (r.e.state === "approved" && fin(r.e.projectId))
      );
      return Promise.all(
        visible.map(async r => {
          const requiredApprovers = await resolver.required(r.e);
          const approvals = r.e.approvals ?? [];
          const approvedByYou = approvals.includes(ctx.user.id);
          const locked =
            !!timeLockedThrough && r.e.entryDate <= timeLockedThrough;
          return {
            ...r.e,
            approvals,
            costAmount: fin(r.e.projectId) ? r.e.costAmount : null,
            billAmount: fin(r.e.projectId) ? r.e.billAmount : null,
            userName: r.userName,
            projectName: r.projectName,
            projectCode: r.projectCode,
            taskName: r.taskName,
            canInvoice: fin(r.e.projectId),
            canDecide:
              !locked &&
              !approvedByYou &&
              canApprove(s, r.e, r.supervisorId) &&
              (!requiredApprovers.length ||
                requiredApprovers.some(u => u.id === ctx.user.id)),
            requiredApprovers,
            awaitingApprovers: requiredApprovers.filter(
              u => !approvals.includes(u.id)
            ),
            approvedByYou,
            locked,
            timeLockedThrough,
          };
        })
      );
    }),

  decide: protectedProcedure
    .input(
      z.object({
        ids: z.array(zId).min(1).max(1000),
        action: z.enum(["approve", "reject"]),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action === "reject" && !input.reason?.trim())
        bad("A reason is required to reject time");
      const d = await db();
      const s = await sec(ctx);
      const resolver = await approvalResolver();
      const timeLockedThrough = await getTimeLock();
      const changed = await d.transaction(async tx => {
        const rows = await tx
          .select()
          .from(timeEntries)
          .where(inArray(timeEntries.id, input.ids))
          .for("update");
        if (rows.length !== new Set(input.ids).size)
          bad("Time entry not found");
        const decisions = [];
        for (const r of rows) {
          assertTimeUnlocked(r.entryDate, timeLockedThrough);
          if (r.state !== "submitted")
            bad("Only submitted entries can be approved or rejected");
          if (r.userId === ctx.user.id && !s.isAdmin)
            bad("You cannot approve your own time");
          if (!ctx.user.isActive || !canApprove(s, r, resolver.supervisorId(r)))
            bad("You are not an approver for some of these entries");
          const required = await resolver.required(r);
          if (required.length && !required.some(u => u.id === ctx.user.id))
            bad("This entry must be decided by its required approvers");
          const approvals =
            input.action === "reject"
              ? []
              : Array.from(new Set([...(r.approvals ?? []), ctx.user.id]));
          const complete =
            input.action === "approve" &&
            (!required.length || required.every(u => approvals.includes(u.id)));
          const state =
            input.action === "reject"
              ? "rejected"
              : complete
                ? "approved"
                : "submitted";
          decisions.push({ r, state, approvals });
        }
        for (const { r, state, approvals } of decisions)
          await tx
            .update(timeEntries)
            .set({
              state,
              approvals,
              approvedBy: state === "approved" ? ctx.user.id : null,
              approvedAt: state === "approved" ? new Date() : null,
              rejectReason:
                input.action === "reject" ? input.reason!.trim() : null,
            })
            .where(eq(timeEntries.id, r.id));
        return decisions;
      });
      const finished = changed.filter(c => c.state !== "submitted");
      await notify(ctx, Array.from(new Set(finished.map(c => c.r.userId))), {
        title:
          input.action === "approve"
            ? "Your time was approved"
            : "Your time was rejected",
        body: input.reason,
        link: "/timesheet",
      });
      for (const pid of Array.from(new Set(changed.map(c => c.r.projectId))))
        await recomputeProject(pid);
      for (const c of changed)
        await emit(ctx, "timeEntry", "update", {
          id: c.r.id,
          projectId: c.r.projectId,
          state: c.state,
          approvals: c.approvals,
        });
      return {
        count: changed.length,
        approved: changed.filter(c => c.state === "approved").length,
        awaiting: changed.filter(c => c.state === "submitted").length,
      };
    }),

  markInvoiced: protectedProcedure
    .input(z.object({ ids: z.array(zId).min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const s = await sec(ctx);
      const rows = await d
        .select()
        .from(timeEntries)
        .where(inArray(timeEntries.id, input.ids));
      for (const r of rows) {
        if (r.state !== "approved")
          bad("Only approved entries can be invoiced");
        if (!effectivePrivileges(s, r.projectId).has("project.financials"))
          bad("Missing privilege: project.financials");
      }
      await d
        .update(timeEntries)
        .set({ state: "invoiced" })
        .where(
          inArray(
            timeEntries.id,
            rows.map(r => r.id)
          )
        );
      for (const r of rows)
        await emit(ctx, "timeEntry", "update", {
          id: r.id,
          projectId: r.projectId,
          state: "invoiced",
        });
      return { count: rows.length };
    }),

  billable: protectedProcedure
    .input(z.object({ projectId: zId }))
    .query(async ({ ctx, input }) => {
      const s = await sec(ctx);
      if (!effectivePrivileges(s, input.projectId).has("project.financials"))
        bad("Missing privilege: project.financials");
      const d = await db();
      return d
        .select({
          e: timeEntries,
          userName: users.name,
          codeName: timeCodes.name,
        })
        .from(timeEntries)
        .innerJoin(users, eq(users.id, timeEntries.userId))
        .leftJoin(timeCodes, eq(timeCodes.id, timeEntries.timeCodeId))
        .where(
          and(
            eq(timeEntries.projectId, input.projectId),
            eq(timeEntries.state, "approved")
          )
        );
    }),
});
