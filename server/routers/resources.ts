import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { addCalendarDays } from "../engine/calendar";
import {
  equipment,
  jobRoles,
  projects,
  taskAssignments,
  tasks,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasJobModuleAccess, sec } from "../security/guard";
import { can, effectivePrivileges } from "../security/access";
import { getCalendar } from "../services/calendars";
import { bad, round2, zDay, zId } from "./_util";

type WeekCell = { hours: number };

export const resourcesRouter = router({
  /**
   * Weekly workload: allocated hours vs capacity per person, unassigned job-role
   * demand, and equipment days. Effort-driven tasks spread effort evenly over
   * their work days; others use allocation % × calendar hours.
   */
  workload: protectedProcedure
    .input(
      z.object({
        weekStart: zDay,
        weeks: z.number().int().min(1).max(26).default(8),
        jobRoleId: zId.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const s = await sec(ctx);
      if (!hasJobModuleAccess(s))
        bad("Your access type only includes Logs and Timesheets");
      if (!can(s, "resource.view", null) && !s.isAdmin)
        bad("You don't have access to resource workload");
      const visibleIds = s.projectIds.filter(pid =>
        effectivePrivileges(s, pid).has("project.view")
      );
      const d = await db();
      const weeks = Array.from({ length: input.weeks }, (_, i) =>
        addCalendarDays(input.weekStart, i * 7)
      );
      const rangeEnd = addCalendarDays(input.weekStart, input.weeks * 7 - 1);

      const rows = visibleIds.length
        ? await d
            .select({
              a: taskAssignments,
              t: tasks,
              p: {
                id: projects.id,
                code: projects.code,
                name: projects.name,
                calendarId: projects.calendarId,
              },
            })
            .from(taskAssignments)
            .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
            .innerJoin(projects, eq(projects.id, tasks.projectId))
            .where(
              and(
                eq(projects.state, "active"),
                ne(tasks.status, "done"),
                eq(tasks.isSummary, false),
                inArray(projects.id, visibleIds)
              )
            )
        : [];
      const live = rows.filter(
        r =>
          r.t.startDate &&
          r.t.finishDate &&
          r.t.finishDate >= input.weekStart &&
          r.t.startDate <= rangeEnd
      );

      const allocSum = new Map<number, number>();
      for (const r of live)
        if (!r.a.equipmentId)
          allocSum.set(r.t.id, (allocSum.get(r.t.id) ?? 0) + r.a.allocationPct);

      const hoursByWeek = async (r: (typeof live)[number]) => {
        const cal = await getCalendar(r.p.calendarId);
        const taskDays = Math.max(
          1,
          cal.workDaysBetween(r.t.startDate!, r.t.finishDate!)
        );
        const remaining = 1 - Math.min(100, r.t.percentComplete) / 100;
        const perDay =
          r.t.effortHours > 0
            ? ((r.t.effortHours * remaining) / taskDays) *
              (r.a.allocationPct / Math.max(1, allocSum.get(r.t.id) ?? 100))
            : cal.hoursPerDay * (r.a.allocationPct / 100);
        return weeks.map(ws => {
          const we = addCalendarDays(ws, 6);
          const a = r.t.startDate! > ws ? r.t.startDate! : ws;
          const b = r.t.finishDate! < we ? r.t.finishDate! : we;
          const days = b >= a ? cal.workDaysBetween(a, b) : 0;
          return { days, hours: round2(days * perDay) };
        });
      };

      const allUsers = await d
        .select()
        .from(users)
        .where(eq(users.isActive, true));
      const roleRows = await d.select().from(jobRoles);
      const people = new Map<
        number,
        {
          userId: number;
          name: string;
          jobRoleId: number | null;
          accessType: string;
          capacity: number[];
          allocated: number[];
          tasks: {
            taskId: number;
            name: string;
            projectId: number;
            projectCode: string | null;
            hours: number[];
          }[];
        }
      >();
      for (const u of allUsers) {
        if (u.accessType === "timesheet") continue;
        if (input.jobRoleId && u.jobRoleId !== input.jobRoleId) continue;
        const cal = await getCalendar(u.calendarId);
        people.set(u.id, {
          userId: u.id,
          name: u.name ?? `User ${u.id}`,
          jobRoleId: u.jobRoleId,
          accessType: u.accessType,
          capacity: weeks.map(ws =>
            round2(
              cal.workDaysBetween(ws, addCalendarDays(ws, 6)) * cal.hoursPerDay
            )
          ),
          allocated: weeks.map(() => 0),
          tasks: [],
        });
      }
      const roleDemand = new Map<
        number,
        {
          jobRoleId: number;
          name: string;
          hours: number[];
          tasks: { taskId: number; name: string; projectCode: string | null }[];
        }
      >();
      const equip = new Map<
        number,
        {
          equipmentId: number;
          name: string;
          days: number[];
          tasks: {
            taskId: number;
            name: string;
            projectCode: string | null;
            days: number[];
          }[];
        }
      >();
      const eqRows = await d.select().from(equipment);

      for (const r of live) {
        const wk = await hoursByWeek(r);
        if (r.a.userId) {
          const p = people.get(r.a.userId);
          if (!p) continue;
          wk.forEach(
            (c, i) => (p.allocated[i] = round2(p.allocated[i] + c.hours))
          );
          p.tasks.push({
            taskId: r.t.id,
            name: r.t.name,
            projectId: r.p.id,
            projectCode: r.p.code,
            hours: wk.map(c => c.hours),
          });
        } else if (r.a.jobRoleId) {
          if (input.jobRoleId && r.a.jobRoleId !== input.jobRoleId) continue;
          const jr = roleRows.find(x => x.id === r.a.jobRoleId);
          if (!roleDemand.has(r.a.jobRoleId))
            roleDemand.set(r.a.jobRoleId, {
              jobRoleId: r.a.jobRoleId,
              name: jr?.name ?? "Role",
              hours: weeks.map(() => 0),
              tasks: [],
            });
          const g = roleDemand.get(r.a.jobRoleId)!;
          wk.forEach(
            (c: WeekCell, i) => (g.hours[i] = round2(g.hours[i] + c.hours))
          );
          g.tasks.push({
            taskId: r.t.id,
            name: r.t.name,
            projectCode: r.p.code,
          });
        } else if (r.a.equipmentId) {
          const e = eqRows.find(x => x.id === r.a.equipmentId);
          if (!equip.has(r.a.equipmentId))
            equip.set(r.a.equipmentId, {
              equipmentId: r.a.equipmentId,
              name: e?.name ?? "Equipment",
              days: weeks.map(() => 0),
              tasks: [],
            });
          const g = equip.get(r.a.equipmentId)!;
          wk.forEach((c, i) => (g.days[i] += c.days));
          g.tasks.push({
            taskId: r.t.id,
            name: r.t.name,
            projectCode: r.p.code,
            days: wk.map(c => c.days),
          });
        }
      }

      const list = Array.from(people.values()).map(p => ({
        ...p,
        overloaded: p.allocated.map((h, i) => h > p.capacity[i] + 0.01),
        utilization: p.allocated.map((h, i) =>
          p.capacity[i] > 0 ? Math.round((h / p.capacity[i]) * 100) : 0
        ),
      }));
      list.sort(
        (a, b) =>
          b.allocated.reduce((x, y) => x + y, 0) -
            a.allocated.reduce((x, y) => x + y, 0) ||
          a.name.localeCompare(b.name)
      );
      return {
        weeks,
        people: list,
        roleDemand: Array.from(roleDemand.values()),
        equipment: Array.from(equip.values()).map(e => ({
          ...e,
          doubleBooked: e.days.map(x => x > 5),
        })),
      };
    }),

  /** Equipment conflicts: same unit assigned to overlapping tasks. */
  equipmentConflicts: protectedProcedure.query(async ({ ctx }) => {
    const s = await sec(ctx);
    if (!hasJobModuleAccess(s))
      bad("Your access type only includes Logs and Timesheets");
    if (!can(s, "resource.view", null) && !s.isAdmin)
      bad("You don't have access to resource workload");
    const visibleIds = s.projectIds.filter(pid =>
      effectivePrivileges(s, pid).has("project.view")
    );
    if (!visibleIds.length) return [];
    const d = await db();
    const rows = await d
      .select({
        equipmentId: taskAssignments.equipmentId,
        t: tasks,
        code: projects.code,
      })
      .from(taskAssignments)
      .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(projects.state, "active"),
          ne(tasks.status, "done"),
          inArray(projects.id, visibleIds)
        )
      );
    const byEq = new Map<number, typeof rows>();
    for (const r of rows) {
      if (!r.equipmentId || !r.t.startDate || !r.t.finishDate) continue;
      if (!byEq.has(r.equipmentId)) byEq.set(r.equipmentId, []);
      byEq.get(r.equipmentId)!.push(r);
    }
    const conflicts: {
      equipmentId: number;
      a: { taskId: number; name: string; code: string | null };
      b: { taskId: number; name: string; code: string | null };
      from: string;
      to: string;
    }[] = [];
    byEq.forEach((list, equipmentId) => {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i].t;
          const B = list[j].t;
          if (A.startDate! <= B.finishDate! && B.startDate! <= A.finishDate!) {
            conflicts.push({
              equipmentId,
              a: { taskId: A.id, name: A.name, code: list[i].code },
              b: { taskId: B.id, name: B.name, code: list[j].code },
              from: A.startDate! > B.startDate! ? A.startDate! : B.startDate!,
              to: A.finishDate! < B.finishDate! ? A.finishDate! : B.finishDate!,
            });
          }
        }
    });
    const ids = Array.from(byEq.keys());
    const names = ids.length
      ? await d
          .select({ id: equipment.id, name: equipment.name })
          .from(equipment)
          .where(inArray(equipment.id, ids))
      : [];
    return conflicts.map(c => ({
      ...c,
      equipmentName:
        names.find(n => n.id === c.equipmentId)?.name ?? "Equipment",
    }));
  }),
});
