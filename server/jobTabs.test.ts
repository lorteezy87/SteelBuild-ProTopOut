import { describe, expect, it } from "vitest";
import { JOB_TAB_DEFS, JOB_TAB_KEYS, JOB_TAB_LABEL_MAX, isDefaultJobTabs, normalizeJobTabSave, resolveJobTabs, type JobTabRow } from "@shared/jobTabs";

const row = (key: string, position: number, o: Partial<JobTabRow> = {}): JobTabRow => ({ key, position, label: null, hidden: false, ...o });
const rowsOf = (r: ReturnType<typeof normalizeJobTabSave>) => {
  if ("error" in r) throw new Error(r.error);
  return r.rows;
};

describe("registry", () => {
  it("keys are unique and Overview is first and locked", () => {
    expect(new Set(JOB_TAB_KEYS).size).toBe(JOB_TAB_KEYS.length);
    expect(JOB_TAB_DEFS[0]).toMatchObject({ key: "overview", locked: true });
  });
  it("only Financials is restricted to financial access", () => {
    expect(JOB_TAB_DEFS.filter(t => t.fin).map(t => t.key)).toEqual(["financials"]);
  });
});

describe("resolveJobTabs", () => {
  it("a job with no rows shows the registry defaults in order", () => {
    const tabs = resolveJobTabs([]);
    expect(tabs.map(t => t.key)).toEqual(JOB_TAB_KEYS);
    expect(tabs.every(t => !t.hidden && t.label === t.defaultLabel)).toBe(true);
  });
  it("stored rows set the order regardless of the order they arrive in", () => {
    const tabs = resolveJobTabs([row("safety", 1), row("deliveries", 0)]);
    expect(tabs.slice(0, 2).map(t => t.key)).toEqual(["deliveries", "safety"]);
  });
  it("tabs the job has no row for follow in registry order, so new product tabs still appear", () => {
    const tabs = resolveJobTabs([row("safety", 0)]);
    expect(tabs.map(t => t.key)).toEqual(["safety", ...JOB_TAB_KEYS.filter(k => k !== "safety")]);
  });
  it("applies a custom label and keeps the default for reference", () => {
    const [t] = resolveJobTabs([row("logs", 0, { label: "RFIs & Submittals" })]);
    expect(t).toMatchObject({ key: "logs", label: "RFIs & Submittals", defaultLabel: "Logs" });
  });
  it("a blank custom label falls back to the default", () => {
    expect(resolveJobTabs([row("logs", 0, { label: "   " })])[0].label).toBe("Logs");
  });
  it("ignores rows for tabs that no longer exist and duplicate rows", () => {
    const tabs = resolveJobTabs([row("retired_tab", 0), row("qc", 1), row("qc", 2, { hidden: true })]);
    expect(tabs).toHaveLength(JOB_TAB_DEFS.length);
    expect(tabs[0]).toMatchObject({ key: "qc", hidden: false });
  });
  it("a locked tab is never hidden, even if a row says so", () => {
    expect(resolveJobTabs([row("overview", 0, { hidden: true })])[0].hidden).toBe(false);
  });
  it("carries the financial flag through", () => {
    expect(resolveJobTabs([]).find(t => t.key === "financials")?.fin).toBe(true);
  });
});

describe("normalizeJobTabSave", () => {
  it("numbers positions in the order given and appends tabs left out", () => {
    const rows = rowsOf(normalizeJobTabSave([{ key: "deliveries" }, { key: "overview" }]));
    expect(rows.slice(0, 2)).toEqual([row("deliveries", 0), row("overview", 1)]);
    expect(rows).toHaveLength(JOB_TAB_DEFS.length);
    expect(rows.map(r => r.position)).toEqual(rows.map((_, i) => i));
  });
  it("stores a custom label trimmed, and null when it equals the default", () => {
    const rows = rowsOf(normalizeJobTabSave([{ key: "logs", label: "  RFIs  " }, { key: "qc", label: "QC" }]));
    expect(rows[0].label).toBe("RFIs");
    expect(rows[1].label).toBeNull();
  });
  it("rejects unknown tabs, duplicates, over-long names and hiding a locked tab", () => {
    expect(normalizeJobTabSave([{ key: "nope" }])).toEqual({ error: "Unknown tab: nope" });
    expect(normalizeJobTabSave([{ key: "qc" }, { key: "qc" }])).toEqual({ error: "Tab listed twice: qc" });
    expect(normalizeJobTabSave([{ key: "qc", label: "x".repeat(JOB_TAB_LABEL_MAX + 1) }])).toHaveProperty("error");
    expect(normalizeJobTabSave([{ key: "overview", hidden: true }])).toEqual({ error: "Overview cannot be hidden" });
  });
  it("accepts a name exactly at the limit", () => {
    expect(rowsOf(normalizeJobTabSave([{ key: "qc", label: "x".repeat(JOB_TAB_LABEL_MAX) }]))[0].label).toHaveLength(JOB_TAB_LABEL_MAX);
  });
  it("round-trips through resolveJobTabs", () => {
    const input = [{ key: "safety", hidden: true }, { key: "overview" }, { key: "logs", label: "RFIs" }];
    const tabs = resolveJobTabs(rowsOf(normalizeJobTabSave(input)));
    expect(tabs.slice(0, 3).map(t => [t.key, t.label, t.hidden])).toEqual([
      ["safety", "Safety", true],
      ["overview", "Overview", false],
      ["logs", "RFIs", false],
    ]);
  });
});

describe("isDefaultJobTabs", () => {
  it("is true for an untouched save and false after any change", () => {
    const all = JOB_TAB_KEYS.map(key => ({ key }));
    expect(isDefaultJobTabs(rowsOf(normalizeJobTabSave(all)))).toBe(true);
    expect(isDefaultJobTabs(rowsOf(normalizeJobTabSave([])))).toBe(true);
    expect(isDefaultJobTabs(rowsOf(normalizeJobTabSave([{ key: "qc" }])))).toBe(false);
    expect(isDefaultJobTabs(rowsOf(normalizeJobTabSave([{ key: "overview" }, { key: "schedule", hidden: true }])))).toBe(false);
    expect(isDefaultJobTabs(rowsOf(normalizeJobTabSave([{ key: "overview" }, { key: "schedule", label: "CPM" }])))).toBe(false);
    expect(isDefaultJobTabs([])).toBe(false);
  });
});
