import { describe, expect, it } from "vitest";
import { certsDue } from "@shared/certs";
import { billedDays, rentalCost } from "@shared/rentals";
import { gcReportPhoto } from "@shared/photos";
import { fieldsToAdd } from "@shared/safety";
import { rentalCosts } from "./services/recompute";

const today = "2026-11-20";
const base = { dayRate: null, weekRate: null, monthRate: null, plannedOffRentDate: null, callOffNoticeDays: 1, calledOffOn: null, deliveryCharge: null, pickupCharge: null };

describe("review fixes", () => {
  it("an unpriced rental keeps the daily-report cost of the unit and marks cost incomplete", () => {
    const rentals = [{ ...base, id: 2, equipmentId: 4, onRentDate: "2026-11-01", offRentDate: null }];
    const rows = [{ equipmentId: 4, cost: 1200, reportDate: "2026-11-03" }];
    expect(rentalCosts(rentals, rows, today)).toEqual({ equipmentCost: 1200, coveredCost: 0, rentalCost: 0, rentalsUnpriced: 1 });
  });
  it("cost to date never bills future days", () => {
    expect(billedDays("2026-12-01", "2026-12-15", today)).toBe(0);
    expect(billedDays("2026-11-10", "2026-11-30", today)).toBe(10);
    expect(rentalCost({ ...base, id: 1, equipmentId: null, onRentDate: "2026-12-01", offRentDate: "2026-12-15", dayRate: 100, deliveryCharge: 50 }, today).total).toBe(0);
  });
  it("a renewed card clears the expired one from Today", () => {
    const r = certsDue(
      [
        { id: 1, userId: 5, name: "Ana", certType: "fall_protection", expiresOn: "2026-10-01" },
        { id: 2, userId: 5, name: "Ana", certType: "fall_protection", expiresOn: "2028-10-01" },
        { id: 3, userId: 5, name: "Ana", certType: "cpr_first_aid", expiresOn: null },
        { id: 4, userId: 5, name: "Ana", certType: "cpr_first_aid", expiresOn: "2027-10-01" },
        { id: 5, userId: 6, name: "Bo", certType: "cpr_first_aid", expiresOn: "2026-10-01" },
        { id: 6, userId: 6, name: "Bo", certType: "cpr_first_aid", expiresOn: null },
      ],
      today
    );
    expect(r.map(c => c.id)).toEqual([5]);
  });
  it("only fields added by a release are back-filled, once", () => {
    const preset = [{ key: "location" }, { key: "injured_person" }, { key: "treatment" }];
    expect(fieldsToAdd(preset, ["treatment"], [], ["injured_person", "treatment"]).map(f => f.key)).toEqual(["injured_person"]);
    expect(fieldsToAdd(preset, [], ["injured_person"], ["injured_person", "treatment"]).map(f => f.key)).toEqual(["treatment"]);
  });
  it("the GC report takes job photos, never photos on logs", () => {
    const p = (o: object) => ({ category: "photos", day: "2026-11-18", owner: null, links: [] as { entityType: string; entityId: number }[], ...o });
    const wk = { weekStart: "2026-11-16", weekEnd: "2026-11-22", finalReportIds: [9] };
    expect(gcReportPhoto(p({}), wk)).toBe(true);
    expect(gcReportPhoto(p({ day: "2026-11-01" }), wk)).toBe(false);
    expect(gcReportPhoto(p({ owner: { entityType: "logItem", entityId: 3 } }), wk)).toBe(false);
    expect(gcReportPhoto(p({ links: [{ entityType: "logItem", entityId: 3 }] }), wk)).toBe(false);
    expect(gcReportPhoto(p({ category: "delivery_tickets" }), wk)).toBe(false);
    expect(gcReportPhoto(p({ day: "2026-11-01", category: "other", owner: { entityType: "dailyReport", entityId: 9 } }), wk)).toBe(true);
    expect(gcReportPhoto(p({ owner: { entityType: "dailyReport", entityId: 8 } }), wk)).toBe(true);
  });
});
