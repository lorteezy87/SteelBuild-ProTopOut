// Pieces, weights, records and review (ported from SteelBuild test/model-v55.test.js and the review / forms / viewer
// logic of test/model-ui-v55.test.js). This app has no piece-mark daily-log stages, so the stage assertions are not
// ported; everything else is.
import { describe, expect, it } from "vitest";
import { H, pc, rec, sheet, sheetOf, W } from "./fixtures";
import { MD, REVIEW, cleanFields, type Piece, type ReadData } from "./domain";
import { read } from "./reader";

const J = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe("weights", () => {
  it("nominal lb/ft from the size, HSS and angles from their dimensions, joists from the joist list, the allowance on top", () => {
    expect(MD.lbPerFt("W24X76")).toEqual({ lb: 76, approx: false });
    expect(MD.lbPerFt("mc12x14.3")).toEqual({ lb: 14.3, approx: false });
    expect(MD.lbPerFt("WT5X22.5")).toEqual({ lb: 22.5, approx: false });
    // HSS8×8×1/4: 3.40 × 2 × 0.25 × (8 + 8 − 0.5) = 26.35 lb/ft (AISC lists 25.82: corners)
    expect(MD.lbPerFt("HSS8X8X1/4")).toEqual({ lb: 26.35, approx: true });
    // L4×4×1/4: 3.40 × 0.25 × (4 + 4 − 0.25) = 6.5875 → 6.59 (AISC 6.6)
    expect(MD.lbPerFt("L4X4X1/4")).toEqual({ lb: 6.59, approx: true });
    expect(MD.lbPerFt("PIPE6STD")).toBe(null);
    expect(MD.lbPerFt("26K9")).toBe(null);
    expect(MD.lbPerFt("HSS2X2X2")).toBe(null); // a wall thicker than the tube
    const cfg = { allow: 5, base: null, jw: [{ mark: "T12", lb: 1950 }] };
    expect(MD.weight({ k: "beam", size: "W24X76", len: 41.29 }, cfg)).toEqual({ lb: 3295, approx: false, src: "shape" }); // 76 × 41.29 × 1.05
    expect(MD.weight({ k: "joist", mark: "T12", size: "T12", len: 44 }, cfg)).toEqual({ lb: 2048, approx: false, src: "list" }); // 1,950 × 1.05
    expect(MD.weight({ k: "joist", mark: "T13", len: 44 }, cfg)).toBe(null);
    expect(MD.weight({ k: "beam", size: "W24X76", len: 0 }, cfg)).toBe(null);
    expect(MD.feet(30)).toBe("30'-0\"");
    expect(MD.feet(41.2917)).toBe("41'-3 1/2\"");
    expect(MD.feet(0)).toBe("—");
  });
});

describe("pieces", () => {
  it("only reads of each sheet's current revision count, rejected pieces never; totals by size and by sheet", () => {
    const sheets = [
      sheetOf(1, "E1004", [
        { n: 1, state: "superseded", pdf: true },
        { n: 2, state: "issued", pdf: true },
      ]),
      sheetOf(2, "E1005", [{ n: 0, state: "issued", pdf: true }]),
      sheetOf(3, "E1006", [{ n: 0, state: "issued", img: true }]),
      sheetOf(4, "E1007", [{ n: 0, state: "draft" }]),
    ];
    const recs = [rec(1, 1, [pc("p1", "B1100", "W12X14", 10)]), rec(1, 2, [pc("p1", "B1220", "W18X40", 35, "ok"), pc("p2", "B1221", "W18X40", 20), pc("p3", "B1222", "W18X40", 20, "no")])];
    const { reads, unread } = MD.reads(sheets, recs);
    expect(reads.map(o => o.r.rev)).toEqual([2]); // Rev 1's read is out of date
    expect(unread.map(u => [u.x.sheet, u.pdf])).toEqual([
      ["E1005", true],
      ["E1006", false],
    ]); // E1005 not read; E1006 has only a preview; E1007 has no drawing at all
    const rows = MD.rows(sheets, recs, MD.noSettings());
    expect(rows.map(r => r.mark)).toEqual(["B1220", "B1221"]); // the rejected piece is not a piece
    expect(rows[0].lb).toBe(1400); // 40 lb/ft × 35 ft
    const t = MD.totals(rows);
    expect([t.n, t.lb, t.review]).toEqual([2, 2200, 1]);
    expect(t.sizes.map(z => [z.size, z.n, z.lb])).toEqual([["W18X40", 2, 2200]]);
    expect(t.sheets.map(s => [s.sheet, s.n, s.lb, s.review])).toEqual([["E1004", 2, 2200, 1]]);
    expect(MD.pieceHint(sheets, recs, "B1220, b1299 B1221")).toBe("Not on the drawings read for this project: B1299. Check the mark.");
    expect(MD.pieceHint(sheets, recs, "B1220")).toBe("All on the drawings read for this project.");
    expect(MD.pieceHint(sheets, [], "B1")).toBe("");
    // an older read only: the sheet is unread, with the revision that was read
    expect(MD.reads(sheets, [recs[0]]).unread[0]).toMatchObject({ old: 1, pdf: true });
  });

  it("the CSV: one row a piece, ends joined, review in words", () => {
    const sheets = [sheetOf(1, "E1004", [{ n: 2, state: "issued", pdf: true }], "12")];
    const rows = MD.rows(sheets, [rec(1, 2, [{ ...pc("p1", "B1220", "W18X40", 35, "ok"), ends: [["A_01"], ["A_02", "beam B1"]] }], { lvl: "Level 2" })], MD.noSettings());
    const csv = MD.csvRows(rows, s => (s === "12" ? "Seq 1 – Bldg A" : s));
    expect(csv[0][0]).toBe("Sheet");
    expect(csv[1]).toEqual(["E1004", 2, 1, "Seq 1 – Bldg A", "Level 2", "B1220", "W18X40", "beam", 35, "35'-0\"", 1400, "", "Accepted", "A_01 | A_02 beam B1"]);
  });
});

