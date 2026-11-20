import { describe, expect, it } from "vitest";
import { liftCheck, liftPlanFields, LIFT_SIGNOFFS } from "@shared/lift";

const chart = [{ radiusFt: 20, capacityLb: 14000 }, { radiusFt: 30, capacityLb: 10000 }];
const setup = { name: "Setup 1", grid1: "C", grid2: "4", offsetXFt: 5, offsetYFt: 0, boomFt: null, counterweight: null };
const model = { name: "100t AT · 80 ft boom" };

describe("lift plan", () => {
  it("lift plan shows not entered for unknowns", () => {
    const pick = { mark: "B12", description: null, pieceLb: 8200, riggingLb: null, radiusFt: 28, radiusSource: "entered" };
    const f = Object.fromEntries(liftPlanFields(pick, setup, model, liftCheck(pick, chart)).map(r => [r.label, r.value]));
    expect(f["Rigging weight"]).toBe("Not entered");
    expect(f["Boom"]).toBe("Not entered");
    expect(f["Counterweight"]).toBe("Not entered");
    expect(f["Status"]).toBe("Critical lift — 82.0 % of chart");
    expect(f["Setup location"]).toBe("C/4 + 5 ft E");
    expect(f["Radius"]).toBe("28.0 ft (entered)");
    expect(f["Chart capacity at radius"]).toBe("10,000 lb");
  });
  it("marks a model-measured radius as needing field confirmation", () => {
    const pick = { mark: "B12", description: null, pieceLb: 1000, riggingLb: 200, radiusFt: 28, radiusSource: "model" };
    const f = Object.fromEntries(liftPlanFields(pick, setup, model, liftCheck(pick, chart)).map(r => [r.label, r.value]));
    expect(f["Radius"]).toBe("28.0 ft (from model — confirm in field)");
    expect(f["Total load"]).toBe("1,200 lb");
  });
  it("has four sign-offs", () => {
    expect(LIFT_SIGNOFFS.map(s => s.label)).toEqual(["Lift supervisor", "Crane operator", "Rigger", "Signal person"]);
  });
});
