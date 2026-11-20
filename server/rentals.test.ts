import { describe, expect, it } from "vitest";
import { billedDays, callOffStatus, coveredByRental, rentalCharge, rentalCost, standbyDays, type RentalIn } from "@shared/rentals";
import { todaySummary } from "@shared/today";

const today = "2026-11-20";
const R = { dayRate: 500, weekRate: 1500, monthRate: 4000 };
const rental = (o: Partial<RentalIn> = {}): RentalIn => ({
  id: 1,
  equipmentId: 4,
  onRentDate: "2026-11-01",
  offRentDate: null,
  plannedOffRentDate: "2026-11-25",
  callOffNoticeDays: 2,
  calledOffOn: null,
  dayRate: null,
  weekRate: null,
  monthRate: null,
  deliveryCharge: null,
  pickupCharge: null,
  ...o,
});

describe("rental billing", () => {
  it("billed days exclude the pickup day, minimum one", () => {
    expect(billedDays("2026-11-01", "2026-11-08", today)).toBe(7);
    expect(billedDays("2026-11-01", "2026-11-01", today)).toBe(1);
    expect(billedDays("2026-11-01", null, today)).toBe(19);
    expect(billedDays("2026-11-25", null, today)).toBe(0);
  });
  it("cheapest rental billing", () => {
    expect(rentalCharge(3, R)).toBe(1500);
    expect(rentalCharge(2, R)).toBe(1000);
    expect(rentalCharge(10, R)).toBe(3000);
    expect(rentalCharge(27, R)).toBe(4000);
    expect(rentalCharge(30, R)).toBe(5000);
    expect(rentalCharge(0, R)).toBe(0);
  });
  it("missing lower rates prorate from the next rate up", () => {
    expect(rentalCharge(7, { dayRate: null, weekRate: null, monthRate: 2800 })).toBe(700);
    expect(rentalCharge(1, { dayRate: null, weekRate: 1400, monthRate: null })).toBe(200);
  });
  it("no rates is unknown cost", () => {
    expect(rentalCharge(5, { dayRate: null, weekRate: null, monthRate: null })).toBeNull();
    const c = rentalCost(rental({ deliveryCharge: 350 }), today);
    expect(c.charge).toBeNull();
    expect(c.total).toBeNull();
  });
  it("delivery and pickup add to a known charge", () => {
    const c = rentalCost(rental({ offRentDate: "2026-11-08", ...R, deliveryCharge: 350, pickupCharge: 350 }), today);
    expect(c).toEqual({ days: 7, charge: 1500, total: 2200 });
  });
});

describe("call-off reminders", () => {
  it("past planned off-rent is overdue", () => {
    expect(callOffStatus(rental({ plannedOffRentDate: "2026-11-18" }), today).status).toBe("overdue");
  });
  it("call-off windows", () => {
    expect(callOffStatus(rental(), today)).toEqual({ status: "call_off_soon", callBy: "2026-11-23" });
    expect(callOffStatus(rental(), "2026-11-23").status).toBe("call_off_now");
    expect(callOffStatus(rental(), "2026-11-19").status).toBe("on_rent");
    expect(callOffStatus(rental({ calledOffOn: "2026-11-20" }), today).status).toBe("called_off");
    expect(callOffStatus(rental({ plannedOffRentDate: null }), today)).toEqual({ status: "no_planned_date", callBy: null });
    expect(callOffStatus(rental({ offRentDate: "2026-11-10" }), today).status).toBe("off_rent");
    expect(callOffStatus(rental({ onRentDate: "2026-12-01" }), today).status).toBe("not_yet_on_rent");
  });
});

describe("rental cost into job financials", () => {
  it("daily equipment covered by a rental is not double counted", () => {
    const rs = [rental({ offRentDate: "2026-11-10" })];
    expect(coveredByRental(rs, 4, "2026-11-10")).toBe(true);
    expect(coveredByRental(rs, 4, "2026-11-01")).toBe(true);
    expect(coveredByRental(rs, 4, "2026-11-11")).toBe(false);
    expect(coveredByRental(rs, 4, "2026-10-31")).toBe(false);
    expect(coveredByRental(rs, 5, "2026-11-05")).toBe(false);
    expect(coveredByRental([rental()], 4, "2027-01-01")).toBe(true);
  });
  it("standby days count idle days in the window only", () => {
    const rows = [
      { reportDate: "2026-11-02", standbyHours: 8, operatingHours: 0 },
      { reportDate: "2026-11-02", standbyHours: 8, operatingHours: 0 },
      { reportDate: "2026-11-03", standbyHours: 4, operatingHours: 4 },
      { reportDate: "2026-11-12", standbyHours: 8, operatingHours: 0 },
    ];
    expect(standbyDays(rows, { onRentDate: "2026-11-01", offRentDate: "2026-11-10" })).toBe(1);
  });
});

describe("Today: rentals to call off", () => {
  it("Today lists rentals to call off, overdue first", () => {
    const r = todaySummary({
      today,
      sequences: [],
      deliveries: [],
      logs: [],
      rentals: [
        { ...rental({ id: 1 }), projectId: 9, description: "Manlift 60'" },
        { ...rental({ id: 2, plannedOffRentDate: "2026-11-18" }), projectId: 9, description: "Grove RT890E" },
        { ...rental({ id: 3, plannedOffRentDate: "2026-12-30" }), projectId: 9, description: "Welder" },
        { ...rental({ id: 4, offRentDate: "2026-11-02" }), projectId: 9, description: "Forklift" },
      ],
    });
    expect(r.rentalsToCallOff.map(x => [x.id, x.status])).toEqual([
      [2, "overdue"],
      [1, "call_off_soon"],
    ]);
    expect(r.rentalsToCallOff[1]).toMatchObject({ label: "Manlift 60'", date: "2026-11-23", projectId: 9 });
  });
});