describe("records", () => {
  it("the reader's output becomes a read of known shape; hostile fields are cut and capped", () => {
    const out = read({ w: W, h: H, ...sheet() }, 1);
    const d = MD.clean(MD.fromRead(out, { w: W, h: H }));
    expect(d.pcs.length).toBe(5);
    expect(d.pcs.every(p => p.st === "auto")).toBe(true); // every piece starts needing review
    expect([d.ppf, d.sl, d.grids.length]).toEqual([9, "from 3 dimensions", 4]);
    expect(J(MD.clean(J(d)))).toEqual(J(d)); // cleaning a clean read changes nothing
    const bad = MD.clean({
      pcs: [...Array(900)]
        .map((_, i) => ({ id: "p" + i, a: [0, 0, 1, 1], st: "sure", k: "girder", size: "W".repeat(99), len: 5000 }))
        .concat([{ id: "bad", a: [1, 2] } as never, null as never, "x" as never, { id: "p1", a: [0, 0, 2, 2] } as never]),
      tos: "abc",
      lvlBy: "magic",
      grids: [{ n: "", a: [0, 0, 1, 1] }, { n: "A".repeat(20), a: [0, 0, 1, 1] }],
    });
    expect(bad.pcs.length).toBe(700); // at most 700 pieces a page
    expect(bad.pcs.every(p => p.st === "auto" && p.k === "beam" && p.size.length === 30 && p.len === 1000)).toBe(true);
    expect([bad.tos, bad.lvlBy]).toEqual([null, ""]);
    expect(bad.grids.map(g => g.n)).toEqual(["A".repeat(12)]);
    expect(MD.cleanSettings({ allow: 99, jw: [{ mark: "t12", lb: "1950" }, { mark: "", lb: 5 }, { mark: "T12", lb: 1 }] })).toEqual({ allow: 50, base: null, jw: [{ mark: "T12", lb: 1950 }] });
  });

  it("joist list: one mark and weight a line, commas and units allowed, the rest reported", () => {
    const r = MD.parseJw("T12 1950\nT13, 2,100 lb\nJ145:640#\n\nbad line\nT12 2000");
    expect(r.jw).toEqual([
      { mark: "T12", lb: 1950 },
      { mark: "T13", lb: 2100 },
      { mark: "J145", lb: 640 },
    ]); // the first T12 wins
    expect(r.bad).toEqual(["bad line"]);
  });
});

