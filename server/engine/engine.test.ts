import { describe, expect, it } from "vitest";
import { WorkCalendar, usHolidays } from "./calendar";
import { CycleError, schedule, type SchedTask } from "./scheduler";
import { earnedValue, projectHealth, projectPercent, projectTask, type HealthTask } from "./projection";
import { evaluateFormula, validateFormula } from "@shared/formula";
import { applyFilters, parseApiFilter, resolveDateToken } from "@shared/filters";

const cal = new WorkCalendar({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, exceptions: [] });

const task = (p: Partial<SchedTask> & { id: number }): SchedTask => ({
  parentId: null,
  kind: "task",
  schedulingMode: "auto",
  constraintType: "asap",
  constraintDate: null,
  startDate: null,
  finishDate: null,
  durationDays: 1,
  effortHours: 0,
  actualStart: null,
  actualFinish: null,
  percentComplete: 0,
  allocation: 1,
  ...p,
});

describe("calendar", () => {
  it("skips weekends", () => {
    // 2026-01-02 is a Friday
    expect(cal.addWorkDays("2026-01-02", 1)).toBe("2026-01-05");
    expect(cal.workDaysBetween("2026-01-05", "2026-01-09")).toBe(5);
    expect(cal.nextWorkDay("2026-01-03")).toBe("2026-01-05");
  });
  it("honors holidays", () => {
    const hol = new WorkCalendar({
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
      exceptions: usHolidays(2026).map(h => ({ date: h.date, isWorking: false })),
    });
    expect(hol.isWorkDay("2026-07-03")).toBe(false); // July 4 observed (Saturday → Friday)
    expect(hol.addWorkDays("2026-07-02", 1)).toBe("2026-07-06");
  });
});

describe("scheduler", () => {
  it("chains FS with lag and finds the critical path", () => {
    const tasks = [
      task({ id: 1, durationDays: 5 }),
      task({ id: 2, durationDays: 3 }),
      task({ id: 3, durationDays: 2 }),
      task({ id: 4, kind: "milestone", durationDays: 0 }),
    ];
    const deps = [
      { predecessorId: 1, successorId: 3, type: "FS", lagDays: 0 },
      { predecessorId: 2, successorId: 3, type: "FS", lagDays: 1 },
      { predecessorId: 3, successorId: 4, type: "FS", lagDays: 0 },
    ];
    const r = schedule(tasks, deps, cal, "2026-01-05");
    expect(r.get(1)!.finishDate).toBe("2026-01-09");
    expect(r.get(3)!.startDate).toBe("2026-01-12");
    expect(r.get(3)!.finishDate).toBe("2026-01-13");
    expect(r.get(4)!.startDate).toBe("2026-01-13");
    expect(r.get(1)!.isCritical).toBe(true);
    expect(r.get(2)!.isCritical).toBe(false);
    expect(r.get(2)!.totalFloat).toBe(1);
  });

  it("applies SS, FF, constraints and summary rollup", () => {
    const tasks = [
      task({ id: 10, durationDays: 0 }),
      task({ id: 11, parentId: 10, durationDays: 4 }),
      task({ id: 12, parentId: 10, durationDays: 2, constraintType: "snet", constraintDate: "2026-01-14" }),
      task({ id: 13, durationDays: 3 }),
    ];
    const deps = [{ predecessorId: 11, successorId: 13, type: "SS", lagDays: 2 }];
    const r = schedule(tasks, deps, cal, "2026-01-05");
    expect(r.get(13)!.startDate).toBe("2026-01-07");
    expect(r.get(12)!.startDate).toBe("2026-01-14");
    expect(r.get(10)!.isSummary).toBe(true);
    expect(r.get(10)!.startDate).toBe("2026-01-05");
    expect(r.get(10)!.finishDate).toBe("2026-01-15");
  });

  it("rejects cycles", () => {
    const tasks = [task({ id: 1 }), task({ id: 2 })];
    const deps = [
      { predecessorId: 1, successorId: 2, type: "FS", lagDays: 0 },
      { predecessorId: 2, successorId: 1, type: "FS", lagDays: 0 },
    ];
    expect(() => schedule(tasks, deps, cal, "2026-01-05")).toThrow(CycleError);
  });

  it("flags FNLT violations", () => {
    const tasks = [
      task({ id: 1, durationDays: 10 }),
      task({ id: 2, durationDays: 2, constraintType: "fnlt", constraintDate: "2026-01-12" }),
    ];
    const r = schedule(tasks, [{ predecessorId: 1, successorId: 2, type: "FS", lagDays: 0 }], cal, "2026-01-05");
    expect(r.get(2)!.constraintViolated).toBe(true);
  });
});

