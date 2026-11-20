import { describe, expect, it } from "vitest";
import { capacityAt, gridPoint, liftCheck, parseChart, pieceRadiusFt, LIFT_BLOCKED_PCT, LIFT_CRITICAL_PCT } from "@shared/lift";

const rows = [
  { radiusFt: 20, capacityLb: 100000 },
  { radiusFt: 30, capacityLb: 72000 },
  { radiusFt: 40, capacityLb: 51000 },
];

describe("crane chart", () => {
  it("parses a pasted chart", () => {
    const r = parseChart("# 100t\n20 100000\n30, 72k\n\n40\t51000");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual(rows);
  });
  it("reports bad lines by number", () => {
    const r = parseChart("30 0\n40 5000\n40 6000");
    expect(r.errors.some(e => e.includes("line 1"))).toBe(true);
    expect(r.errors.some(e => e.includes("line 3") && e.includes("repeats line 2"))).toBe(true);
    expect(parseChart("twenty 5000").errors[0]).toContain("line 1");
  });
  it("capacity uses the next longer radius", () => {
    expect(capacityAt(rows, 25)).toBe(72000);
    expect(capacityAt(rows, 30)).toBe(72000);
    expect(capacityAt(rows, 40)).toBe(51000);
    expect(capacityAt(rows, 20)).toBe(100000);
  });
});

describe("lift check", () => {
  it("thresholds are 75 and 100 percent", () => {
    expect(LIFT_CRITICAL_PCT).toBe(75);
    expect(LIFT_BLOCKED_PCT).toBe(100);
  });
  it("radius outside the chart is blocked", () => {
    expect(liftCheck({ pieceLb: 1000, riggingLb: 0, radiusFt: 45 }, rows)).toMatchObject({ status: "blocked", reason: "Radius outside chart" });
    expect(liftCheck({ pieceLb: 1000, riggingLb: 0, radiusFt: 15 }, rows).status).toBe("blocked");
  });
  it("75 percent is critical, over 100 is blocked", () => {
    expect(liftCheck({ pieceLb: 50000, riggingLb: 4000, radiusFt: 30 }, rows)).toMatchObject({ status: "critical", pct: 75, totalLb: 54000, capacityLb: 72000 });
    expect(liftCheck({ pieceLb: 72000, riggingLb: 0, radiusFt: 30 }, rows)).toMatchObject({ status: "critical", pct: 100 });
    expect(liftCheck({ pieceLb: 72001, riggingLb: 0, radiusFt: 30 }, rows).status).toBe("blocked");
    expect(liftCheck({ pieceLb: 10000, riggingLb: 500, radiusFt: 30 }, rows)).toMatchObject({ status: "ok", pct: 14.6 });
  });
  it("unknown weight or radius is unknown, not ok", () => {
    expect(liftCheck({ pieceLb: null, riggingLb: 0, radiusFt: 30 }, rows)).toMatchObject({ status: "unknown", reason: "Enter weight", pct: null });
    expect(liftCheck({ pieceLb: 1000, riggingLb: 0, radiusFt: null }, rows)).toMatchObject({ status: "unknown", reason: "Enter radius" });
  });
  it("missing rigging counts as zero and says so", () => {
    const c = liftCheck({ pieceLb: 10000, riggingLb: null, radiusFt: 30 }, rows);
    expect(c.status).toBe("ok");
    expect(c.reason).toContain("rigging not entered");
  });
});

describe("radius from the model", () => {
  const grids = [
    { n: "A", a: [100, 0, 100, 1000] as [number, number, number, number] },
    { n: "1", a: [0, 200, 1000, 200] as [number, number, number, number] },
    { n: "B", a: [300, 0, 300, 1000] as [number, number, number, number] },
  ];
  it("grid intersection and radius from the model", () => {
    expect(gridPoint(grids, "A", "1")).toEqual({ x: 100, y: 200 });
    expect(gridPoint(grids, "A", "B")).toBeNull();
    expect(gridPoint(grids, "A", "Z")).toBeNull();
    const piece = { a: [100, 500, 500, 500] as [number, number, number, number] };
    expect(pieceRadiusFt({ x: 100, y: 200 }, { x: 0, y: 0 }, piece, 10)).toBe(36.1);
    expect(pieceRadiusFt({ x: 100, y: 200 }, { x: 20, y: 0 }, piece, 10)).toBe(30);
    expect(pieceRadiusFt({ x: 100, y: 200 }, { x: 0, y: 0 }, piece, 0)).toBeNull();
  });
});