describe("the sheet's lines", () => {
  it("snapping: a line end first, else the nearest point on a line, a line toward the other end winning a tie; text strokes ignored", () => {
    const L = MD.lineIndex([
      [100, 100, 400, 100, 1, 0, ""],
      [250, 0, 250, 300, 0.3, 1, ""],
      [395, 95, 399, 99, 0.2, 0, ""],
      [402, 102, 406, 106, 0.2, 0, ""],
    ]);
    expect(L.length).toBe(8); // only the two long lines are kept
    expect(MD.snap(L, [396, 104], 10)).toEqual([400, 100, "end"]);
    expect(MD.snap(L, [180, 106], 10)).toEqual([180, 100, "on"]);
    expect(MD.snap(L, [180, 120], 10)).toEqual([180, 120, ""]);
    // near the crossing, 4 off the grid line and 4.5 off the beam: drawing along the beam keeps to the beam
    expect(MD.snap(L, [254, 104.5], 10).slice(0, 2)).toEqual([250, 104.5]);
    expect(MD.snap(L, [254, 104.5], 10, [120, 100]).slice(0, 2)).toEqual([254, 100]);
    const pcs = [
      { id: "a", a: [0, 0, 100, 0] },
      { id: "b", a: [0, 6, 100, 6] },
    ];
    expect(MD.pieceAt(pcs, [50, 4], 8)!.id).toBe("b");
    expect(MD.pieceAt(pcs, [50, 20], 8)).toBe(null);
    expect(MD.pieceAt(pcs, [-5, 0], 8)!.id).toBe("a"); // past the end, within reach
  });

  it("scale names: standard architectural scales by name, anything else as inches to feet", () => {
    expect(MD.scaleName(9)).toBe("1/8\" = 1'-0\"");
    expect(MD.scaleName(18)).toBe("1/4\" = 1'-0\"");
    expect(MD.scaleName(13.5)).toBe("3/16\" = 1'-0\"");
    expect(MD.scaleName(10.29)).toBe("1\" = 7'");
    expect(MD.scaleName(0)).toBe("");
  });
});

describe("suggestions", () => {
  it("marks by what is typed last, every mark on a sheet or at a grid line, never one already there", () => {
    const sheets = [sheetOf(1, "E1004", [{ n: 2, state: "issued", pdf: true }]), sheetOf(2, "J6.1", [{ n: 0, state: "issued", pdf: true }])];
    const recs = [
      rec(1, 2, [
        { ...pc("p1", "B1220", "W18X40", 35), ends: [["C", "4"], ["C", "5"]] },
        { ...pc("p2", "B1221", "W18X40", 20), ends: [["D", "4"], []] },
        pc("p3", "B1222", "W18X40", 20, "no"),
      ]),
      rec(2, 0, [pc("j1", "T12", "26K9", 30, "auto", "joist"), pc("j2", "", "22K", 30, "auto", "joist")]),
    ];
    const S = (t: string) => MD.suggest(sheets, recs, t);
    expect(S("b12").map(o => o.l)).toEqual(["B1220 · W18X40 · E1004 · C/4–C/5", "B1221 · W18X40 · E1004 · D/4"]);
    expect(S("B1220, b12").map(o => o.add)).toEqual([["B1221"]]);
    expect(S("e1004")[0]).toEqual({ l: "All 2 marks on E1004", add: ["B1220", "B1221"] });
    expect(S("j6.1")[0]).toEqual({ l: "All 2 marks on J6.1", add: ["22K", "T12"] });
    expect(S("4")[0]).toEqual({ l: "All 2 marks at grid 4", add: ["B1220", "B1221"] });
    expect(S("B1220, ")).toEqual([]);
    expect(S("B1220")).toEqual([]);
  });
});

// ---------- review (SteelBuild test/model-ui-v55.test.js: review, forms and viewer edits, as pure changes) ----------
const who = { by: 7, at: "2026-11-05T10:00:00Z" };
function page(): ReadData {
  const p = (id: string, mark: string, size: string, a: [number, number, number, number], len: number, extra?: Partial<Piece>): Piece => ({
    id,
    k: "beam",
    mark,
    size,
    a,
    len,
    ends: [["A_01"], ["A_02"]],
    via: "",
    st: "auto",
    ...extra,
  });
  return {
    ...MD.clean({ w: 2592, h: 1728, ppf: 10.29, sl: "from 12 dimensions" }),
    pcs: [p("p1", "B1220", "W18X40", [500, 400, 860, 400], 35), p("p2", "B1221", "W24X55", [500, 600, 760, 600], 25.27), p("p3", "", "HSS8X8X1/4", [900, 400, 900, 700], 29.15, { via: "leader" })],
    left: [
      { label: "W12X14", k: "beam", mark: "B1241", x: 1200, y: 900, note: "" },
      { label: "26K", k: "joist", mark: "", x: 0, y: 0, note: "joist by others (dashed)" },
    ],
  };
}

