// Levels, placing the sheets on one plan, the model, the mesh and picking, progress (ported from SteelBuild
// test/model-v55.test.js, phase 2). Colours are by review state here: This app has no piece-mark daily-log stages.
import { describe, expect, it } from "vitest";
import { MD } from "./domain";
import { project, SID } from "./fixtures";
import { MS, type Palette } from "./space";

const J = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe("levels", () => {
  it("elevations as drawings write them, the typical top-of-steel note, the level from the title, hand values kept", () => {
    expect([MS.ft("13'-6\""), MS.ft("(+) 13'-6"), MS.ft("-2'-0\""), MS.ft("10'-9 1/2\""), MS.ft("13.5"), MS.ft("abc"), MS.ft("")]).toEqual([13.5, 13.5, -2, 10.7917, 13.5, null, null]);
    const T = (s: string) => ({ s });
    expect(MS.tosOf([T("2.) T.O.STEEL EL. INDICATES TOP OF STEEL ELEVATIONS."), T("T.O.STEEL EL.+ 10'-9"), T("T.O.STEEL EL.13'-6\" (U.N.O.)")])).toBe(13.5);
    expect(MS.tosOf([T("TOS EL. 28'-9"), T("TOS EL. 29'-0"), T("TOS EL. 28'-9")])).toBe(28.75);
    expect(MS.tosOf([T("B.O.DECK EL. 12'-6\"")])).toBe(null);
    expect(["PARTIAL LEVEL-2 FRAMING PLAN @ BLDG.A SOUTH", "BLDG D ROOF FRAMING PLAN", "3RD FLOOR FRAMING", "ANCHOR BOLT PLAN", "SECTIONS"].map(MS.levelOf)).toEqual([
      "Level 2",
      "Roof",
      "Level 3",
      "Foundation",
      "",
    ]);
    expect(MS.levelFields([T("T.O.S. EL. 14'-0\"")], "LEVEL 2 FRAMING", { lvl: "Mezz", lvlBy: "hand", tos: 15, tosBy: "read" })).toEqual({ lvl: "Mezz", lvlBy: "hand", tos: 14, tosBy: "read" });
    expect(MS.levelFields([], "ROOF FRAMING", null)).toEqual({ lvl: "Roof", lvlBy: "read", tos: null, tosBy: "" });
    expect([MS.elev(0), MS.elev(-2.5), MS.elev(null)]).toEqual(["0'-0\"", "-2'-6\"", ""]);
  });
});

describe("placing", () => {
  it("sheets join where two shared grid crossings agree; one sharing none is placed apart; one without a scale is not placed", () => {
    const { sheets, recs } = project(),
      { reads } = MD.reads(sheets, recs),
      pl = MS.place(reads),
      at = (sid: number) => pl.at.get(MD.idOf(sid, 0, 1))!;
    expect(J([...MS.crossings(recs[0]).entries()].slice(0, 2))).toEqual([
      ["1|A", [10, -10]],
      ["1|B", [10, -20]],
    ]); // grid crossings in plan feet, north up
    expect(pl.groups).toBe(2);
    expect([at(SID.E1).g, at(SID.L1).g, at(SID.E2).g, at(SID.X1).g]).toEqual([0, 0, 0, 1]);
    expect([at(SID.E2).dx, at(SID.E2).dy]).toEqual([25, 2]); // E2 shifted so its 2/A and 2/B land on E1's
    expect(J(pl.unplaced)).toEqual([{ rid: MD.idOf(SID.N1, 0, 1), sheet: "N1", why: "no scale" }]);
  });
});

