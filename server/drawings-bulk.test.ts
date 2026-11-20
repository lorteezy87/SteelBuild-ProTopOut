import { describe, expect, it } from "vitest";
import { applyAction, reviewRevisionProblem, sheetEditProblem } from "../shared/drawings";

const today = "2026-11-06";
const issued = { id: 12, number: 1, state: "issued" };

describe("bulk review revision protection", () => {
  it("accepts only the actual issued revision ID, not its number or an older revision", () => {
    const revs = [{ id: 11, number: 0, state: "superseded" }, issued, { id: 13, number: 2, state: "draft" }];
    expect(reviewRevisionProblem(revs, 12)).toBe("");
    for (const observed of [undefined, 1, 11, 13, 99]) expect(reviewRevisionProblem(revs, observed)).toMatch(/issued revision.*changed/);
  });
  it("fails closed if the observed issued revision is missing or superseded", () => {
    expect(reviewRevisionProblem([], 12)).toMatch(/missing/);
    expect(reviewRevisionProblem([{ ...issued, state: "superseded" }], 12)).toMatch(/missing/);
  });
  it("retains applyAction's skip reason for a mixed-status selection", () => {
    const review = applyAction({ status: "REV", sentDate: today }, [issued], "approve", today);
    const released = applyAction({ status: "REL", sentDate: today, returnedDate: today }, [issued], "approve", today);
    expect(review.ok && review.patch.status).toBe("REL");
    expect(released).toEqual({ ok: false, error: "“Mark approved” is not available while the sheet is released" });
  });
});

describe("bulk partial-edit date rules", () => {
  const review = { status: "REV", sentDate: "2026-11-02", returnedDate: null };
  const released = { status: "REL", sentDate: "2026-11-02", returnedDate: "2026-11-04" };
  it("leaves dates unchanged when they are omitted or undefined", () => {
    expect(sheetEditProblem(review, {}, today)).toBe("");
    expect(sheetEditProblem(released, { sentDate: undefined, returnedDate: undefined }, today)).toBe("");
  });
  it("allows explicitly clearing dates only where the current status permits it", () => {
    expect(sheetEditProblem({ status: "DET", sentDate: today, returnedDate: today }, { sentDate: null, returnedDate: null }, today)).toBe("");
    for (const status of ["REV", "RR", "REL"]) expect(sheetEditProblem({ ...released, status }, { sentDate: null }, today)).toMatch(/needs its sent date/);
    for (const status of ["RR", "REL"]) expect(sheetEditProblem({ ...released, status }, { returnedDate: null }, today)).toMatch(/needs its returned date/);
    expect(sheetEditProblem(review, { returnedDate: null }, today)).toBe("");
  });
  it("does not turn a date edit into review approval", () => {
    expect(sheetEditProblem(review, { returnedDate: today }, today)).toMatch(/has not been returned/);
  });
  it("compares a changed date with the unchanged other date", () => {
    expect(sheetEditProblem(released, { sentDate: "2026-11-05" }, today)).toMatch(/before the sent date/);
    expect(sheetEditProblem(released, { returnedDate: "2026-11-01" }, today)).toMatch(/before the sent date/);
    expect(sheetEditProblem(released, { sentDate: "2026-11-03", returnedDate: "2026-11-05" }, today)).toBe("");
  });
  it("rejects future dates, and accepts a same-day review round", () => {
    expect(sheetEditProblem(review, { sentDate: "2026-11-07" }, today)).toMatch(/future/);
    expect(sheetEditProblem(released, { returnedDate: "2026-11-07" }, today)).toMatch(/future/);
    expect(sheetEditProblem(released, { sentDate: today, returnedDate: today }, today)).toBe("");
  });
  it("keeps the same hold-date behavior as single-sheet edits", () => {
    expect(sheetEditProblem({ status: "HOLD", holdFrom: "REL", sentDate: today, returnedDate: today }, { sentDate: null, returnedDate: null }, today)).toBe("");
    expect(sheetEditProblem({ status: "HOLD", sentDate: today, returnedDate: today }, { returnedDate: "2026-11-01" }, today)).toMatch(/before the sent date/);
  });
});
