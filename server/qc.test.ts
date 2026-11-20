import { describe, expect, it } from "vitest";
import { boltPunchTitle, canCreatePunch, inspectionPunchTitle, sequenceQcStatus, weldPunchTitle } from "@shared/qc";

describe("QC deficiencies → punch", () => {
  it("only an unlinked failed entry can create a punch item", () => {
    expect(canCreatePunch({ result: "pending", punchItemId: null }).ok).toBe(false);
    expect(canCreatePunch({ result: "pass", punchItemId: null }).ok).toBe(false);
    expect(canCreatePunch({ result: "fail", punchItemId: null }).ok).toBe(true);
    const linked = canCreatePunch({ result: "fail", punchItemId: 7 });
    expect(linked.ok).toBe(false);
    expect(!linked.ok && linked.reason).toContain("already created");
  });

  it("punch titles name the location and method", () => {
    expect(boltPunchTitle({ location: "Grid C/4 L2", grade: "a325", method: "turn_of_nut" })).toBe(
      "Bolting deficiency — Grid C/4 L2 (A325 / F3125 Gr A325, Turn-of-nut)"
    );
    expect(weldPunchTitle({ location: "Col D/7 splice", process: "fcaw" })).toBe("Weld deficiency — Col D/7 splice (FCAW)");
    expect(inspectionPunchTitle({ type: "studs", reportNumber: "SI-12" })).toBe("Special inspection failed — Shear studs (report SI-12)");
    expect(inspectionPunchTitle({ type: "studs", reportNumber: null })).toBe("Special inspection failed — Shear studs");
  });
});

describe("sequence QC status", () => {
  const pass = { result: "pass" as const, punchItemId: null };
  it("no rows is no records, not clear", () => {
    expect(sequenceQcStatus({ bolt: [], weld: [], inspections: [] })).toBe("no_records");
  });
  it("all passing is clear", () => {
    expect(sequenceQcStatus({ bolt: [], weld: [pass], inspections: [] })).toBe("clear");
  });
  it("open inspection is pending", () => {
    expect(sequenceQcStatus({ bolt: [], weld: [pass], inspections: [{ result: "scheduled" }] })).toBe("pending");
    expect(sequenceQcStatus({ bolt: [], weld: [], inspections: [{ result: "na" }] })).toBe("clear");
  });
  it("any failure is a deficiency", () => {
    expect(sequenceQcStatus({ bolt: [{ result: "fail", punchItemId: null }], weld: [], inspections: [{ result: "passed" }] })).toBe("deficiency");
    expect(sequenceQcStatus({ bolt: [], weld: [], inspections: [{ result: "failed" }] })).toBe("deficiency");
  });
});
