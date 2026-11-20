import { describe, expect, it } from "vitest";
import {
  afterHold,
  applyAction,
  blockFor,
  csvCell,
  guessFromFileName,
  issueEffect,
  issueSnapshot,
  matrixCell,
  nextRevNo,
  normSheet,
  pendingRev,
  reviewFacts,
  setIssueLabel,
  setIssueState,
  sheetActions,
  sheetNumberProblem,
} from "../shared/drawings";

const T = "2026-11-05";
const issued = [{ number: 0, state: "issued" }];
const draft = [{ number: 0, state: "draft" }];

describe("sheet numbers", () => {
  it("matches numbers regardless of case, spaces and dash style", () => {
    expect(normSheet("S-201")).toBe(normSheet("s 201"));
    expect(normSheet("S–201")).toBe("s201");
  });
  it("refuses duplicates and clashes, but not the sheet itself", () => {
    const ex = [{ id: 1, sheetNumber: "E1-1" }];
    expect(sheetNumberProblem(ex, "e1-1")).toMatch(/already exists/);
    expect(sheetNumberProblem(ex, "E-11")).toMatch(/Reads as sheet E1-1/);
    expect(sheetNumberProblem(ex, "E1-1", 1)).toBe("");
    expect(sheetNumberProblem(ex, "E-12")).toBe("");
    expect(sheetNumberProblem(ex, "  ")).toMatch(/Enter/);
  });
});

describe("revisions", () => {
  it("numbers the next revision after the highest", () => {
    expect(nextRevNo([])).toBe(0);
    expect(nextRevNo([{ number: 0, state: "superseded" }, { number: 2, state: "issued" }])).toBe(3);
  });
  it("finds the pending revision", () => {
    expect(pendingRev([{ number: 1, state: "issued" }, { number: 2, state: "checked" }])?.number).toBe(2);
    expect(pendingRev(issued)).toBeUndefined();
  });
});

describe("status actions", () => {
  it("only offers submit when an issued revision exists and nothing is pending", () => {
    expect(sheetActions({ status: "DET" }, draft)).toEqual(["hold"]);
    expect(sheetActions({ status: "DET" }, issued)).toEqual(["submit", "hold"]);
    expect(sheetActions({ status: "DET" }, [...issued, { number: 1, state: "draft" }])).toEqual(["hold"]);
  });
  it("explains why submit is refused", () => {
    const r = applyAction({ status: "DET" }, draft, "submit", T);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Sign off and issue Rev 0 — issuing it submits the sheet for review");
    const r2 = applyAction({ status: "DET" }, [...issued, { number: 1, state: "checked" }], "submit", T);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/^Issue Rev 1/);
    const r3 = applyAction({ status: "DET" }, [], "submit", T);
    if (!r3.ok) expect(r3.error).toMatch(/Start a revision/);
  });
  it("submits, approves and returns revise & resubmit with dates and ball in court", () => {
    const s = applyAction({ status: "DET" }, issued, "submit", T);
    expect(s.ok && s.patch).toEqual({ status: "REV", sentDate: T, returnedDate: null, ballInCourt: "GC" });
    const a = applyAction({ status: "REV", sentDate: "2026-11-01" }, issued, "approve", T);
    expect(a.ok && a.patch).toMatchObject({ status: "REL", returnedDate: T, ballInCourt: "—" });
    const r = applyAction({ status: "REV", sentDate: "2026-11-01" }, issued, "revise", T);
    expect(r.ok && r.patch).toMatchObject({ status: "RR", returnedDate: T, ballInCourt: "Detailer" });
  });
  it("refuses approving a sheet that is not in review", () => {
    expect(applyAction({ status: "REL" }, issued, "approve", T).ok).toBe(false);
    expect(applyAction({ status: "HOLD" }, issued, "hold", T).ok).toBe(false);
  });
  it("remembers where a hold came from and returns there", () => {
    const h = applyAction({ status: "REL" }, issued, "hold", T);
    expect(h.ok && h.patch).toEqual({ status: "HOLD", holdFrom: "REL" });
    expect(afterHold({ status: "HOLD", holdFrom: "REL" })).toMatchObject({ status: "REL", ballInCourt: "—", holdFrom: null, holdRfiId: null });
    // an older hold with no record falls back on the sheet's dates
    expect(afterHold({ status: "HOLD", sentDate: "2026-10-01", returnedDate: "2026-10-10" }).status).toBe("RR");
    expect(afterHold({ status: "HOLD", sentDate: "2026-10-01" }).status).toBe("REV");
    expect(afterHold({ status: "HOLD" }).status).toBe("DET");
  });
});

