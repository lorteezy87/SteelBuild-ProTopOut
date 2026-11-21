import { describe, expect, it } from "vitest";
import { saveDecision } from "@shared/offline";

const row = (o: Partial<{ id: number; projectId: number; status: string; saveRev: string | null }> = {}) => ({ id: 5, projectId: 1, status: "draft", saveRev: "rev-1", ...o });

describe("daily report save decision", () => {
  it("a new report inserts", () => {
    expect(saveDecision({ existing: null, input: { projectId: 1 } })).toEqual({ action: "insert" });
  });
  it("a replay of a create whose answer was lost updates the report it made, not a second one", () => {
    expect(saveDecision({ existing: row(), input: { projectId: 1, clientKey: "k", saveRev: "rev-2" } })).toEqual({ action: "update", id: 5 });
  });
  it("a replay of a save the server already applied is done — not a conflict, even if it was finalized since", () => {
    expect(saveDecision({ existing: row({ saveRev: "rev-2" }), input: { id: 5, projectId: 1, saveRev: "rev-2", baseRev: "rev-1" } })).toEqual({ action: "done", id: 5 });
    expect(saveDecision({ existing: row({ saveRev: "rev-2", status: "final" }), input: { id: 5, projectId: 1, saveRev: "rev-2", baseRev: "rev-1" } })).toEqual({ action: "done", id: 5 });
  });
  it("an edit made from the stored revision updates", () => {
    expect(saveDecision({ existing: row(), input: { id: 5, projectId: 1, saveRev: "rev-2", baseRev: "rev-1" } })).toEqual({ action: "update", id: 5 });
  });
  it("an edit made from any other revision is a conflict — including a report saved before revisions existed", () => {
    expect(saveDecision({ existing: row({ saveRev: "rev-9" }), input: { id: 5, projectId: 1, saveRev: "rev-2", baseRev: "rev-1" } })).toEqual({ error: "conflict" });
    expect(saveDecision({ existing: row({ saveRev: null }), input: { id: 5, projectId: 1, saveRev: "rev-2", baseRev: "rev-1" } })).toEqual({ error: "conflict" });
    expect(saveDecision({ existing: row({ saveRev: null }), input: { id: 5, projectId: 1, saveRev: "rev-2", baseRev: null } })).toEqual({ action: "update", id: 5 });
  });
  it("no base revision means overwrite (the PM chose 'keep mine')", () => {
    expect(saveDecision({ existing: row({ saveRev: "rev-9" }), input: { id: 5, projectId: 1, saveRev: "rev-2" } })).toEqual({ action: "update", id: 5 });
  });
  it("refuses a report that is no longer a draft, on another job, or deleted", () => {
    expect(saveDecision({ existing: row({ status: "final" }), input: { id: 5, projectId: 1, saveRev: "rev-2" } })).toEqual({ error: "not_draft" });
    expect(saveDecision({ existing: row({ projectId: 2 }), input: { id: 5, projectId: 1 } })).toEqual({ error: "wrong_job" });
    expect(saveDecision({ existing: null, input: { id: 5, projectId: 1 } })).toEqual({ error: "missing" });
  });
});
