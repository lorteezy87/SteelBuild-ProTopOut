import { describe, expect, it } from "vitest";
import { saveDecision } from "@shared/offline";

const at = (s: string) => new Date(s);
const row = (o: Partial<{ id: number; projectId: number; status: string; updatedAt: Date }> = {}) => ({ id: 5, projectId: 1, status: "draft", updatedAt: at("2026-11-21T10:00:00Z"), ...o });

describe("daily report save decision", () => {
  it("a new report inserts", () => {
    expect(saveDecision({ existing: null, input: { projectId: 1 } })).toEqual({ action: "insert" });
  });
  it("a replay of a create whose answer was lost updates the report it made, not a second one", () => {
    expect(saveDecision({ existing: row(), input: { projectId: 1, clientKey: "k" } })).toEqual({ action: "update", id: 5 });
  });
  it("an edit made from the version still stored updates (stored times are whole seconds)", () => {
    expect(saveDecision({ existing: row(), input: { id: 5, projectId: 1, baseUpdatedAt: at("2026-11-21T10:00:00.640Z") } })).toEqual({ action: "update", id: 5 });
  });
  it("an edit made from an older version is a conflict", () => {
    expect(saveDecision({ existing: row({ updatedAt: at("2026-11-21T11:30:00Z") }), input: { id: 5, projectId: 1, baseUpdatedAt: at("2026-11-21T10:00:00Z") } })).toEqual({ error: "conflict" });
  });
  it("no base version means overwrite (the PM chose 'keep mine', or an online save)", () => {
    expect(saveDecision({ existing: row({ updatedAt: at("2026-11-21T11:30:00Z") }), input: { id: 5, projectId: 1 } })).toEqual({ action: "update", id: 5 });
  });
  it("refuses a report that is no longer a draft, on another job, or deleted", () => {
    expect(saveDecision({ existing: row({ status: "approved" }), input: { id: 5, projectId: 1 } })).toEqual({ error: "not_draft" });
    expect(saveDecision({ existing: row({ projectId: 2 }), input: { id: 5, projectId: 1 } })).toEqual({ error: "wrong_job" });
    expect(saveDecision({ existing: null, input: { id: 5, projectId: 1 } })).toEqual({ error: "missing" });
  });
});
