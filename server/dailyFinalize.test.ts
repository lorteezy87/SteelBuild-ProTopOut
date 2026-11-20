import { describe, expect, it } from "vitest";
import { assertFinalizable, crewTimeLines, progressByTask } from "@shared/dailyPosting";

describe("daily report finalize posting", () => {
  it("finalize posts once", () => {
    expect(() => assertFinalizable("draft")).not.toThrow();
    expect(() => assertFinalizable("final")).toThrow("Report is already final");
  });

  it("splits crew hours into straight and overtime lines", () => {
    const lines = crewTimeLines([{ userId: 7, taskId: 3, stHours: 8, otHours: 2 }]);
    expect(lines).toEqual([
      { userId: 7, taskId: 3, hours: 8, kind: "st" },
      { userId: 7, taskId: 3, hours: 2, kind: "ot" },
    ]);
    expect(lines.reduce((s, l) => s + l.hours, 0)).toBe(10);
  });

  it("skips crew lines without a person and zero hours", () => {
    expect(crewTimeLines([{ userId: null, taskId: null, stHours: 8, otHours: 0 }, { userId: 2, taskId: null, stHours: 0, otHours: 0 }])).toEqual([]);
  });

  it("sums erected tons and pieces per sequence", () => {
    expect(progressByTask([{ taskId: 5, tons: 12.5, pieces: 40 }, { taskId: 5, tons: 0.25, pieces: 1 }, { taskId: 6, tons: 3, pieces: 9 }])).toEqual(
      new Map([["5:set", { taskId: 5, stage: "set", tons: 12.75, pieces: 41 }], ["6:set", { taskId: 6, stage: "set", tons: 3, pieces: 9 }]]),
    );
  });
});

import { COSTED_STATES, EDITABLE_STATES, ENTRY_STATES } from "@shared/entryStates";
describe("time and expense states", () => {
  it("are saved, recorded, invoiced", () => {
    expect(Object.keys(ENTRY_STATES)).toEqual(["saved", "recorded", "invoiced"]);
  });
  it("only saved entries are editable", () => {
    expect(EDITABLE_STATES).toEqual(["saved"]);
  });
  it("recorded and invoiced entries count as cost; saved drafts do not", () => {
    expect(COSTED_STATES).toEqual(["recorded", "invoiced"]);
  });
});

import { reopenStartReset } from "@shared/dailyPosting";
describe("reopen undoes a start it caused", () => {
  it("sequence with no set steel left returns to not started", () => {
    expect(reopenStartReset({ status: "in_progress", actualStart: "2026-11-20", erectedTonsAfter: 0, otherPostedSet: false }, "2026-11-20")).toEqual({ status: "not_started", actualStart: null, percentComplete: 0 });
  });
  it("keeps the start when other posted set steel exists or tons remain", () => {
    expect(reopenStartReset({ status: "in_progress", actualStart: "2026-11-18", erectedTonsAfter: 0, otherPostedSet: true }, "2026-11-20")).toBeNull();
    expect(reopenStartReset({ status: "in_progress", actualStart: "2026-11-18", erectedTonsAfter: 5, otherPostedSet: false }, "2026-11-20")).toBeNull();
  });
  it("keeps a start that predates the report (this report did not start it)", () => {
    expect(reopenStartReset({ status: "in_progress", actualStart: "2026-11-10", erectedTonsAfter: 0, otherPostedSet: false }, "2026-11-20")).toBeNull();
  });
});
