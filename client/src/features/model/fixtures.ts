/**
 * Synthetic drawings and projects for the model tests (ported from SteelBuild test/model-v55.test.js). Synthetic only —
 * the real sheets the reader was measured on never go in the repository.
 */
import type { PageText, Seg } from "../drawings/pdf";
import { MD, type Piece, type PieceState, type ReadData, type ReadRec, type SheetLite } from "./domain";

// ---------- a synthetic sheet, in page units (pdf.js viewport at scale 1: y down) ----------
// 42" × 30" at 1/8" = 1'-0": 9 page units per foot.
export const W = 3024,
  H = 2160,
  FT = 9;
export const CENTER = "8.5,2.8,2.8,2.8",
  HIDDEN = "6,6";
export const seg = (x0: number, y0: number, x1: number, y1: number, lw = 0.57, dash = 0, pat = ""): Seg => [x0, y0, x1, y1, lw, dash, pat];
export const txt = (s: string, x: number, y: number, h = 10, rot = 0, w?: number): PageText => ({ s, x, y, h, rot, w: w != null ? w : s.length * h * 0.6 });
const rad = (d: number) => (d * Math.PI) / 180;
/** a point in a label's own frame (u along the text, v below the baseline) → page */
export const fromFrame = (t: PageText, u: number, v: number): [number, number] => {
  const c = Math.cos(rad(t.rot)),
    s = Math.sin(rad(t.rot));
  return [t.x + u * c - v * s, t.y + u * s + v * c];
};
/** Three dimension strings (the scale), grids A_01 A_02 / A_A A_B, two beams along A_A and A_B, three T12 joists between. */
export function sheet() {
  const text: PageText[] = [],
    segs: Seg[] = [];
  // three dimension strings, each over its dimension line: they set the scale
  [
    [300, 2050, 30],
    [700, 2050, 20],
    [1100, 2050, 25],
  ].forEach(([x, y, ft]) => {
    const t = txt(ft + "'-0", x, y, 9);
    text.push(t);
    const cx = x + t.w / 2;
    segs.push(seg(cx - (ft * FT) / 2, y + 2, cx + (ft * FT) / 2, y + 2, 0.4));
  });
  // grid lines: long center lines with their bubble names past one end
  (
    [
      [500, "A_01"],
      [770, "A_02"],
    ] as [number, string][]
  ).forEach(([x, n]) => {
    segs.push(seg(x, 300, x, 1700, 0.28, 1, CENTER));
    const t = txt(n, 0, 282, 11);
    t.x = x - t.w / 2;
    text.push(t);
  });
  (
    [
      [400, "A_A"],
      [760, "A_B"],
    ] as [number, string][]
  ).forEach(([y, n]) => {
    segs.push(seg(400, y, 2000, y, 0.28, 1, CENTER));
    const t = txt(n, 0, y + 3.85, 11);
    t.x = 375 - t.w;
    text.push(t);
  });
  // two beams along the grid lines A_A and A_B, labelled just above
  segs.push(seg(500, 400, 770, 400, 1.7), seg(500, 760, 770, 760, 1.7));
  text.push(txt("W24X55", 600, 397, 9), txt("W21X44", 600, 757, 9));
  // three joists between them, drawn a little past the beams (an extension line), labelled T12 reading upward
  [560, 620, 680].forEach(x => {
    segs.push(seg(x, 390, x, 770, 0.57));
    text.push(txt("T12", x - 3, 620, 10, -90));
  });
  return { text, segs };
}

