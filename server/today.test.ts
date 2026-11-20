import { describe, expect, it } from "vitest";
import { BALL_IN_COURT } from "@shared/ballInCourt";
import { addWorkDays, needsAction } from "@shared/today";

const today = "2026-11-20"; // Friday
const wd = (from: string, n: number) => addWorkDays(from, n);
const item = (o: Partial<Parameters<typeof needsAction>[0]>) => ({ open: true, ballInCourt: "gc" as const, dueDate: null, slaDueAt: null, ...o });

describe("ball in court", () => {
  it("vocabulary", () => {
    expect(BALL_IN_COURT).toEqual(["us", "gc", "eor", "architect", "fabricator", "other"]);
  });
});

describe("needsAction", () => {
  it("ball in our court needs action", () => {
    expect(needsAction(item({ ballInCourt: "us" }), today, wd)).toBe(true);
  });
  it("due within 3 work days needs action", () => {
    expect(needsAction(item({ dueDate: wd(today, 3) }), today, wd)).toBe(true);
    expect(needsAction(item({ dueDate: wd(today, 4) }), today, wd)).toBe(false);
  });
  it("past due needs action", () => {
    expect(needsAction(item({ dueDate: "2026-11-19" }), today, wd)).toBe(true);
  });
  it("an SLA deadline counts like a due date", () => {
    expect(needsAction(item({ slaDueAt: new Date("2026-11-23T17:00:00Z") }), today, wd)).toBe(true);
  });
  it("null due date is never overdue", () => {
    expect(needsAction(item({}), today, wd)).toBe(false);
  });
  it("closed items never need action", () => {
    expect(needsAction(item({ open: false, ballInCourt: "us", dueDate: "2026-11-01" }), today, wd)).toBe(false);
  });
});

describe("work days", () => {
  it("work days skip weekends", () => {
    expect(addWorkDays("2026-11-20", 3)).toBe("2026-11-25");
    expect(addWorkDays("2026-11-20", 0)).toBe("2026-11-20");
  });
});

import { todaySummary } from "@shared/today";
describe("todaySummary", () => {
  const base = { today, sequences: [], deliveries: [], logs: [] };
  it("lists slipping sequences only", () => {
    const r = todaySummary({ ...base, sequences: [
      { id: 1, projectId: 9, name: "Seq 1", scheduleHealth: "delayed", projectedFinish: "2026-12-01" },
      { id: 2, projectId: 9, name: "Seq 2", scheduleHealth: "on_track", projectedFinish: "2026-12-05" },
      { id: 3, projectId: 9, name: "Seq 3", scheduleHealth: "blocked", projectedFinish: null },
    ] });
    expect(r.sequencesAtRisk.map(x => x.id)).toEqual([1, 3]);
  });
  it("loads due in 7 days use the promised date, else the need date; received and undated loads drop out", () => {
    const r = todaySummary({ ...base, deliveries: [
      { id: 1, projectId: 9, loadNumber: "L1", status: "scheduled", promisedDate: "2026-11-27", needDate: "2026-11-30" },
      { id: 2, projectId: 9, loadNumber: "L2", status: "scheduled", promisedDate: null, needDate: "2026-11-25" },
      { id: 3, projectId: 9, loadNumber: "L3", status: "received", promisedDate: "2026-11-21", needDate: null },
      { id: 4, projectId: 9, loadNumber: "L4", status: "scheduled", promisedDate: "2026-11-28", needDate: null },
      { id: 5, projectId: 9, loadNumber: "L5", status: "shipped", promisedDate: null, needDate: null },
    ] });
    expect(r.loadsDue7.map(x => [x.id, x.date])).toEqual([[2, "2026-11-25"], [1, "2026-11-27"]]);
  });
  it("delay-notice deadlines inside 7 days are listed; logs needing action follow needsAction", () => {
    const r = todaySummary({ ...base, logs: [
      { id: 1, projectId: 9, appKey: "delay", label: "DN-001", open: true, ballInCourt: "gc", dueDate: null, slaDueAt: new Date("2026-11-24T00:00:00Z") },
      { id: 2, projectId: 9, appKey: "rfi", label: "RFI-004", open: true, ballInCourt: "us", dueDate: null, slaDueAt: null },
      { id: 3, projectId: 9, appKey: "rfi", label: "RFI-005", open: true, ballInCourt: "eor", dueDate: null, slaDueAt: null },
    ] });
    expect(r.noticeDeadlines.map(x => x.id)).toEqual([1]);
    expect(r.logsNeedingAction.map(x => x.id)).toEqual([1, 2]);
  });
});