describe("model", () => {
  it("pieces at their top of steel, columns from the level below, rejected pieces left out, colours by review, groups apart", () => {
    const { sheets, recs } = project(),
      cfg = MD.noSettings(),
      m = MS.build(sheets, recs, cfg),
      P = (mk: string) => m.pieces.find(q => q.mark === mk)!;
    expect(m.pieces.map(q => q.mark).sort()).toEqual(["B1", "B2", "G1", "T12"]); // B3 was rejected; N1 is not placed
    expect(J([P("B1").p0, P("B1").p1, P("B1").z])).toEqual([[10, -10], [30, -10], 13.5]);
    expect(J([P("B2").p0, P("B2").p1])).toEqual([
      [30, -10],
      [50, -10],
    ]); // E2's beam continues E1's along grid A
    expect([P("B1").tone, P("B2").tone, P("G1").tone, P("T12").tone]).toEqual(["ok", "ok", "auto", "add"]);
    expect(P("T12").p0[0]).toBeGreaterThan(50 + 29); // the roof sheet that shares no grid lines sits 30 ft east of the rest
    expect(P("T12").noElev).toBe(true);
    expect(m.cols.length).toBe(1);
    expect(J([m.cols[0].xy, m.cols[0].z0, m.cols[0].z1, m.cols[0].tone])).toEqual([[10, -10], 0, 13.5, "col"]); // at grid 1/A, from Level 1 up to Level 2
    expect(J(m.levels.map(l => [l.name, l.tos]))).toEqual([
      ["Roof", null],
      ["Level 1", 0],
      ["Level 2", 13.5],
    ]);
    expect(J(m.noElev)).toEqual(["X1"]);
    expect(J(m.unplaced.map(u => u.sheet))).toEqual(["N1"]);
    expect(m.seqs).toEqual(["1", "2"]);
    expect(MS.build(sheets, recs, cfg, { lvl: "Level 2" }).pieces.map(q => q.mark).sort()).toEqual(["B1", "B2"]);
    expect(MS.build(sheets, recs, cfg, { done: true }).pieces.map(q => q.mark).sort()).toEqual(["B1", "B2", "T12"]); // G1 still needs review
    expect(MS.build(sheets, recs, cfg, { seq: "2" }).pieces.map(q => q.mark)).toEqual(["B2"]);
    // with a base elevation set, a column with no level below starts there
    const recs2 = recs.filter(r => r.sid !== SID.L1),
      c2 = MS.build(sheets, recs2, { ...cfg, base: -4 }).cols[0];
    expect([c2.z0, c2.stub]).toEqual([-4, false]);
    const c3 = MS.build(sheets, recs2, cfg).cols[0];
    expect([c3.z0, c3.stub]).toEqual([1.5, true]); // 12 ft below its level, flagged
  });

  it("sections from the size, the triangles drawn, a tap finds the piece", () => {
    expect(J(MS.shape({ k: "beam", size: "W24X55" }))).toEqual({ t: "I", d: 24, b: Math.sqrt(55), tf: 55 / (Math.sqrt(55) * 9), tw: 55 / (24 * 9) });
    expect([MS.shape({ k: "beam", size: "HSS8X6X1/4" }).t, MS.shape({ k: "joist", size: "26K9" }).d, MS.shape({ k: "joist", size: "" }).d, MS.shape({ k: "beam", size: "??" }).unknown]).toEqual([
      "box",
      26,
      24,
      true,
    ]);
    expect(MS.shape({ k: "beam", size: "W14X90" }).b).toBeGreaterThan(12); // heavy shallow shapes are wide
    const PAL: Palette = { auto: [0.9, 0.7, 0.2], ok: [0.3, 0.7, 0.4], add: [0.3, 0.5, 0.9], col: [0.4, 0.4, 0.4], sel: [0.9, 0.4, 0.1] };
    const { sheets, recs } = project(),
      m = MS.build(sheets, recs, MD.noSettings(), { lvl: "Level 2" }),
      M = MS.mesh(m, null, PAL);
    expect(M.pos.length).toBe((2 * 3 + 1) * 36 * 3); // two I-beams of three boxes and a column, 36 corners a box
    expect(M.boxes.length).toBe(3);
    expect(M.lpos.length).toBe(0); // no joists, no web lines
    // straight down onto B1's middle (20, -10), and onto nothing
    expect(MS.pick(M.boxes, [20, -10, 100], [0, 0, -1])).toBe(m.pieces.find(q => q.mark === "B1")!.key);
    expect(MS.pick(M.boxes, [20, -50, 100], [0, 0, -1])).toBe(null);
    // a sloping ray from the south-west meets the column at 1/A first
    const o = [0, -20, 20],
      t = [10, -10, 10],
      d0 = [t[0] - o[0], t[1] - o[1], t[2] - o[2]],
      l = Math.hypot(d0[0], d0[1], d0[2]);
    expect(MS.pick(M.boxes, o, d0.map(v => v / l))).toBe(m.cols[0].key);
    const sel = MS.mesh(m, m.pieces[0].key, PAL);
    expect([...sel.col.slice(0, 3)].map(v => Math.round(v * 100) / 100)).toEqual([0.9, 0.4, 0.1]); // the selection in its colour
    expect([...M.col.slice(0, 3)].map(v => Math.round(v * 100) / 100)).toEqual([0.3, 0.7, 0.4]); // B1 accepted
    const joists = MS.mesh(MS.build(sheets, recs, MD.noSettings(), { lvl: "Roof" }), null, PAL);
    expect(joists.lpos.length).toBeGreaterThan(0); // a joist's web drawn as lines
  });
});

describe("progress", () => {
  it("pieces and tons, accepted and still to review, by level and by sequence", () => {
    const { sheets, recs } = project(),
      rows = MD.rows(sheets, recs, MD.noSettings()),
      lv = new Map(recs.map(r => [r.key, r.lvl])),
      sq = new Map(sheets.map(x => [x.id, x.seq]));
    const P = MS.progress(
        rows,
        rid => lv.get(rid),
        sid => sq.get(sid),
        q => "Seq " + q
      ),
      L2 = P.byLevel.find(r => r.label === "Level 2")!;
    // B1 W18X40 × 20 ft = 800 lb accepted; B2 W12X26 × 20 ft = 520 lb fixed
    expect(J([L2.n, L2.lb, L2.accepted, L2.review, L2.added])).toEqual([2, 1320, [2, 1320], 0, 0]);
    expect(P.byLevel.map(r => r.label)).toEqual(["Level 1", "Level 2", "Roof", "No level set"]); // N1 has no level
    expect(P.byLevel.find(r => r.label === "Level 1")!.review).toBe(1);
    expect(P.byLevel.find(r => r.label === "Roof")!.added).toBe(1);
    expect(P.bySeq.map(r => [r.label, r.n])).toEqual([
      ["Seq 1", 4],
      ["Seq 2", 1],
    ]);
  });
});
