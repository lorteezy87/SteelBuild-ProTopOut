import { describe, expect, it } from "vitest";
import { assertReopenable } from "@shared/dailyPosting";
import { ENTRY_STATES as ENTRY } from "@shared/entryStates";
import { REPORT_SOURCES } from "@shared/reports";
import { assertBootConfig } from "./_core/env";

describe("review fixes", () => {
  it("reopen is refused once any posted hours are invoiced", () => {
    expect(() => assertReopenable([{ state: "recorded" }, { state: "recorded" }])).not.toThrow();
    expect(() => assertReopenable([])).not.toThrow();
    expect(() => assertReopenable([{ state: "recorded" }, { state: "invoiced" }])).toThrow("Hours from this report are already invoiced");
  });

  it("time and expense report state filters use saved/recorded/invoiced", () => {
    for (const key of ["time", "expenses"] as const) {
      const src = REPORT_SOURCES[key];
      const col = src.columns.find(c => c.key === "state");
      expect(col?.options).toEqual(ENTRY);
    }
  });

  it("server refuses to boot without a session secret", () => {
    expect(() => assertBootConfig({ DATABASE_URL: "mysql://x", SESSION_SECRET: "" })).toThrow("SESSION_SECRET");
    expect(() => assertBootConfig({ DATABASE_URL: "mysql://x", SESSION_SECRET: "short" })).toThrow("at least 32 characters");
    expect(() => assertBootConfig({ DATABASE_URL: "mysql://x", SESSION_SECRET: "x".repeat(32) })).not.toThrow();
  });
});
