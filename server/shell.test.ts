import { describe, expect, it } from "vitest";
import { EMPTY_SHELL_COUNTS, NAV_BADGE_HINT, badgeText, navBadges, toCount } from "@shared/shell";

describe("toCount", () => {
  it("accepts what SQL drivers return for an aggregate", () => {
    expect(toCount("12")).toBe(12);
    expect(toCount(12n)).toBe(12);
    expect(toCount(3.9)).toBe(3);
  });
  it("turns missing, negative and non-numeric values into zero", () => {
    for (const v of [null, undefined, "", "abc", -4, NaN, Infinity, {}]) expect(toCount(v)).toBe(0);
  });
});

describe("navBadges", () => {
  it("shows nothing when there is nothing to chase", () => {
    expect(navBadges(EMPTY_SHELL_COUNTS)).toEqual({});
  });
  it("maps each count to its destination", () => {
    expect(navBadges({ logsPastDue: 2, logsOurCourt: 5, jobsDelayed: 1 })).toEqual({ "/": 2, "/jobs": 1, "/logs": 5 });
  });
  it("leaves out destinations with a zero count", () => {
    expect(navBadges({ logsPastDue: 0, logsOurCourt: 4, jobsDelayed: 0 })).toEqual({ "/logs": 4 });
  });
  it("every badge has a hint that reads correctly in singular and plural", () => {
    const badges = navBadges({ logsPastDue: 1, logsOurCourt: 1, jobsDelayed: 1 });
    for (const href of Object.keys(badges)) expect(NAV_BADGE_HINT[href]).toBeTypeOf("function");
    expect(NAV_BADGE_HINT["/"](1)).toBe("1 log item past due");
    expect(NAV_BADGE_HINT["/"](3)).toBe("3 log items past due");
    expect(NAV_BADGE_HINT["/jobs"](2)).toBe("2 active jobs behind schedule");
    expect(NAV_BADGE_HINT["/logs"](1)).toBe("1 open item with the ball in our court");
  });
});

describe("badgeText", () => {
  it("caps at 99+", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
