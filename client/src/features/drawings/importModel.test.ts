import { describe, expect, it } from "vitest";
import { duplicateKeys, matchOf, nextSetNumber, repeatingRead, rowProblem, sequenceFor, setNameFromFile } from "./importModel";
import { parseTbText, tbRev, tbRevDate } from "./pdf";

const sheet = (id: number, sheetNumber: string, revs: [number, string][]) => ({ id, sheetNumber, setId: null, revs: revs.map(([number, state]) => ({ number, state })) });
const reg = [sheet(1, "E-101", [[0, "superseded"], [1, "issued"]]), sheet(2, "E1-1", [[0, "issued"], [1, "draft"]]), sheet(3, "S-301", [[2, "issued"]])];
const F = (s: string, rev: string, title = "T") => ({ sheet: s, rev, title, seqId: null, revDate: "", revDesc: "" });

describe("matching an import row to the register", () => {
  it("adds a new sheet, assuming Rev 0 only when none was read", () => {
    expect(matchOf(reg, F("E-200", "3"))).toMatchObject({ kind: "new", assumed: false });
    expect(matchOf(reg, F("E-200", ""))).toMatchObject({ kind: "new", assumed: true });
  });
  it("adds a revision only when it is higher than every revision", () => {
    expect(matchOf(reg, F("e 101".replace(" ", "-"), "2"))).toMatchObject({ kind: "rev", top: 1, jump: false });
    expect(matchOf(reg, F("E-101", "9"))).toMatchObject({ kind: "rev", jump: true });
    expect(matchOf(reg, F("E-101", "1"))).toMatchObject({ kind: "skip", logged: true });
    expect(matchOf(reg, F("E-101", "0"))).toMatchObject({ kind: "older", top: 1 });
    expect(matchOf(reg, F("E-101", ""))).toMatchObject({ kind: "norev" });
  });
  it("waits while a revision is pending", () => {
    expect(matchOf(reg, F("E1-1", "5"))).toMatchObject({ kind: "skip", logged: false, label: "Rev 1 already pending" });
  });
  it("flags a number written differently from the register's", () => {
    expect(matchOf(reg, F("E-11", "2"))).toMatchObject({ kind: "clash", label: expect.stringContaining("E1-1") });
    expect(matchOf(reg, F("", "2")).kind).toBe("none");
  });
  it("says what a row needs before it can be added", () => {
    expect(rowProblem(F("E-200", "0", " "), matchOf(reg, F("E-200", "0")))).toMatch(/title/);
    expect(rowProblem(F("E-200", "x"), matchOf(reg, F("E-200", "x")))).toMatch(/whole number/);
    expect(rowProblem(F("E-200", "0"), matchOf(reg, F("E-200", "0")))).toBe("");
    expect(rowProblem(F("E-101", "1"), matchOf(reg, F("E-101", "1")))).toMatch(/Already logged/);
  });
});

describe("batch checks", () => {
  it("finds the same sheet twice however written", () => {
    const rows = [
      { key: "a", f: { sheet: "S-301" }, include: true },
      { key: "b", f: { sheet: "s 301" }, include: true },
      { key: "c", f: { sheet: "S-302" }, include: true },
      { key: "d", f: { sheet: "S-302" }, include: false },
    ];
    expect([...duplicateKeys(rows)]).toEqual(["b"]);
  });
  it("spots a box catching text every sheet shares", () => {
    expect(repeatingRead([F("A1", ""), F("A1", ""), F("A1", "")])).toBe("sheet");
    expect(repeatingRead([F("A1", "", "PROJECT X"), F("A2", "", "PROJECT X"), F("A3", "", "Plan")])).toBe("title");
    expect(repeatingRead([F("A1", "", "a"), F("A2", "", "b"), F("A3", "", "c")])).toBeNull();
  });
  it("matches a title's sequence to the job's sequences", () => {
    const seqs = [{ id: 7, name: "Seq 1 — Grids 1-3" }, { id: 8, name: "Sequence 2 / Roof" }];
    expect(sequenceFor("SEQ 2 ROOF FRAMING PLAN", seqs)).toBe(8);
    expect(sequenceFor("ANCHOR BOLT PLAN", seqs)).toBeNull();
  });
  it("names and numbers a new set", () => {
    expect(setNameFromFile("Seq_4 framing.pdf")).toBe("Seq 4 framing");
    expect(nextSetNumber([{ number: "E-SET-01" }, { number: "E-SET-07" }], "erection")).toBe("E-SET-08");
    expect(nextSetNumber([], "shop")).toBe("SH-SET-01");
  });
});

describe("title-block text", () => {
  it("reads a lettered sheet number over a project number", () => {
    expect(parseTbText(["PROJ NO 2025-118  SHEET S-301", "", ""]).sheet).toBe("S-301");
    expect(parseTbText(["DWG NO.  E 7035", "", ""]).sheet).toBe("E7035");
  });
  it("joins a multi-line title and drops its label", () => {
    expect(parseTbText(["", "TITLE: SEQ 3\nROOF FRAMING PLAN", ""]).title).toBe("SEQ 3 ROOF FRAMING PLAN");
  });
  it("reads the highest numbered revision and ignores review letters", () => {
    expect(tbRev("A 09/01/26 IFR\nB 09/15/26 RPC\n0 10/01/26 IFC\n1 10/20/26 REV").rev).toBe("1");
    expect(tbRev("A 09/01/26 IFR\nB 09/15/26 RPC")).toEqual({ rev: "2", letter: "B" });
    expect(tbRev("REV 3").rev).toBe("3");
    expect(tbRev("")).toEqual({ rev: "", letter: "" });
  });
  it("finds the date of the stated revision", () => {
    expect(tbRevDate("0 10/01/26 IFC\n1 10/20/2026 REV", "1")).toBe("2026-10-20");
    expect(tbRevDate("1  2026-09-01  IFC", "1")).toBe("2026-09-01");
    expect(tbRevDate("1 10/20/26", "2")).toBe("");
    expect(tbRevDate("A   08/01/26   IFR\nB   08/20/26   COMMENTS", "B")).toBe("2026-08-20");
  });
});
