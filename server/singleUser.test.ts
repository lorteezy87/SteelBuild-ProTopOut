import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./bootstrap", () => ({ ensureBootstrap: async () => {} }));
const { appRouter } = await import("./routers");

const ROOT = path.resolve(import.meta.dirname, "..");
const procs = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);

describe("single-user surface", () => {
  it("has no API tokens, webhooks, comments, followers or notifications", () => {
    const banned = procs.filter(p => /^integration\.|^collab\.(comments|addComment|removeComment|followState|setFollow|notifications|markRead)$/.test(p));
    expect(banned).toEqual([]);
  });

  it("has no approval chains", () => {
    expect(procs.filter(p => /^(time\.(approvals|decide|submitWeek)|expenses\.(approvals|approved|decide|submit)|daily\.(submit|approve|reject|pending)|ref\.badges)$/.test(p))).toEqual([]);
    expect(procs).toEqual(expect.arrayContaining(["daily.finalize", "time.recordWeek", "expenses.record", "time.markInvoiced"]));
  });

  it("serves no REST API or webhook dispatcher", () => {
    expect(fs.existsSync(path.join(ROOT, "server/api/v2.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "server/webhooks"))).toBe(false);
  });
});
