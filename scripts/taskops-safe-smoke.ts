/**
 * Safe integration check for bulk move / assign / shift on Sequences & Tasks.
 * Creates dedicated temporary jobs, tasks and users, never edits existing jobs,
 * and removes only its own fixtures in finally.
 * Explicit invocation: pnpm exec tsx scripts/taskops-safe-smoke.ts --run
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  activities,
  equipment,
  followers,
  jobRoles,
  notifications,
  projects,
  roleAssignments,
  securityRoles,
  taskAssignments,
  taskDependencies,
  tasks,
  users,
  type User,
} from "../drizzle/schema";
import { db } from "../server/db";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { getCalendar, orgToday } from "../server/services/calendars";
import { recomputeWithDownstream } from "../server/services/recompute";

const caller = (user: User) =>
  appRouter.createCaller({
    user,
    quiet: true,
    req: { headers: {} } as TrpcContext["req"],
    res: { cookie() {}, clearCookie() {} } as unknown as TrpcContext["res"],
  });
let passed = 0;
function check(name: string, condition: unknown) {
  assert.ok(condition, name);
  passed++;
  console.log(`PASS ${name}`);
}
async function rejects(name: string, fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, pattern);
  passed++;
  console.log(`PASS ${name}`);
}

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Pass --run to create dedicated verification fixtures.");
  const d = await db();
  const [admin] = await d
    .select()
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
    .limit(1);
  if (!admin) throw new Error("An existing active admin is required; this script never creates an admin account.");
  const A = caller(admin);
  const marker = `TASKOPS-CHECK-${randomUUID().slice(0, 8)}`;
  const jobIds: number[] = [];
  const userIds: number[] = [];
  const today = await orgToday();
  try {
    for (let i = 0; i < 2; i++) {
      const [{ id }] = await d
        .insert(projects)
        .values({ code: `${marker}-${i}`, name: `${marker} TEMPORARY verification job`, state: "draft", startDate: today })
        .$returningId();
      jobIds.push(id);
    }
    const [pid, otherPid] = jobIds;
    const mk = async (projectId: number, name: string, kind: string, parentId: number | null, sortOrder: number) => {
      const [{ id }] = await d
        .insert(tasks)
        .values({ projectId, name: `${marker} ${name}`, kind, parentId, sortOrder, durationDays: 2, startDate: today })
        .$returningId();
      return id;
    };
    // WBS:  1 Seq A ( A1, A2 )   2 Seq B (leaf, A2 → B FS)   3 Task C
    const seqA = await mk(pid, "Seq A", "sequence", null, 0);
    const a1 = await mk(pid, "A1 columns", "task", seqA, 0);
    const a2 = await mk(pid, "A2 beams", "task", seqA, 10);
    const seqB = await mk(pid, "Seq B", "sequence", null, 10);
    const c = await mk(pid, "C deck", "task", null, 20);
    const foreign = await mk(otherPid, "Foreign task", "task", null, 0);
    await d.insert(taskDependencies).values({ predecessorId: a2, successorId: seqB, type: "FS", lagDays: 0 });
    await recomputeWithDownstream(pid);

    const [{ id: tempUserId }] = await d
      .insert(users)
      .values({ openId: `local:${marker}-crew`, name: `TEMP ${marker} foreman`, role: "user", accessType: "team_member", loginMethod: "test" })
      .$returningId();
    userIds.push(tempUserId);
    const [{ id: viewerId }] = await d
      .insert(users)
      .values({ openId: `local:${marker}-viewer`, name: `TEMP ${marker} viewer`, role: "user", accessType: "team_member", loginMethod: "test" })
      .$returningId();
    userIds.push(viewerId);
    const [viewerRole] = await d.select().from(securityRoles).where(eq(securityRoles.key, "viewer")).limit(1);
    assert.ok(viewerRole, "Missing viewer role");
    await d.insert(roleAssignments).values({ userId: viewerId, roleId: viewerRole.id, scopeType: "project", scopeId: pid });
    const [viewer] = await d.select().from(users).where(eq(users.id, viewerId));
    const V = caller(viewer);
    const [role] = await d.select().from(jobRoles).where(eq(jobRoles.isActive, true)).limit(1);
    const [crane] = await d.select().from(equipment).where(eq(equipment.isActive, true)).limit(1);
    assert.ok(role && crane, "Bootstrap job roles and equipment are required");

    const load = async () => {
      const rows = await d.select().from(tasks).where(eq(tasks.projectId, pid));
      return new Map(rows.map(r => [r.id, r]));
    };
    const assignmentsOf = async (ids: number[]) =>
      d.select().from(taskAssignments).where(inArray(taskAssignments.taskId, ids));

    /* ---------- Move ---------- */
    await rejects("viewer cannot move tasks", () => V.tasks.bulkMove({ projectId: pid, ids: [c], parentId: seqA, beforeId: a1 }), /task\.edit/);
    await rejects("tasks from another job are rejected", () => A.tasks.bulkMove({ projectId: pid, ids: [foreign], parentId: seqA }), /not in this job/);
    await rejects("a sequence cannot move under its own task", () => A.tasks.bulkMove({ projectId: pid, ids: [seqA], parentId: a1 }), /under itself/);
    const m1 = await A.tasks.bulkMove({ projectId: pid, ids: [c], parentId: seqA, beforeId: a1 });
    let t = await load();
    const kidsA = () => Array.from(t.values()).filter(x => x.parentId === seqA).sort((x, y) => x.sortOrder - y.sortOrder).map(x => x.id);
    check("drag into a sequence lands at the exact position", m1.moved === 1 && kidsA().join() === [c, a1, a2].join());
    check("WBS renumbers after a move", t.get(c)?.wbs === "1.1" && t.get(a1)?.wbs === "1.2");

    const m2 = await A.tasks.bulkMove({ projectId: pid, ids: [a1], parentId: seqB, beforeId: null });
    t = await load();
    const links = await d.select().from(taskDependencies).where(eq(taskDependencies.successorId, seqB));
    check("moving under a linked leaf sequence removes its links", m2.removedLinks === 1 && links.length === 0);
    check("target sequence becomes a summary", t.get(seqB)?.isSummary === true && t.get(a1)?.parentId === seqB);

    await rejects("no-op move is reported", () => A.tasks.bulkMove({ projectId: pid, ids: [a1], parentId: seqB, beforeId: null }), /Already in that position/);
    const m3 = await A.tasks.bulkMove({ projectId: pid, ids: [c, a2], parentId: null, beforeId: seqA });
    t = await load();
    const roots = Array.from(t.values()).filter(x => x.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder).map(x => x.id);
    check("multi-row move keeps relative order", m3.moved === 2 && roots.join() === [c, a2, seqA, seqB].join());
    await A.tasks.bulkMove({ projectId: pid, ids: [c, a2], parentId: seqA, beforeId: null });
    t = await load();
    check("rows move back into the sequence", kidsA().join() === [c, a2].join());

    /* ---------- Assign ---------- */
    await rejects("viewer cannot assign", () => V.tasks.bulkAssign({ projectId: pid, taskIds: [seqA], mode: "add", resources: [{ userId: tempUserId }] }), /task\.edit/);
    await rejects("unknown resources are rejected", () => A.tasks.bulkAssign({ projectId: pid, taskIds: [seqA], mode: "add", resources: [{ equipmentId: 99999999 }] }), /no longer exists/);
    await rejects("empty assignment rows are rejected", () => A.tasks.bulkAssign({ projectId: pid, taskIds: [seqA], mode: "add", resources: [{}] }), /needs a person/);
    const as1 = await A.tasks.bulkAssign({
      projectId: pid,
      taskIds: [seqA],
      mode: "add",
      resources: [{ userId: tempUserId }, { jobRoleId: role.id, allocationPct: 400 }, { equipmentId: crane.id }],
    });
    let rows = await assignmentsOf([c, a2, seqA]);
    check("assigning a sequence covers its detail tasks only", as1.tasks === 2 && as1.changed === 2 && rows.length === 6 && !rows.some(r => r.taskId === seqA));
    check("crew role keeps crew-size allocation", rows.filter(r => r.jobRoleId === role.id && !r.userId).every(r => r.allocationPct === 400));
    const notes = await d.select().from(notifications).where(eq(notifications.userId, tempUserId));
    const follows = await d.select().from(followers).where(and(eq(followers.userId, tempUserId), eq(followers.entityType, "task")));
    // Verification callers run quiet: notifications/webhooks are suppressed so no real user or endpoint is contacted.
    check("assigned person follows each task (quiet run sends no notifications)", notes.length === 0 && follows.length === 2);
    const as2 = await A.tasks.bulkAssign({ projectId: pid, taskIds: [seqA], mode: "add", resources: [{ userId: tempUserId }] });
    check("re-adding the same person is a no-op", as2.changed === 0);
    await A.tasks.bulkAssign({ projectId: pid, taskIds: [c], mode: "add", resources: [{ userId: tempUserId, allocationPct: 50 }] });
    rows = await assignmentsOf([c]);
    check("re-adding with a new allocation updates it in place", rows.filter(r => r.userId === tempUserId).length === 1 && rows.find(r => r.userId === tempUserId)?.allocationPct === 50);
    await A.tasks.bulkAssign({ projectId: pid, taskIds: [seqA], mode: "remove", resources: [{ equipmentId: crane.id }] });
    rows = await assignmentsOf([c, a2]);
    check("remove takes equipment off every covered task", rows.length === 4 && !rows.some(r => r.equipmentId === crane.id));
    await A.tasks.bulkAssign({ projectId: pid, taskIds: [c, a2], mode: "replace", resources: [] });
    check("replace with nothing clears the crew", (await assignmentsOf([c, a2])).length === 0);

    /* ---------- Shift ---------- */
    const cal = await getCalendar(null);
    t = await load();
    const cStart = t.get(c)!.startDate!;
    const a2Start = t.get(a2)!.startDate!;
    await d.update(tasks).set({ actualStart: a2Start, percentComplete: 25, status: "in_progress" }).where(eq(tasks.id, a2));
    await rejects("zero-day shift is rejected", () => A.tasks.shiftDates({ projectId: pid, ids: [seqA], workDays: 0 }), /non-zero/);
    await rejects("viewer cannot shift", () => V.tasks.shiftDates({ projectId: pid, ids: [seqA], workDays: 3 }), /task\.edit/);
    const s1 = await A.tasks.shiftDates({ projectId: pid, ids: [seqA], workDays: 3 });
    t = await load();
    check(
      "shifting a sequence moves unstarted tasks by work days",
      s1.shifted === 1 && t.get(c)?.startDate === cal.addWorkDays(cStart, 3) && t.get(c)?.constraintType === "snet"
    );
    check("started tasks keep their actual dates", s1.skippedStarted === 1 && t.get(a2)?.startDate === a2Start);
    const s2 = await A.tasks.shiftDates({ projectId: pid, ids: [c], workDays: -10 });
    t = await load();
    check("a shift before the job start is reported as held", s2.held === 1 && t.get(c)?.startDate === cStart);
    await rejects("shift with only started tasks explains why", () => A.tasks.shiftDates({ projectId: pid, ids: [a2], workDays: 2 }), /already started/);

    const acts = await d.select().from(activities).where(eq(activities.projectId, pid));
    check("moves, assignments and shifts are in the activity log", ["move", "assign", "shift"].every(a => acts.some(x => x.action === a)));
    console.log(`SUMMARY ${passed} checks passed`);
  } finally {
    for (const id of jobIds) {
      const [project] = await d.select().from(projects).where(eq(projects.id, id));
      if (!project) continue;
      assert.ok(project.code?.startsWith(marker), "Cleanup refused: job is not this run's fixture");
      await A.projects.delete({ id, confirm: project.code! });
    }
    if (userIds.length) {
      await d.delete(notifications).where(inArray(notifications.userId, userIds));
      await d.delete(followers).where(inArray(followers.userId, userIds));
      await d.delete(roleAssignments).where(inArray(roleAssignments.userId, userIds));
      await d.delete(users).where(inArray(users.id, userIds));
    }
    if (jobIds.length) {
      const leftTasks = await d.select({ id: tasks.id }).from(tasks).where(inArray(tasks.projectId, jobIds));
      const leftActs = await d.select({ id: activities.id }).from(activities).where(inArray(activities.projectId, jobIds));
      if (leftActs.length) await d.delete(activities).where(inArray(activities.id, leftActs.map(a => a.id)));
      assert.equal(leftTasks.length, 0, "Temporary task fixtures remain");
    }
    console.log("CLEANUP dedicated jobs/users removed; existing jobs were not edited");
  }
}
main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  }
);