describe("review", () => {
  it("accept one, reject one, accept the rest; the rejected one stays rejected; nothing to do is null", () => {
    let d = page();
    const a = REVIEW.setState(d, ["p1"], "ok", who)!;
    expect(a.summary).toBe("Accepted: B1220 W18X40");
    d = a.data;
    expect(d.pcs[0]).toMatchObject({ st: "ok", by: 7, at: who.at });
    d = REVIEW.setState(d, ["p2"], "no", who)!.data;
    const all = REVIEW.setState(d, d.pcs.filter(p => p.st === "auto").map(p => p.id), "ok", who)!;
    expect(all.summary).toBe("Accepted: HSS8X8X1/4");
    expect(all.data.pcs.map(p => p.st)).toEqual(["ok", "no", "ok"]);
    expect(REVIEW.setState(all.data, ["p1", "p3"], "ok", who)).toBe(null); // already accepted
    expect(REVIEW.setState(all.data, ["p1", "p3"], "auto", who)!.summary).toBe("Back to needs review: 2 pieces");
  });

  it("weights with the allowance; a piece fixed; its history line", () => {
    const sheets = [sheetOf(1, "E1004", [{ n: 9, state: "issued", pdf: true }])];
    const r = { ...rec(1, 9, []), ...page() };
    const rows = MD.rows(sheets, [r], { allow: 5, base: null, jw: [{ mark: "T12", lb: 1950 }] });
    expect(rows.find(x => x.pid === "p1")!.lb).toBe(1470); // 1,400 × 1.05
    // W18X40 × 35 = 1,400; W24X55 × 25.27 = 1,389.85 → 1,390; HSS8X8X1/4 ≈ 26.35 × 29.15 = 768.1 → 768: 3,558 lb
    const t = MD.totals(MD.rows(sheets, [r], MD.noSettings()));
    expect(Math.round(t.tons * 10) / 10).toBe(1.8);
    expect(MD.rows(sheets, [r], MD.noSettings()).map(x => x.lb)).toEqual([1400, 1390, 768]);
    const f = REVIEW.fix(r, "p2", { k: "beam", size: "w21x44", mark: "b1221" }, who)!;
    expect(f.data.pcs[1]).toMatchObject({ mark: "B1221", size: "W21X44", st: "edit" });
    expect(f.summary).toBe("Fixed: B1221 W24X55 → B1221 W21X44");
    expect(cleanFields({ k: "girder", mark: " t12 ", size: "26 K 9" })).toEqual({ k: "beam", mark: "T12", size: "26K9", note: "" });
  });

  it("an end moved onto the drawing's line: new length, fixed; a missed piece drawn on a page nobody read; a label placed", () => {
    const d = page();
    const m = REVIEW.moveEnd(d, "p1", [500, 400, 900, 400], who)!;
    expect([m.data.pcs[0].a, m.data.pcs[0].st, m.data.pcs[0].len]).toEqual([[500, 400, 900, 400], "edit", 38.87]); // 400 units at 10.29 a foot
    expect(m.summary).toMatch(/^Moved an end: B1220 W18X40, 35'-0" → 38'-10/);
    // a page nobody read: a read of its own, started by hand, with the viewer's scale
    const h = REVIEW.add(null, { a: [0, 0, 90, 0], w: 2592, h: 1728, ppf: 9 }, { k: "beam", mark: "", size: "W12X26" }, "h1", who);
    if ("error" in h) throw new Error(h.error);
    expect([h.data.pcs.length, h.piece.st, h.piece.via, h.piece.len, h.data.sl]).toEqual([1, "add", "hand", 10, "the viewer’s scale"]); // 90 units at 9 a foot
    expect(h.summary).toBe("Started by hand (not read): W12X26");
    // Place on a label not placed: the piece drawn on its line, the label leaves the list
    const pl = REVIEW.add(d, { a: [1100, 900, 1300, 900], w: 2592, h: 1728, ppf: 0, place: d.left[0] }, { k: "beam", mark: "B1241", size: "W12X14" }, "h2", who);
    if ("error" in pl) throw new Error(pl.error);
    expect([pl.piece.size, pl.piece.via, pl.piece.st, pl.piece.len]).toEqual(["W12X14", "hand", "add", 19.44]);
    expect(pl.data.left.map(u => u.label)).toEqual(["26K"]);
    expect(pl.summary).toMatch(/^Placed by hand \(a label the reader couldn’t place\): B1241 W12X14/);
    // an added piece moved stays added
    expect(REVIEW.moveEnd(pl.data, "h2", [1100, 900, 1310, 900], who)!.data.pcs.find(p => p.id === "h2")!.st).toBe("add");
    const full = { ...d, pcs: [...Array(700)].map((_, i) => ({ ...d.pcs[0], id: "x" + i })) };
    expect(REVIEW.add(full, { a: [0, 0, 1, 1], w: 1, h: 1, ppf: 0 }, { k: "beam", mark: "", size: "W8X10" }, "h3", who)).toMatchObject({ error: expect.stringMatching(/700 pieces/) });
  });

  it("a level set by hand", () => {
    const l = REVIEW.setLevel(page(), " Level 3 ", 27);
    expect([l.data.lvl, l.data.lvlBy, l.data.tos, l.data.tosBy]).toEqual(["Level 3", "hand", 27, "hand"]);
    expect(l.summary).toBe("Level set: Level 3, top of steel 27'-0\"");
    expect(REVIEW.setLevel(page(), "", null).summary).toBe("Level set: none, top of steel not known");
  });
});