const ht = (p: Partial<HealthTask>): HealthTask => ({
  id: 1,
  isSummary: false,
  kind: "sequence",
  status: "in_progress",
  startDate: "2026-01-05",
  finishDate: "2026-01-16",
  durationDays: 10,
  effortHours: 0,
  percentComplete: 0,
  plannedTons: 100,
  erectedTons: 0,
  plannedPieces: 0,
  erectedPieces: 0,
  budgetCost: 0,
  ...p,
});

describe("projection", () => {
  it("projects from tons per day", () => {
    // 5 work days elapsed (Jan 5–9), 50 of 100 tons → on pace to finish Jan 16
    const onPace = projectTask(ht({ erectedTons: 50 }), "2026-01-09", cal, true, "tonnage");
    expect(onPace.health).toBe("on_track");
    const slow = projectTask(ht({ erectedTons: 20 }), "2026-01-09", cal, true, "tonnage");
    expect(slow.health).toBe("delayed");
  });
  it("marks overdue and future", () => {
    expect(projectTask(ht({ erectedTons: 90 }), "2026-01-20", cal, true, "tonnage").health).toBe("delayed");
    expect(projectTask(ht({}), "2026-01-01", cal, true, "tonnage").health).toBe("future");
    expect(projectTask(ht({ erectedTons: 100 }), "2026-01-20", cal, true, "tonnage").health).toBe("done");
  });
  it("computes tonnage percent", () => {
    const p = projectPercent([ht({ erectedTons: 30 }), ht({ id: 2, plannedTons: 50, erectedTons: 50 })], "tonnage");
    expect(Math.round(p)).toBe(53);
  });
  it("computes cost health and EVA", () => {
    const h = projectHealth(
      {
        active: true,
        today: "2026-01-09",
        deadline: "2026-01-16",
        plannedFinish: "2026-01-16",
        plannedStart: "2026-01-05",
        budget: 100_000,
        actualCost: 60_000,
        percentComplete: 50,
        taskProjections: [],
      },
      cal
    );
    expect(h.projectedCost).toBe(120_000);
    expect(h.costHealth).toBe("overbudget");
    const e = earnedValue(
      [{ id: 1, kind: "task", durationDays: 10, budgetCost: 0, plannedStart: "2026-01-05", plannedFinish: "2026-01-16" }],
      100_000,
      40,
      50_000,
      "2026-01-09",
      cal
    );
    expect(e.pv).toBe(50_000);
    expect(e.ev).toBe(40_000);
    expect(e.spi).toBeCloseTo(0.8);
    expect(e.cpi).toBeCloseTo(0.8);
  });
});

describe("formula", () => {
  it("evaluates arithmetic, refs, functions", () => {
    const ctx = { me: { labor: 1200, equip: 800, material: 0, status: "open" }, today: "2026-01-10" };
    expect(evaluateFormula("me.labor + me.equip + me.material", ctx)).toBe(2000);
    expect(evaluateFormula("me.labor > 1000 and me.status == 'open' ? 'High' : 'Low'", ctx)).toBe("High");
    expect(evaluateFormula("roundTo(10 / 3, 2)", ctx)).toBe(3.33);
    expect(evaluateFormula("daysBetween('2026-01-01', today())", ctx)).toBe(9);
    expect(validateFormula("me.a +")).not.toBeNull();
  });
});

describe("filters", () => {
  const rows = [
    { name: "Steel Erection", state: "active", budget: 5000, finishDate: "2026-01-20" },
    { name: "Stairs", state: "draft", budget: 500, finishDate: "2026-03-01" },
  ];
  it("handles API filter syntax and relative dates", () => {
    expect(applyFilters(rows, parseApiFilter({ name: "^steel" }), "2026-01-10")).toHaveLength(1);
    expect(applyFilters(rows, parseApiFilter({ budget: { gt: 1000 } }), "2026-01-10")).toHaveLength(1);
    expect(applyFilters(rows, parseApiFilter({ state: ["active", "draft"] }), "2026-01-10")).toHaveLength(2);
    expect(
      applyFilters(rows, [{ field: "finishDate", op: "between", value: ["today", "today+30"] }], "2026-01-10")
    ).toHaveLength(1);
    expect(resolveDateToken("this_week_start", "2026-01-10")).toBe("2026-01-05");
  });
});