// ---------- reads and sheets ----------
export const blank = (extra?: Partial<ReadData>): ReadData => ({ ...MD.clean({ w: 2592, h: 1728, ppf: 10.29 }), ...extra });
export const rec = (sid: number, rev: number, pcs: Piece[], extra?: Partial<ReadData> & { pg?: number; version?: number }): ReadRec => {
  const { pg = 1, version = 1, ...data } = extra || {};
  return { ...blank(data), pcs, key: MD.idOf(sid, rev, pg), id: sid * 100 + rev, sid, rev, pg, v: 4, version, by: 7, at: "2026-11-03T12:00:00Z" };
};
export const pc = (id: string, mark: string, size: string, len: number, st?: PieceState, k?: "beam" | "joist"): Piece => ({
  id,
  k: k || "beam",
  mark,
  size,
  a: [0, 0, len * 10.29, 0],
  len,
  ends: [[], []],
  via: "",
  st: st || "auto",
});
export const sheetOf = (id: number, no: string, revs: { n: number; state: string; pdf?: boolean; img?: boolean }[], seq = "", title = ""): SheetLite => ({
  id,
  sheet: no,
  title,
  seq,
  revs: revs.map(r => ({ n: r.n, state: r.state, pdf: r.pdf ? "/f/" + id + "-" + r.n + ".pdf" : null, img: r.img ? "/f/" + id + "-" + r.n + ".jpg" : null })),
});

// four reads of one project (10 page units a foot): E1 and E2 share grid lines 2/A and 2/B; L1 is E1's level below;
// X1 shares nothing; N1 has no scale
const G = (n: string, x0: number, y0: number, x1: number, y1: number) => ({ n, a: [x0, y0, x1, y1] as [number, number, number, number] });
const gridsAt = (xs: [string, number][], ys: [string, number][]) => [...xs.map(([n, x]) => G(n, x, 0, x, 400)), ...ys.map(([n, y]) => G(n, 0, y, 600, y))];
export const SID = { E1: 1, E2: 2, L1: 3, X1: 4, N1: 5 } as const;
export function project() {
  const beam = (id: string, mark: string, size: string, a: [number, number, number, number], st?: PieceState): Piece => ({
    id,
    k: "beam",
    mark,
    size,
    a,
    len: Math.hypot(a[2] - a[0], a[3] - a[1]) / 10,
    ends: [[], []],
    via: "",
    st: st || "ok",
  });
  const rr = (sid: number, extra: Partial<ReadData>, pcs: Piece[]) => rec(sid, 0, pcs, { ppf: 10, w: 600, h: 400, ...extra });
  const sheets = (["E1", "E2", "L1", "X1", "N1"] as const).map(no => sheetOf(SID[no], no, [{ n: 0, state: "issued", pdf: true }], no === "E2" ? "2" : "1"));
  const recs = [
    rr(SID.E1, { lvl: "Level 2", tos: 13.5, grids: gridsAt([["1", 100], ["2", 300]], [["A", 100], ["B", 200]]), cols: [{ mark: "C1", size: "HSS8X8X1/2", x: 103, y: 97 }] }, [
      beam("p1", "B1", "W18X40", [100, 100, 300, 100]),
    ]),
    rr(SID.E2, { lvl: "Level 2", tos: 13.5, grids: gridsAt([["2", 50], ["3", 250]], [["A", 120], ["B", 220]]) }, [
      beam("p1", "B2", "W12X26", [50, 120, 250, 120], "edit"),
      beam("p2", "B3", "W12X26", [50, 220, 250, 220], "no"),
    ]),
    rr(SID.L1, { lvl: "Level 1", tos: 0, grids: gridsAt([["1", 100], ["2", 300]], [["A", 100], ["B", 200]]) }, [beam("p1", "G1", "W24X55", [100, 200, 300, 200], "auto")]),
    rr(SID.X1, { lvl: "Roof", grids: gridsAt([["9", 100]], [["Z", 100]]) }, [
      { id: "j1", k: "joist", mark: "T12", size: "26K9", a: [100, 100, 100, 300], len: 20, ends: [[], []], via: "hand", st: "add" },
    ]),
    rr(SID.N1, { ppf: 0 }, [beam("p1", "B9", "W8X10", [0, 0, 50, 0])]),
  ];
  return { sheets, recs };
}
