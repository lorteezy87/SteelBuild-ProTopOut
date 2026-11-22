import { describe, expect, it } from "vitest";
import { VIEW_PREF_MAX_BYTES, isViewPrefScope, isViewPrefScopeId, mergeViewPref, viewPrefBytes } from "@shared/viewPrefs";

describe("view pref addressing", () => {
  it("accepts lowercase dotted scopes", () => {
    for (const s of ["jobs", "jobs.list", "job.tasks.columns"]) expect(isViewPrefScope(s)).toBe(true);
  });
  it("rejects anything that is not a plain dotted name", () => {
    for (const s of ["", "Jobs.list", "jobs..list", ".jobs", "jobs.", "jobs list", "jobs/list", "1jobs", "a".repeat(65)]) expect(isViewPrefScope(s)).toBe(false);
  });
  it("scope ids are short url-safe tokens; empty means app-wide", () => {
    for (const s of ["", "42", "k7mq2xbd", "a_b-c"]) expect(isViewPrefScopeId(s)).toBe(true);
    for (const s of ["a b", "a/b", "é", "x".repeat(65)]) expect(isViewPrefScopeId(s)).toBe(false);
  });
});

describe("viewPrefBytes", () => {
  it("measures the stored JSON in bytes, not characters", () => {
    expect(viewPrefBytes({ a: 1 })).toBe(7);
    expect(viewPrefBytes("é")).toBe(4); // two quotes + a two-byte character
  });
  it("is Infinity for values that cannot be stored", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(viewPrefBytes(loop)).toBe(Infinity);
    expect(viewPrefBytes(undefined)).toBe(Infinity);
    expect(viewPrefBytes(10n)).toBe(Infinity);
  });
  it("a filter list far past any real screen exceeds the cap", () => {
    expect(viewPrefBytes({ states: Array(5000).fill("active") })).toBeGreaterThan(VIEW_PREF_MAX_BYTES);
  });
});

describe("mergeViewPref", () => {
  const defaults = { states: ["active", "draft"], sort: "code", descending: false, pageSize: 50, pinned: null as number | null };

  it("returns the defaults when nothing usable is stored", () => {
    for (const stored of [null, undefined, "x", 7, [1, 2]]) expect(mergeViewPref(defaults, stored)).toEqual(defaults);
  });
  it("lays stored values over defaults key by key", () => {
    expect(mergeViewPref(defaults, { sort: "deadline", descending: true })).toEqual({ ...defaults, sort: "deadline", descending: true });
  });
  it("drops keys the screen no longer declares", () => {
    expect(mergeViewPref(defaults, { sort: "name", legacyColumnWidths: [1, 2, 3] })).toEqual({ ...defaults, sort: "name" });
  });
  it("ignores a stored value whose kind no longer matches the default", () => {
    const merged = mergeViewPref(defaults, { states: "active", sort: 3, descending: "yes", pageSize: null });
    expect(merged).toEqual(defaults);
  });
  it("a null default accepts any stored value", () => {
    expect(mergeViewPref(defaults, { pinned: 12 }).pinned).toBe(12);
  });
  it("does not mutate the defaults", () => {
    const d = { sort: "code" };
    mergeViewPref(d, { sort: "name" });
    expect(d.sort).toBe("code");
  });
});
