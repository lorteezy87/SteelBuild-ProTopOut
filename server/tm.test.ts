import { describe, expect, it } from "vitest";
import { assertTicketEditable, lineAmount, linesFromDailyReport, ticketTotals, TM_LINE_KINDS, TM_STATUSES } from "@shared/tm";

describe("T&M tickets", () => {
  it("kinds and statuses", () => {
    expect(Object.keys(TM_LINE_KINDS)).toEqual(["labor", "equipment", "material"]);
    expect(Object.keys(TM_STATUSES)).toEqual(["draft", "signed", "void"]);
  });
  it("line amount includes overtime", () => {
    expect(lineAmount({ kind: "labor", description: "x", qty: 8, unit: "hr", rate: 95, otQty: 2, otRate: 142.5 })).toBe(1045);
    expect(lineAmount({ kind: "material", description: "bolts", qty: 3, unit: "box", rate: 41.333 })).toBe(124);
  });
  it("totals apply markup per kind", () => {
    const t = ticketTotals(
      [
        { kind: "labor", description: "a", qty: 10, unit: "hr", rate: 100 },
        { kind: "equipment", description: "b", qty: 5, unit: "hr", rate: 100 },
        { kind: "material", description: "c", qty: 1, unit: "ea", rate: 200 },
      ],
      { labor: 15, equipment: 10, material: 0 },
    );
    expect(t.byKind.labor).toEqual({ subtotal: 1000, markup: 150, total: 1150 });
    expect(t.byKind.equipment.total).toBe(550);
    expect(t.byKind.material.total).toBe(200);
    expect(t.grandTotal).toBe(1900);
  });
  it("daily report prefill", () => {
    const lines = linesFromDailyReport({
      crew: [
        { name: "J. Ortiz", classification: "Journeyman", stHours: 8, otHours: 2, billRate: 95, otMultiplier: 1.5 },
        { name: "No Hours", classification: null, stHours: 0, otHours: 0, billRate: 80, otMultiplier: 1.5 },
      ],
      equipment: [{ name: "100t AT crane", operatingHours: 6, standbyHours: 2, hourlyRate: 300, standbyRate: 150 }],
    });
    expect(lines).toEqual([
      { kind: "labor", description: "J. Ortiz — Journeyman", qty: 8, unit: "hr", rate: 95, otQty: 2, otRate: 142.5 },
      { kind: "equipment", description: "100t AT crane", qty: 6, unit: "hr", rate: 300 },
      { kind: "equipment", description: "100t AT crane — standby", qty: 2, unit: "hr", rate: 150 },
    ]);
  });
  it("signed ticket is locked", () => {
    expect(() => assertTicketEditable("signed")).toThrow("Signed tickets can't be changed — void and reissue");
    expect(() => assertTicketEditable("void")).toThrow("Void tickets can't be changed");
    expect(() => assertTicketEditable("draft")).not.toThrow();
  });
});

import { unpricedLines } from "@shared/tm";
describe("review fix: unpriced lines block signing", () => {
  it("names lines with quantity but no rate", () => {
    expect(
      unpricedLines([
        { kind: "labor", description: "A. Crew", qty: 8, unit: "hr", rate: 0 },
        { kind: "labor", description: "B. Crew", qty: 0, unit: "hr", rate: 0, otQty: 2, otRate: 0 },
        { kind: "material", description: "Bolts", qty: 0, unit: "ea", rate: 0 },
        { kind: "equipment", description: "Crane", qty: 6, unit: "hr", rate: 300 },
      ]),
    ).toEqual(["A. Crew", "B. Crew"]);
  });
});
