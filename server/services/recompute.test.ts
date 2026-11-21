import { describe, expect, it } from "vitest";
import { evaPlan, frozenBaselineEva, projectRecomputeOrder } from "./recompute";
import { earnedValue } from "../engine/projection";
import { WorkCalendar } from "../engine/calendar";

const edge = (from: number, to: number) => ({ predecessorProjectId: from, successorProjectId: to });
describe("project recomputation ordering", () => {
  it("traverses three downstream levels and excludes unrelated jobs", () => {
    expect(projectRecomputeOrder([4, 3, 2, 1, 5], [edge(1, 2), edge(2, 3), edge(3, 4)], [1])).toEqual([1, 2, 3, 4]);
  });
  it("waits for every affected predecessor in a diamond", () => {
    expect(projectRecomputeOrder([4, 3, 2, 1], [edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 4)], [1])).toEqual([1, 2, 3, 4]);
  });
  it("recomputeAll ordering does not depend on database row order", () => {
    expect(projectRecomputeOrder([3, 2, 1], [edge(1, 2), edge(2, 3)])).toEqual([1, 2, 3]);
  });
  it("deduplicates project edges caused by multiple task links", () => {
    expect(projectRecomputeOrder([2, 1], [edge(1, 2), edge(1, 2)])).toEqual([1, 2]);
  });
  it("terminates cyclic graphs with each affected job visited once", () => {
    expect(projectRecomputeOrder([3, 2, 1], [edge(1, 2), edge(2, 1), edge(2, 3)], [1])).toEqual([1, 2, 3]);
  });
  it("ignores same-job and dangling edges, and nonexistent roots", () => {
    expect(projectRecomputeOrder([1], [edge(1, 1), edge(1, 99)], [99])).toEqual([]);
  });
});

const current = [
  { id: 1, kind: "task", isSummary: false, percentComplete: 100, durationDays: 80, budgetCost: 9000, startDate: "2026-12-01", finishDate: "2026-12-31" },
  { id: 2, kind: "task", isSummary: false, percentComplete: 0, durationDays: 1, budgetCost: 1, startDate: "2026-12-01", finishDate: "2026-12-31" },
  { id: 3, kind: "task", isSummary: false, percentComplete: 100, durationDays: 1, budgetCost: 99000, startDate: "2026-12-01", finishDate: "2026-12-31" },
];
const baseline = { budget: 1000, taskData: [
  { taskId: 1, name: "one", kind: "task", isSummary: false, durationDays: 2, effortHours: 0, budgetCost: 100, plannedTons: 0, startDate: "2026-01-01", finishDate: "2026-01-02" },
  { taskId: 2, name: "two", kind: "task", isSummary: false, durationDays: 8, effortHours: 0, budgetCost: 900, plannedTons: 0, startDate: "2026-12-01", finishDate: "2026-12-31" },
  { taskId: 99, name: "summary", kind: "task", isSummary: true, durationDays: 30, effortHours: 0, budgetCost: 1000, plannedTons: 0, startDate: null, finishDate: null },
] };
describe("frozen baseline EVA", () => {
  it("uses frozen BAC, task budgets/durations and baseline leaf membership", () => {
    const plan = evaPlan(current, 99999, baseline, 90);
    expect(plan.budget).toBe(1000);
    expect(plan.tasks.map(t => t.id)).toEqual([1, 2]);
    expect(plan.tasks[0]).toMatchObject({ durationDays: 2, budgetCost: 100, plannedStart: "2026-01-01" });
    expect(plan.percentComplete).toBe(10);
    const eva = earnedValue(plan.tasks, plan.budget, plan.percentComplete, 50, "2026-06-01", new WorkCalendar({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 }));
    expect(eva).toMatchObject({ bac: 1000, pv: 100, ev: 100 });
  });
  it("uses frozen duration weights when task budgets are zero", () => {
    const unbudgeted = { ...baseline, taskData: baseline.taskData.map(t => ({ ...t, budgetCost: 0 })) };
    expect(evaPlan(current, 99, unbudgeted).percentComplete).toBe(20);
  });
  it("falls back to current weights only for missing legacy snapshot fields", () => {
    const old = { budget: 1, taskData: [{ ...baseline.taskData[0], budgetCost: undefined as unknown as number, durationDays: undefined as unknown as number }] };
    expect(evaPlan(current, 2, old).tasks[0]).toMatchObject({ budgetCost: 9000, durationDays: 80 });
  });
  it("keeps current progress methods and weights without an active baseline", () => {
    expect(evaPlan(current, 99, null, 90)).toMatchObject({ budget: 99, percentComplete: 90 });
    expect(evaPlan(current, 99).tasks[0].budgetCost).toBe(9000);
  });
  it("preserves a valid zero BAC instead of falling back to task budgets", () => {
    const eva = earnedValue([], 1000, 10, 50, "2026-06-01", new WorkCalendar({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 }));
    expect(frozenBaselineEva(eva, 0)).toMatchObject({ bac: 0, pv: 0, ev: 0, eac: 0, cv: -50 });
    expect(frozenBaselineEva(eva)).toBe(eva);
  });
});

import { rentalCosts } from "./recompute";
describe("rentalCosts", () => {
  const base = { dayRate: null, weekRate: null, monthRate: null, plannedOffRentDate: null, callOffNoticeDays: 1, calledOffOn: null, deliveryCharge: null, pickupCharge: null };
  it("costs a rented crane once and counts unpriced rentals", () => {
    const rentals = [
      { ...base, id: 1, equipmentId: 4, onRentDate: "2026-11-01", offRentDate: "2026-11-08", weekRate: 7000 },
      { ...base, id: 2, equipmentId: null, onRentDate: "2026-11-01", offRentDate: null },
    ];
    const rows = [
      { equipmentId: 4, cost: 1200, reportDate: "2026-11-03" },
      { equipmentId: 4, cost: 1200, reportDate: "2026-11-09" },
      { equipmentId: 5, cost: 300, reportDate: "2026-11-03" },
    ];
    expect(rentalCosts(rentals, rows, "2026-11-20")).toEqual({ equipmentCost: 1500, coveredCost: 1200, rentalCost: 7000, rentalsUnpriced: 1 });
  });
});
