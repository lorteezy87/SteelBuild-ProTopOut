import { describe, expect, it } from "vitest";
import {
  leafIds,
  mergeAssignments,
  planMove,
  planShift,
  resolveDrop,
  topLevelSelection,
  wbsOrder,
  zoneFor,
  type WbsNode,
} from "../shared/taskOps";

/*
 * 1  Precon (10)
 *    2 Submittals (20)
 *    3 Mobilize (30)
 * 4  Sequence 1 (40)
 *    5 Columns (50)
 *    6 Beams (60)
 * 7  Sequence 2 (70)  — leaf sequence, no children yet
 */
const nodes: WbsNode[] = [
  { id: 1, parentId: null, sortOrder: 0 },
  { id: 2, parentId: 1, sortOrder: 0 },
  { id: 3, parentId: 1, sortOrder: 10 },
  { id: 4, parentId: null, sortOrder: 10 },
  { id: 5, parentId: 4, sortOrder: 0 },
  { id: 6, parentId: 4, sortOrder: 10 },
  { id: 7, parentId: null, sortOrder: 20 },
];

describe("WBS order and selection", () => {
  it("walks depth-first", () => {
    expect(wbsOrder(nodes)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("drops children of selected parents", () => {
    expect(topLevelSelection(nodes, [5, 4, 2])).toEqual([2, 4]);
  });
  it("expands summaries to detail tasks", () => {
    expect(leafIds(nodes, [4, 7])).toEqual([5, 6, 7]);
    expect(leafIds(nodes, [1, 3])).toEqual([2, 3]);
  });
});

describe("planMove", () => {
  it("moves a task into a leaf sequence and flags the summary conversion", () => {
    const plan = planMove(nodes, [6], 7, null);
    expect(plan).toMatchObject({ ok: true, moved: [6], order: [6], parentId: 7, parentBecomesSummary: true });
  });
  it("keeps WBS order for multi-row moves and anchors before a row", () => {
    const plan = planMove(nodes, [6, 2], 4, 5);
    expect(plan).toMatchObject({ ok: true, moved: [2, 6], order: [2, 6, 5], parentBecomesSummary: false });
  });
  it("re-anchors when the anchor row is itself moving", () => {
    const plan = planMove(nodes, [1], null, 1);
    expect(plan.ok).toBe(false);
    const plan2 = planMove(nodes, [4], null, 4);
    expect(plan2.ok).toBe(false);
    const plan3 = planMove(nodes, [1, 4], null, 4);
    // 1 and 4 move together to the slot before 7 — WBS order [1, 4, 7] is unchanged
    expect(plan3.ok).toBe(false);
    const plan4 = planMove(nodes, [7], null, 1);
    expect(plan4).toMatchObject({ ok: true, order: [7, 1, 4] });
  });
  it("blocks moving a task under its own subtree", () => {
    expect(planMove(nodes, [4], 5, null)).toEqual({ ok: false, error: "A task cannot be moved under itself" });
  });
  it("rejects an anchor from a different parent", () => {
    expect(planMove(nodes, [6], null, 2).ok).toBe(false);
  });
});

describe("resolveDrop / zoneFor", () => {
  const expanded = () => true;
  it("maps zones to parent and anchor", () => {
    expect(resolveDrop(nodes, 5, "before", expanded)).toEqual({ parentId: 4, beforeId: 5 });
    expect(resolveDrop(nodes, 5, "after", expanded)).toEqual({ parentId: 4, beforeId: 6 });
    expect(resolveDrop(nodes, 6, "after", expanded)).toEqual({ parentId: 4, beforeId: null });
    expect(resolveDrop(nodes, 7, "into", expanded)).toEqual({ parentId: 7, beforeId: null });
  });
  it("treats 'after' an expanded summary as its first child, collapsed as next sibling", () => {
    expect(resolveDrop(nodes, 4, "after", expanded)).toEqual({ parentId: 4, beforeId: 5 });
    expect(resolveDrop(nodes, 4, "after", () => false)).toEqual({ parentId: null, beforeId: 7 });
  });
  it("splits rows into thirds only when nesting is allowed", () => {
    expect(zoneFor(2, 40, true)).toBe("before");
    expect(zoneFor(20, 40, true)).toBe("into");
    expect(zoneFor(38, 40, true)).toBe("after");
    expect(zoneFor(15, 40, false)).toBe("before");
    expect(zoneFor(25, 40, false)).toBe("after");
  });
});

describe("planShift", () => {
  // Simple calendar: every day is a work day.
  const add = (d: string, n: number) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const base = { constraintDate: null, finishDate: "2026-12-05" };
  it("sets SNET on entry tasks and lets logic carry driven tasks", () => {
    const updates = planShift(
      [
        { id: 1, schedulingMode: "auto", constraintType: "asap", startDate: "2026-12-01", ...base },
        { id: 2, schedulingMode: "auto", constraintType: "asap", startDate: "2026-12-03", ...base },
      ],
      [{ predecessorId: 1, successorId: 2 }],
      3,
      add
    );
    expect(updates).toEqual([
      { id: 1, set: { constraintType: "snet", constraintDate: "2026-12-04" }, expectedStart: "2026-12-04" },
      { id: 2, set: {}, expectedStart: "2026-12-06" },
    ]);
  });
  it("shifts manual dates, SNET dates and dated constraints", () => {
    const updates = planShift(
      [
        { id: 1, schedulingMode: "manual", constraintType: "asap", startDate: "2026-12-01", constraintDate: null, finishDate: "2026-12-02" },
        { id: 2, schedulingMode: "auto", constraintType: "snet", startDate: "2026-12-10", constraintDate: "2026-12-08", finishDate: null },
        { id: 3, schedulingMode: "auto", constraintType: "mso", startDate: "2026-12-15", constraintDate: "2026-12-15", finishDate: null },
      ],
      [],
      -2,
      add
    );
    expect(updates.map(u => u.set)).toEqual([
      { startDate: "2026-11-29", finishDate: "2026-11-30" },
      { constraintDate: "2026-12-08" },
      { constraintDate: "2026-12-13" },
    ]);
  });
  it("does nothing for a zero shift", () => {
    expect(planShift([{ id: 1, schedulingMode: "auto", constraintType: "asap", startDate: "2026-12-01", ...base }], [], 0, add)).toEqual([]);
  });
});

describe("mergeAssignments", () => {
  const current = [
    { userId: 9, jobRoleId: null, equipmentId: null, allocationPct: 100 },
    { userId: null, jobRoleId: null, equipmentId: 3, allocationPct: 100 },
  ];
  it("adds without duplicating and updates allocation on repeats", () => {
    expect(mergeAssignments(current, [{ userId: 9, allocationPct: 50 }, { jobRoleId: 2, allocationPct: 400 }], "add")).toEqual([
      { userId: 9, jobRoleId: null, equipmentId: null, allocationPct: 50 },
      { userId: null, jobRoleId: null, equipmentId: 3, allocationPct: 100 },
      { userId: null, jobRoleId: 2, equipmentId: null, allocationPct: 400 },
    ]);
  });
  it("removes matching resources only", () => {
    expect(mergeAssignments(current, [{ equipmentId: 3 }], "remove")).toEqual([current[0]]);
  });
  it("replaces and de-duplicates", () => {
    expect(mergeAssignments(current, [{ userId: 4 }, { userId: 4 }], "replace")).toEqual([
      { userId: 4, jobRoleId: null, equipmentId: null, allocationPct: 100 },
    ]);
  });
});
