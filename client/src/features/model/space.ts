/**
 * Model, phase 2 (SteelBuild docs/model/01-plan.md): each read's level and top-of-steel elevation, the sheets placed on
 * one plan by their shared grid lines, the pieces and columns in 3D (feet: x east, y north, z up), their colours, and
 * progress by level and sequence. Pure — no page code; the 3D view is View3D.tsx. Ported from SteelBuild
 * src/modules/model/space.js (MS).
 *
 * This app has no piece-mark daily-log stages, so pieces are coloured by their review state (needs review, accepted or
 * fixed, added by hand) instead of the furthest logged erection stage, and progress counts review, not erection.
 */
import { MD, elevText, type Kind, type Line4, type PieceState, type ReadRec, type Row, type Settings, type SheetLite } from "./domain";

/** Feet from an elevation as drawings write it: 13'-6", (+) 13'-6, -2'-0", 13'-6 1/2", or plain decimal feet (13.5). */
const FT = (s: unknown): number | null => {
  const t = String(s == null ? "" : s).trim();
  if (!t) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(t)) return +t;
  const m = /(\(\s*[+-]\s*\)|[+-])?\s*(\d{1,4})\s*'\s*-?\s*(?:(\d{1,2})(?:\s+(\d{1,2})\s*\/\s*(\d{1,2}))?)?/.exec(t);
  if (!m) return null;
  const v = +m[2] + ((m[3] ? +m[3] : 0) + (m[4] && +m[5] ? +m[4] / +m[5] : 0)) / 12;
  return Math.round((m[1] && m[1].includes("-") ? -v : v) * 10000) / 10000;
};
// A top-of-steel note: T.O.STEEL EL. 13'-6" (U.N.O.), T.O.S. EL.= (+) 13'-6, TOS EL. 28'-9. The note that defines the
// abbreviation ("T.O.STEEL INDICATES TOP OF STEEL") has no number and is not one.
const TOS = /\bT\.?\s*O\.?\s*(?:STEEL|STL|S)\b\.?\s*(?:EL(?:EV)?\.?)?\s*[=:]?\s*((?:\(\s*[+-]\s*\)|[+-])?\s*\d{1,4}\s*'\s*-?\s*(?:\d{1,2}(?:\s+\d{1,2}\s*\/\s*\d{1,2})?)?)/i;
const UNO = /\bU\.?\s*N\.?\s*O\b|\bTYP/i;

/** What a piece is coloured by: its review state; columns (no review of their own) have their own colour. */
export type Tone = "auto" | "ok" | "add" | "col";
/** [tone, label, CSS token, fallback hex] */
export const TONES: [Tone, string, string, string][] = [
  ["auto", "Needs review", "--tp-amber", "#e0a100"],
  ["ok", "Accepted / fixed", "--tp-green", "#2f9e44"],
  ["add", "Added by hand", "--tp-blue", "#1c7ed6"],
  ["col", "Column (from its mark)", "--tp-ink-2", "#555c64"],
];
export const SEL_COLOR = ["--tp-orange", "#e8590c"] as const;

export type Shape = { t: "I" | "box" | "joist"; d: number; b: number; tf?: number; tw?: number; unknown?: boolean };
export type MPiece = {
  key: string;
  rid: string;
  pid: string;
  sid: number;
  sheet: string;
  rev: number;
  pg: number;
  a: Line4;
  g: number;
  lvl: string;
  seq: string;
  k: Kind;
  mark: string;
  size: string;
  len: number;
  st: PieceState;
  lb: number | null;
  tone: Tone;
  p0: [number, number];
  p1: [number, number];
  z: number;
  noElev: boolean;
  shape: Shape;
};
export type MCol = {
  key: string;
  rid: string;
  sid: number;
  sheet: string;
  g: number;
  lvl: string;
  seq: string;
  mark: string;
  size: string;
  xy: [number, number];
  z0: number;
  z1: number;
  stub: boolean;
  tone: Tone;
  shape: Shape;
};
export type Model = {
  pieces: MPiece[];
  cols: MCol[];
  levels: { name: string; tos: number | null }[];
  seqs: string[];
  groups: number;
  unplaced: { rid: string; sheet: string; why: string }[];
  noElev: string[];
};
export type Mesh = {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  lpos: Float32Array;
  lcol: Float32Array;
  boxes: PickBox[];
  lo: number[];
  hi: number[];
};
type V3 = number[];
export type PickBox = { key: string; c: V3; u: V3; v: V3; w: V3; h: V3 };
export type Palette = Record<Tone | "sel", number[]>;
type ReadPair = { x: SheetLite; r: ReadRec };

export const MS = {
  ft: FT,
  elev: elevText,
  TONES,
  // ---------- level and elevation of a read ----------
  /** The sheet's top-of-steel elevation from its notes: the one marked U.N.O. or typical, else the most common. */
  tosOf: (text: { s?: string }[] | null | undefined): number | null => {
    const hits: { v: number; uno: boolean }[] = [];
    (text || []).forEach(t => {
      const m = TOS.exec(t.s || "");
      if (!m) return;
      const v = FT(m[1]);
      if (v != null && Math.abs(v) < 2000) hits.push({ v, uno: UNO.test(t.s || "") });
    });
    const pool = hits.some(h => h.uno) ? hits.filter(h => h.uno) : hits;
    if (!pool.length) return null;
    const n = new Map<number, number>();
    pool.forEach(h => n.set(h.v, (n.get(h.v) || 0) + 1));
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  },
  /** The level a sheet shows, from its title: LEVEL-2 or 2ND FLOOR → Level 2; ROOF; MEZZANINE; CANOPY; FOUNDATION. */
  levelOf: (title: string | null | undefined) => {
    const t = String(title || "").toUpperCase();
    let m: RegExpExecArray | null;
    if ((m = /\bLEVEL[\s.#-]*(\d{1,2}|[A-Z])\b/.exec(t))) return "Level " + m[1];
    if ((m = /\b(\d{1,2})(?:ST|ND|RD|TH)\s+(?:FLOOR|LEVEL)\b/.exec(t))) return "Level " + m[1];
    if (/\bROOF\b/.test(t)) return "Roof";
    if (/\bMEZZ(?:ANINE)?\b/.test(t)) return "Mezzanine";
    if (/\bCANOPY\b/.test(t)) return "Canopy";
    if (/\bFOUNDATION|ANCHOR BOLT|BASE PLATE\b/.test(t)) return "Foundation";
    return "";
  },
  /** What a new read starts with; old: the page's previous read, whose level and elevation set by hand are kept. */
  levelFields: (
    text: { s?: string }[] | null | undefined,
    title: string,
    old?: { lvl: string; lvlBy: string; tos: number | null; tosBy: string } | null
  ): { lvl: string; lvlBy: "" | "read" | "hand"; tos: number | null; tosBy: "" | "read" | "hand" } => {
    const tos = MS.tosOf(text),
      lvl = MS.levelOf(title);
    return {
      ...(old && old.lvlBy === "hand" ? { lvl: old.lvl, lvlBy: "hand" as const } : { lvl, lvlBy: lvl ? ("read" as const) : ("" as const) }),
      ...(old && old.tosBy === "hand" ? { tos: old.tos, tosBy: "hand" as const } : { tos, tosBy: tos != null ? ("read" as const) : ("" as const) }),
    };
  },

  // ---------- placing the sheets on one plan ----------
  /**
   * Where a read's grid lines cross, in plan feet (page y runs down, plan y up): 'A_19|A_G' → [x, y]. Lines closer than
   * 20° to parallel don't make a crossing; crossings far outside the sheet are ignored.
   */
  crossings: (r: { grids: { n: string; a: readonly number[] }[]; ppf: number; w?: number; h?: number }) => {
    const out = new Map<string, [number, number]>(),
      g = (r.grids || []).filter(q => q.n && q.a),
      ppf = r.ppf;
    if (!(ppf > 0)) return out;
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const [x1, y1, x2, y2] = g[i].a,
          [x3, y3, x4, y4] = g[j].a,
          dx1 = x2 - x1,
          dy1 = y2 - y1,
          dx2 = x4 - x3,
          dy2 = y4 - y3,
          den = dx1 * dy2 - dy1 * dx2;
        const l1 = Math.hypot(dx1, dy1),
          l2 = Math.hypot(dx2, dy2);
        if (!l1 || !l2 || Math.abs(den) / (l1 * l2) < Math.sin((20 * Math.PI) / 180)) continue;
        const t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / den,
          X = x1 + t * dx1,
          Y = y1 + t * dy1;
        if (r.w && r.h && (X < -r.w * 0.25 || X > r.w * 1.25 || Y < -r.h * 0.25 || Y > r.h * 1.25)) continue;
        const k = [String(g[i].n).trim().toUpperCase(), String(g[j].n).trim().toUpperCase()].sort().join("|");
        if (!out.has(k)) out.set(k, [X / ppf, -Y / ppf]);
      }
    return out;
  },
  /**
   * Each read's shift onto a common plan: reads are joined when two or more crossings they share agree within a foot
   * (the same orientation and their own scales assumed). Joined reads form a group; a project with separate buildings
   * has more than one. → { at: Map(read key → { dx, dy, g }), groups, unplaced: [{ rid, sheet, why }] }
   */
  place: (reads: ReadPair[]) => {
    const cr = new Map<string, Map<string, [number, number]>>(),
      at = new Map<string, { dx: number; dy: number; g: number }>(),
      unplaced: { rid: string; sheet: string; why: string }[] = [],
      ok: ReadPair[] = [];
    reads.forEach(({ x, r }) => {
      if (!(r.ppf > 0)) return void unplaced.push({ rid: r.key, sheet: x.sheet, why: "no scale" });
      const c = MS.crossings(r);
      if (c.size < 1) return void unplaced.push({ rid: r.key, sheet: x.sheet, why: "no grid lines read" });
      cr.set(r.key, c);
      ok.push({ x, r });
    });
    const shiftTo = (r: ReadRec) => {
      // the best agreeing shift from the reads already placed, or null
      const offs: [number, number, number, string][] = [],
        c = cr.get(r.key)!;
      at.forEach((p, rid) =>
        cr.get(rid)!.forEach((q, k) => {
          const m = c.get(k);
          if (m) offs.push([q[0] + p.dx - m[0], q[1] + p.dy - m[1], p.g, k]);
        })
      );
      let best: { n: number; g: number; dx: number; dy: number } | null = null;
      offs.forEach(o => {
        const near = offs.filter(q => q[2] === o[2] && Math.hypot(q[0] - o[0], q[1] - o[1]) < 1),
          keys = new Set(near.map(q => q[3]));
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        if (keys.size >= 2 && (!best || keys.size > best.n))
          best = { n: keys.size, g: o[2], dx: r3(near.reduce((a, q) => a + q[0], 0) / near.length), dy: r3(near.reduce((a, q) => a + q[1], 0) / near.length) };
      });
      return best as { n: number; g: number; dx: number; dy: number } | null;
    };
    let g = 0,
      left = ok.slice();
    while (left.length) {
      // a new group starts from the read with the most crossings
      const seed = left
        .slice()
        .sort((a, b) => cr.get(b.r.key)!.size - cr.get(a.r.key)!.size || String(a.x.sheet).localeCompare(String(b.x.sheet), undefined, { numeric: true }))[0];
      at.set(seed.r.key, { dx: 0, dy: 0, g });
      left = left.filter(o => o !== seed);
      for (let grew = true; grew; ) {
        grew = false;
        left = left.filter(o => {
          const s = shiftTo(o.r);
          if (!s || s.g !== g) return true;
          at.set(o.r.key, { dx: s.dx, dy: s.dy, g });
          grew = true;
          return false;
        });
      }
      g++;
    }
    return { at, groups: g, unplaced };
  },

  // ---------- the pieces in 3D ----------
  /**
   * A size's section in inches, for drawing (from the nominal size; flanges and walls only roughly): W and similar
   * shapes are I's (depth from the name, flange width from the weight), HSS boxes, joists trusses (depth from the
   * series, 24 in when unknown). Not AISC dimensions — the drawing shows where and how big, not the exact section.
   */
  shape: (p: { k: Kind; size?: string }): Shape => {
    const s = String(p.size || "")
      .toUpperCase()
      .replace(/\s+/g, "");
    if (p.k === "joist") {
      const m = /^(\d{1,3})(?:K|KCS|LH|DLH|G|BG|VG)/.exec(s);
      return { t: "joist", d: m ? +m[1] : 24, b: 4 };
    }
    let m = /^(?:W|S|M|HP)(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)$/.exec(s);
    if (m) {
      const d = +m[1],
        lb = +m[2],
        b = lb / d >= 3 ? Math.min(d * 1.02, Math.max(Math.sqrt(lb), d * 0.9)) : Math.max(3.5, Math.min(d * 0.75, Math.sqrt(lb)));
      return { t: "I", d, b, tf: Math.max(0.3, Math.min(1.5, lb / (b * 9))), tw: Math.max(0.25, Math.min(1, lb / (d * 9))) };
    }
    if ((m = /^(?:C|MC)(\d+(?:\.\d+)?)X/.exec(s))) return { t: "I", d: +m[1], b: Math.max(2, +m[1] * 0.3), tf: 0.4, tw: 0.3 };
    if ((m = /^HSS(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)(?:X|$)/.exec(s))) return { t: "box", d: +m[1], b: +m[2] };
    if ((m = /^HSS(\d+(?:\.\d+)?)X\d/.exec(s))) return { t: "box", d: +m[1], b: +m[1] };
    if ((m = /^L(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/.exec(s))) return { t: "box", d: +m[1], b: +m[2] };
    return { t: "box", d: 8, b: 6, unknown: true };
  },
  tone: (st: PieceState): Tone => (st === "auto" ? "auto" : st === "add" ? "add" : "ok"),
  /**
   * The project's model: every live piece of the reads that could be placed, at its read's top-of-steel elevation (0
   * and flagged when the read has none); columns from the column marks, at the grid crossing nearest their label,
   * from the elevation below (the next lower read's, else the project's base, else 12 ft down) up to the read's.
   * Groups after the first sit side by side, 30 ft apart. f: { lvl, seq, done } filters (all when unset).
   */
  build: (sheets: SheetLite[], recs: ReadRec[], cfg: Settings, f?: { lvl?: string; seq?: string; done?: boolean }): Model => {
    const flt = f || {},
      { reads } = MD.reads(sheets, recs),
      pl = MS.place(reads);
    const placed = reads.filter(({ r }) => pl.at.has(r.key));
    const tosOf = (r: ReadRec) => (r.tos != null ? r.tos : 0),
      elevs = [...new Set(placed.filter(({ r }) => r.tos != null).map(({ r }) => r.tos as number))].sort((a, b) => a - b);
    const pieces: MPiece[] = [],
      cols: MCol[] = [],
      seen = new Set<string>();
    placed.forEach(({ x, r }) => {
      const p = pl.at.get(r.key)!,
        P = (u: number, v: number): [number, number] => [u / r.ppf + p.dx, -v / r.ppf + p.dy],
        seq = String(x.seq || "").trim(),
        lvl = r.lvl || "";
      if ((flt.lvl && flt.lvl !== lvl) || (flt.seq && flt.seq !== seq)) return;
      r.pcs.filter(MD.live).forEach(q => {
        if (flt.done && !MD.accepted(q)) return;
        const w = MD.weight(q, cfg);
        pieces.push({
          key: r.key + "/" + q.id,
          rid: r.key,
          pid: q.id,
          sid: x.id,
          sheet: x.sheet,
          rev: r.rev,
          pg: r.pg,
          a: q.a,
          g: p.g,
          lvl,
          seq,
          k: q.k,
          mark: q.mark,
          size: q.size,
          len: q.len,
          st: q.st,
          lb: w ? w.lb : null,
          tone: MS.tone(q.st),
          p0: P(q.a[0], q.a[1]),
          p1: P(q.a[2], q.a[3]),
          z: tosOf(r),
          noElev: r.tos == null,
          shape: MS.shape(q),
        });
      });
      const cr = MS.crossings(r);
      (r.cols || []).forEach(c => {
        const at = [c.x / r.ppf, -c.y / r.ppf];
        let best: [number, number] | null = null,
          bd = 10;
        cr.forEach(q => {
          const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
          if (d < bd) {
            bd = d;
            best = q;
          }
        });
        if (!best) return;
        const b0 = best as [number, number];
        const xy: [number, number] = [b0[0] + p.dx, b0[1] + p.dy],
          top = tosOf(r),
          key = (c.mark || c.size) + "@" + xy.map(v => Math.round(v)).join(",") + "@" + Math.round(top);
        if (seen.has(key)) return;
        seen.add(key);
        const below = elevs.filter(e => e < top - 4).pop(),
          bottom = below != null ? below : cfg.base != null && cfg.base < top ? cfg.base : top - 12;
        cols.push({
          key: "c:" + key,
          rid: r.key,
          sid: x.id,
          sheet: x.sheet,
          g: p.g,
          lvl,
          seq,
          mark: c.mark,
          size: c.size,
          xy,
          z0: bottom,
          z1: top,
          stub: below == null && cfg.base == null,
          tone: "col",
          shape: MS.shape({ k: "beam", size: c.size }),
        });
      });
    });
    // groups after the first: side by side to the east
    const box = (g: number) => {
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity;
      pieces.forEach(q => {
        if (q.g !== g) return;
        [q.p0, q.p1].forEach(v => {
          x0 = Math.min(x0, v[0]);
          x1 = Math.max(x1, v[0]);
          y0 = Math.min(y0, v[1]);
        });
      });
      return { x0, x1, y0 };
    };
    let east: number | null = null;
    for (let g = 0; g < pl.groups; g++) {
      const b = box(g);
      if (!isFinite(b.x0)) continue;
      const sx: number = east == null ? 0 : east + 30 - b.x0;
      if (sx) {
        pieces.forEach(q => {
          if (q.g === g) {
            q.p0 = [q.p0[0] + sx, q.p0[1]];
            q.p1 = [q.p1[0] + sx, q.p1[1]];
          }
        });
        cols.forEach(c => {
          if (c.g === g) c.xy = [c.xy[0] + sx, c.xy[1]];
        });
      }
      east = b.x1 + sx;
    }
    // each level once, with an elevation one of its sheets gives
    const lv = new Map<string, { name: string; tos: number | null }>();
    placed.forEach(({ r }) => {
      const k = r.lvl || "",
        o = lv.get(k);
      if (!o || (o.tos == null && r.tos != null)) lv.set(k, { name: k, tos: r.tos });
    });
    const levels = [...lv.values()].sort((a, b) => (a.tos ?? -1e9) - (b.tos ?? -1e9) || a.name.localeCompare(b.name));
    const seqs = [...new Set(placed.map(({ x }) => String(x.seq || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      pieces,
      cols,
      levels,
      seqs,
      groups: pl.groups,
      unplaced: pl.unplaced.concat(
        reads
          .filter(({ r }) => !pl.at.has(r.key) && !pl.unplaced.some(u => u.rid === r.key))
          .map(({ x, r }) => ({ rid: r.key, sheet: x.sheet, why: "shares no grid lines with the others" }))
      ),
      noElev: [...new Set(placed.filter(({ r }) => r.tos == null).map(({ x }) => x.sheet))],
    };
  },

  // ---------- what the 3D view draws ----------
  /**
   * Triangles (position, normal, colour per corner) for every piece and column: beams as I's or boxes hung from their
   * top of steel, joists as two chords with their web as lines, columns as upright boxes. boxes: one oriented box per
   * piece for picking (MS.pick). sel: the selected key; pal: each tone's colour and the selection's as 0–1 RGB.
   */
  mesh: (model: Pick<Model, "pieces" | "cols">, sel: string | null, pal: Palette): Mesh => {
    const P: number[] = [],
      N: number[] = [],
      C: number[] = [],
      LP: number[] = [],
      LC: number[] = [],
      boxes: PickBox[] = [],
      lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    const colOf = (q: { key: string; tone: Tone }) => (q.key === sel ? pal.sel : pal[q.tone] || pal.auto);
    // an oriented box: centre c, unit axes u v w, half sizes h
    const box = (c: V3, u: V3, v: V3, w: V3, h: V3, col: number[]) => {
      const k = (a: number, b: number, d: number) => [0, 1, 2].map(i => c[i] + u[i] * h[0] * a + v[i] * h[1] * b + w[i] * h[2] * d);
      (
        [
          [
            w,
            [
              [-1, -1, 1],
              [1, -1, 1],
              [1, 1, 1],
              [-1, 1, 1],
            ],
          ],
          [
            w.map(x => -x),
            [
              [-1, 1, -1],
              [1, 1, -1],
              [1, -1, -1],
              [-1, -1, -1],
            ],
          ],
          [
            u,
            [
              [1, -1, -1],
              [1, 1, -1],
              [1, 1, 1],
              [1, -1, 1],
            ],
          ],
          [
            u.map(x => -x),
            [
              [-1, 1, -1],
              [-1, -1, -1],
              [-1, -1, 1],
              [-1, 1, 1],
            ],
          ],
          [
            v,
            [
              [1, 1, -1],
              [-1, 1, -1],
              [-1, 1, 1],
              [1, 1, 1],
            ],
          ],
          [
            v.map(x => -x),
            [
              [-1, -1, -1],
              [1, -1, -1],
              [1, -1, 1],
              [-1, -1, 1],
            ],
          ],
        ] as [V3, [number, number, number][]][]
      ).forEach(([n, q]) => {
        const pts = q.map(s => k(s[0], s[1], s[2]));
        [0, 1, 2, 0, 2, 3].forEach(i => {
          P.push(...pts[i]);
          N.push(...n);
          C.push(...col);
          pts[i].forEach((x, j) => {
            lo[j] = Math.min(lo[j], x);
            hi[j] = Math.max(hi[j], x);
          });
        });
      });
    };
    const line = (a: V3, b: V3, col: number[]) => {
      LP.push(...a, ...b);
      LC.push(...col, ...col);
    };
    const W = [0, 0, 1];
    model.pieces.forEach(q => {
      const dx = q.p1[0] - q.p0[0],
        dy = q.p1[1] - q.p0[1],
        L = Math.hypot(dx, dy);
      if (L < 0.1) return;
      const u = [dx / L, dy / L, 0],
        v = [-dy / L, dx / L, 0],
        m = [(q.p0[0] + q.p1[0]) / 2, (q.p0[1] + q.p1[1]) / 2],
        s = q.shape,
        d = s.d / 12,
        b = s.b / 12,
        col = colOf(q);
      const at = (z: number) => [m[0], m[1], z];
      if (s.t === "I") {
        const tf = (s.tf || 0.3) / 12,
          tw = (s.tw || 0.25) / 12;
        box(at(q.z - tf / 2), u, v, W, [L / 2, b / 2, tf / 2], col);
        box(at(q.z - d + tf / 2), u, v, W, [L / 2, b / 2, tf / 2], col);
        box(at(q.z - d / 2), u, v, W, [L / 2, tw / 2, d / 2 - tf], col);
      } else if (s.t === "joist") {
        const ch = 1.5 / 12,
          cw = 2 / 12,
          n = Math.max(2, Math.round(L / Math.max(d, 2))),
          e = Math.min(0.5, L / 8);
        box(at(q.z - ch), u, v, W, [L / 2, cw, ch], col);
        box(at(q.z - d + ch), u, v, W, [L / 2 - e, cw, ch], col);
        for (let i = 0; i < n; i++) {
          const t0 = -L / 2 + e + ((L - 2 * e) * i) / n,
            t1 = -L / 2 + e + ((L - 2 * e) * (i + 1)) / n,
            z0 = i % 2 ? q.z - d + ch : q.z - ch,
            z1 = i % 2 ? q.z - ch : q.z - d + ch;
          line([m[0] + u[0] * t0, m[1] + u[1] * t0, z0], [m[0] + u[0] * t1, m[1] + u[1] * t1, z1], col);
        }
      } else box(at(q.z - d / 2), u, v, W, [L / 2, b / 2, d / 2], col);
      boxes.push({ key: q.key, c: at(q.z - d / 2), u, v, w: W, h: [L / 2, Math.max(b, 0.5) / 2, Math.max(d, 0.5) / 2] });
    });
    model.cols.forEach(q => {
      const s = q.shape,
        h = [Math.max(s.d, 4) / 24, Math.max(s.b, 4) / 24, (q.z1 - q.z0) / 2],
        c = [q.xy[0], q.xy[1], (q.z0 + q.z1) / 2];
      if (!(h[2] > 0)) return;
      box(c, [1, 0, 0], [0, 1, 0], W, h, colOf(q));
      boxes.push({ key: q.key, c, u: [1, 0, 0], v: [0, 1, 0], w: W, h: h.map(x => Math.max(x, 0.25)) });
    });
    return {
      pos: Float32Array.from(P),
      nrm: Float32Array.from(N),
      col: Float32Array.from(C),
      lpos: Float32Array.from(LP),
      lcol: Float32Array.from(LC),
      boxes,
      lo: isFinite(lo[0]) ? lo : [0, 0, 0],
      hi: isFinite(hi[0]) ? hi : [10, 10, 10],
    };
  },
  /** The box a ray from o along d meets first (unit d): its key, or null. */
  pick: (boxes: PickBox[], o: V3, d: V3): string | null => {
    let best: string | null = null,
      bt = Infinity;
    boxes.forEach(B => {
      let t0 = -Infinity,
        t1 = Infinity;
      for (const [ax, h] of [
        [B.u, B.h[0]],
        [B.v, B.h[1]],
        [B.w, B.h[2]],
      ] as [V3, number][]) {
        const e = ax[0] * (B.c[0] - o[0]) + ax[1] * (B.c[1] - o[1]) + ax[2] * (B.c[2] - o[2]),
          f = ax[0] * d[0] + ax[1] * d[1] + ax[2] * d[2];
        if (Math.abs(f) < 1e-9) {
          if (Math.abs(e) > h) return;
          continue;
        }
        let a = (e - h) / f,
          b = (e + h) / f;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) return;
      }
      const t = t0 > 0 ? t0 : t1;
      if (t > 0 && t < bt) {
        bt = t;
        best = B.key;
      }
    });
    return best;
  },

  // ---------- progress ----------
  /**
   * Pieces and tons by level and by sequence: how many there are, how many are accepted (accepted, fixed or added by
   * hand) and how many still need review. (The original SteelBuild model counts erected / connected / bolted from piece-mark daily logs; this
   * app has no piece-mark log stages, so this is review progress.) rows: MD.rows; lvlOf: read key → level; seqOf: sheet id
   * → sequence; seqLabel: a sequence's name.
   */
  progress: (rows: Row[], lvlOf: (rid: string) => string | undefined, seqOf: (sid: number) => string | undefined, seqLabel: (seq: string) => string = q => "Sequence " + q) => {
    type P = { key: string; label: string; n: number; lb: number; known: number; accepted: [number, number]; review: number; added: number };
    const add = (m: Map<string, P>, k: string, label: string, r: Row) => {
      const o = m.get(k) || { key: k, label, n: 0, lb: 0, known: 0, accepted: [0, 0] as [number, number], review: 0, added: 0 };
      o.n++;
      if (r.lb != null) {
        o.lb += r.lb;
        o.known++;
      }
      if (MD.accepted(r)) {
        o.accepted[0]++;
        o.accepted[1] += r.lb || 0;
      }
      if (r.st === "auto") o.review++;
      if (r.st === "add") o.added++;
      m.set(k, o);
    };
    const byL = new Map<string, P>(),
      byS = new Map<string, P>();
    rows.forEach(r => {
      const l = lvlOf(r.rid) || "",
        q = seqOf(r.sid) || "";
      add(byL, l || "—", l || "No level set", r);
      add(byS, q || "—", q ? seqLabel(q) : "No sequence", r);
    });
    const sort = (m: Map<string, P>) => [...m.values()].sort((a, b) => Number(a.key === "—") - Number(b.key === "—") || a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { byLevel: sort(byL), bySeq: sort(byS) };
  },
};
