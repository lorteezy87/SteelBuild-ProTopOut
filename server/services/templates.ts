import { tasks, taskDependencies } from "../../drizzle/schema";
import { db } from "../db";

/**
 * Starter WBS for a steel erection job (fab by others).
 * Sequences get equal shares of the job tonnage; each is FS-linked to the
 * previous one so crane/crew flow is modeled by default.
 */
export async function applyErectionTemplate(
  projectId: number,
  opts: { sequenceCount: number; totalTons: number; totalPieces: number; userId: number }
) {
  const d = await db();
  const n = Math.max(1, Math.min(40, Math.round(opts.sequenceCount)));
  let order = 0;
  const add = async (v: Partial<typeof tasks.$inferInsert> & { name: string }) => {
    const [{ id }] = await d
      .insert(tasks)
      .values({ projectId, sortOrder: order++, createdBy: opts.userId, ...v })
      .$returningId();
    return id;
  };
  const link = (predecessorId: number, successorId: number, type = "FS", lagDays = 0) =>
    d.insert(taskDependencies).values({ predecessorId, successorId, type, lagDays });

  const pre = await add({ name: "Pre-Construction", kind: "task" });
  const contract = await add({ name: "Contract executed / NTP", kind: "milestone", parentId: pre, durationDays: 0 });
  const erSub = await add({ name: "Erection drawings & lift plan submittal", parentId: pre, durationDays: 5 });
  const erApp = await add({ name: "Submittals approved", parentId: pre, kind: "milestone", durationDays: 0 });
  const abSurvey = await add({ name: "Anchor bolt survey & acceptance", parentId: pre, durationDays: 2 });
  const access = await add({ name: "Site access / laydown confirmed with GC", parentId: pre, kind: "milestone", durationDays: 0 });
  await link(contract, erSub);
  await link(erSub, erApp);
  await link(erApp, abSurvey);
  await link(abSurvey, access);

  const mob = await add({ name: "Mobilize crew & crane", durationDays: 1 });
  await link(access, mob);

  const ere = await add({ name: "Steel Erection", kind: "task" });
  const tonsEach = n ? Math.round((opts.totalTons / n) * 10) / 10 : 0;
  const piecesEach = n ? Math.round(opts.totalPieces / n) : 0;
  let prev = mob;
  for (let i = 1; i <= n; i++) {
    const seq = await add({
      name: `Sequence ${i}`,
      parentId: ere,
      kind: "sequence",
      location: `Seq ${i}`,
      durationDays: 5,
      plannedTons: tonsEach,
      plannedPieces: piecesEach,
    });
    await link(prev, seq);
    prev = seq;
  }
  const plumb = await add({ name: "Plumb, bolt-up & weld-out", parentId: ere, durationDays: 5 });
  await link(prev, plumb, "FS", 0);
  const decking = await add({ name: "Deck / misc. steel (if in scope)", parentId: ere, durationDays: 3 });
  await link(plumb, decking, "SS", 2);

  const close = await add({ name: "Closeout" });
  const punch = await add({ name: "Punch list", parentId: close, durationDays: 2 });
  const demob = await add({ name: "Demobilize", parentId: close, durationDays: 1 });
  const done = await add({ name: "Erection complete / turnover", parentId: close, kind: "milestone", durationDays: 0 });
  await link(decking, punch);
  await link(plumb, punch);
  await link(punch, demob);
  await link(demob, done);
}
