import { describe, expect, it } from "vitest";
import { shouldPersistQuery } from "./persist";

describe("which cached data stays on the tablet", () => {
  it("keeps what the daily report needs to open offline", () => {
    for (const p of [["auth", "me"], ["ref", "all"], ["projects", "get"], ["projects", "list"], ["tasks", "list"], ["daily", "list"], ["daily", "get"], ["photos", "list"], ["weather", "day"]])
      expect(shouldPersistQuery([p, { type: "query" }], "success")).toBe(true);
  });
  it("skips money screens, failed queries and anything else", () => {
    expect(shouldPersistQuery([["financials", "summary"], { type: "query" }], "success")).toBe(false);
    expect(shouldPersistQuery([["daily", "get"], { type: "query" }], "error")).toBe(false);
    expect(shouldPersistQuery(["not-trpc"], "success")).toBe(false);
  });
});