describe("issuing a revision", () => {
  it("sends a reviewed or released sheet back to review", () => {
    for (const s of ["DET", "RR", "REV", "REL"]) {
      expect(issueEffect({ status: s }, T).patch).toEqual({ status: "REV", sentDate: T, returnedDate: null, ballInCourt: "GC" });
    }
    expect(issueEffect({ status: "REL" }, T).note).toMatch(/resubmitted/);
  });
  it("keeps a held sheet held, to return to review when lifted", () => {
    const e = issueEffect({ status: "HOLD", holdFrom: "REL" }, T);
    expect(e.patch).toEqual({ holdFrom: "REV", sentDate: T, returnedDate: null });
    expect(afterHold({ status: "HOLD", ...e.patch }).status).toBe("REV");
  });
});

describe("review clock", () => {
  it("is late only while in review and past the review days", () => {
    expect(reviewFacts({ status: "REV", sentDate: "2026-10-21" }, T)).toEqual({ out: 15, late: true });
    expect(reviewFacts({ status: "REV", sentDate: "2026-10-22" }, T).late).toBe(false);
    expect(reviewFacts({ status: "REL", sentDate: "2026-09-01", returnedDate: "2026-09-20" }, T)).toEqual({ out: 19, late: false });
  });
});

describe("set issues", () => {
  const sheet = (id: number, status: string, revs: { number: number; state: string }[]) => ({ id, sheetNumber: "E-" + id, title: "t", status, revs });
  const kids = [sheet(1, "REL", issued), sheet(2, "REV", issued), sheet(3, "HOLD", issued), sheet(4, "DET", draft)];
  it("work purposes take only released sheets with an issued revision", () => {
    const s = issueSnapshot(kids, "For erection");
    expect(s.sheets.map(x => x.sheetId)).toEqual([1]);
    expect(s.skipped).toEqual([
      { sheet: "E-2", why: "not released (In review)" },
      { sheet: "E-3", why: "on hold" },
      { sheet: "E-4", why: "no issued revision" },
    ]);
  });
  it("other purposes take every issued revision", () => {
    const s = issueSnapshot(kids, "For approval");
    expect(s.sheets.map(x => x.sheetId)).toEqual([1, 2, 3]);
    expect(blockFor({ status: "DET" }, draft, "For record")).toBe("no issued revision");
  });
  it("allows metadata-only revisions but never treats newly issued unreviewed or held revisions as released", () => {
    expect(issueSnapshot([sheet(1, "REL", issued)], "For erection").sheets[0]).toMatchObject({ rev: 0, fileUrl: null });
    const r1 = [{ number: 0, state: "superseded" }, { number: 1, state: "issued" }];
    for (const before of ["REL", "HOLD"]) {
      const effect = issueEffect({ status: before, holdFrom: "REL" }, T);
      const current = { ...sheet(1, before, r1), ...effect.patch };
      expect(issueSnapshot([current], "For erection").sheets).toEqual([]);
    }
  });
  it("labels a set by what holds it back", () => {
    const fmt = (d: string) => d;
    const at = (revs: { number: number; state: string }[]) => revs.map(r => ({ ...r, issuedAt: "2026-11-01" }));
    expect(setIssueLabel(setIssueState([], [sheet(1, "REL", at(issued))]), fmt)).toBe("Issued · 2026-11-01");
    expect(setIssueLabel(setIssueState([], [sheet(1, "REV", at(issued))]), fmt)).toBe("Issued · 1 in review");
    expect(setIssueLabel(setIssueState([], [sheet(1, "REL", at(issued)), sheet(2, "DET", draft)]), fmt)).toBe("1 of 2 issued");
    expect(setIssueLabel(setIssueState([{ number: 2, issueDate: "2026-11-03" }], []), fmt)).toBe("Issue 2 · 2026-11-03");
    expect(setIssueLabel(setIssueState([], [sheet(4, "DET", draft)]), fmt)).toBe("Not issued");
  });
});

describe("release matrix", () => {
  it("shows the worst state of a sequence, a hold first", () => {
    expect(matrixCell([], T)).toBe("—");
    expect(matrixCell([{ status: "REL" }, { status: "HOLD" }, { status: "RR" }], T)).toBe("HOLD");
    expect(matrixCell([{ status: "REL" }, { status: "REV", sentDate: "2026-10-01" }], T)).toBe("LATE");
    expect(matrixCell([{ status: "REL" }, { status: "REV", sentDate: T }], T)).toBe("REV");
    expect(matrixCell([{ status: "REL" }, { status: "DET" }], T)).toBe("DET");
    expect(matrixCell([{ status: "REL" }], T)).toBe("REL");
  });
});

describe("helpers", () => {
  it("guards CSV cells against formulas", () => {
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it("reads sheet numbers and revisions from file names", () => {
    expect(guessFromFileName("E-201 Rev 3 Roof Framing.pdf")).toEqual({ sheetNumber: "E-201", rev: 3, title: "Roof Framing" });
    expect(guessFromFileName("S101_R2.pdf")).toMatchObject({ sheetNumber: "S101", rev: 2 });
    expect(guessFromFileName("E1.1 - Anchor bolt plan.pdf")).toMatchObject({ sheetNumber: "E1.1", rev: null, title: "Anchor bolt plan" });
  });
});
