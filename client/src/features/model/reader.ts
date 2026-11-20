/**
 * Reads the framing on one drawing page: grids, joists and beams with their piece marks, sizes, lengths and what each
 * end lands on, from the page's line work and text (pageGeometry in features/drawings/pdf.ts). Rules only, no AI: every
 * piece traces back to the label and the line it came from, and every piece is a suggestion until a person accepts it.
 * Measured blind on real sheets (SteelBuild docs/model/01-plan.md): joist placement plans ~100%, fabricators' erection
 * plans ~88% of labelled beams right; engineers' design sheets, stair plans and scans are not read.
 * Each label is read in its own frame at any angle (u along the text, v across it, + = below the baseline).
 *
 * Ported line for line from SteelBuild src/modules/model/reader.js, reader version 4 (measured 2026-11-03). Change the
 * rules only with the score script re-run, and bump READER_VERSION with any rule change. Pure: no DOM, no app.
 */
import type { PageText, Seg } from "../drawings/pdf";

export const READER_VERSION = 4;

export type Geo = { w: number; h: number; text?: PageText[]; segs?: Seg[] };
export type Kind = "beam" | "joist";
export type ReadGrid = { name: string; dir: "H" | "V" | "A"; at: number | null; x0: number; y0: number; x1: number; y1: number };
export type ReadMember = {
  n: number;
  kind: Kind;
  mark: string | null;
  label: string;
  dir: string;
  len: string | null;
  lenFt: number | null;
  ends: string[][];
  liftLb?: number;
  trimmedFt?: number | null;
  via?: "leader";
  at: [number, number, number, number];
};
export type ReadColumn = { mark: string; label: string; x: number; y: number };
export type ReadUnplaced = { label: string; kind: Kind; mark: string | null; x?: number; y?: number; rot?: number; note?: string };
export type ReadOther = { label: string; mark: string | null; view: string };
export type ReadOut = {
  page: number;
  sheet: { wIn: number; hIn: number };
  v: number;
  scale: { ptPerFt: number | null; inchesPerFoot: number | null; from: string; agreed: number };
  grids: ReadGrid[];
  members: ReadMember[];
  columns: ReadColumn[];
  otherViews: ReadOther[];
  unplaced: ReadUnplaced[];
};

type T = PageText;
type G = { x0: number; y0: number; x1: number; y1: number; lw: number; dash: boolean; pat: string; len: number; ang: number };
type Line = { x0: number; y0: number; x1: number; y1: number };
type Dashed = { ox: number; oy: number; ang: number; a: number; b: number; x0: number; y0: number; x1: number; y1: number; len: number };
type Grid = { name: string; ang: number; x0: number; y0: number; x1: number; y1: number; dir: "H" | "V" | "A"; at: number | null };
type Member = {
  kind: Kind;
  label: string;
  mark: string | null;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  lw: number;
  src: { x: number; y: number };
  via?: "leader";
  trimmed?: number;
  n?: number;
  lenFt?: number | null;
  len?: string | null;
  dir?: string;
  ends?: string[][];
  liftLb?: number;
};

export function read(geo: Geo, page?: number): ReadOut {
  const PW = geo.w,
    PH = geo.h,
    raw = geo.text || [],
    segsRaw = geo.segs || [],
    n = page || 1;
  const MARKUP_LW = 4; // wider strokes are highlighter markups, not drawing linework

  // ---------- inputs: on the sheet only, exact duplicates dropped (CAD often draws things twice) ----------
  const uniq = <X>(a: X[], key: (x: X) => string) => {
    const s = new Set<string>();
    return a.filter(x => {
      const k = key(x);
      if (s.has(k)) return false;
      s.add(k);
      return true;
    });
  };
  const onPage = (x: number, y: number) => x >= 0 && x <= PW && y >= 0 && y <= PH;
  const text: T[] = uniq(
    raw.map(t => ({ ...t, s: t.s.trim() })).filter(t => t.s && onPage(t.x, t.y)),
    t => t.s + "|" + t.x + "|" + t.y
  );
  const segs: G[] = uniq(segsRaw, g => g.join(","))
    .map(g => ({ x0: g[0], y0: g[1], x1: g[2], y1: g[3], lw: g[4], dash: g[5] === 1, pat: g[6] || "" }))
    .filter(g => onPage(g.x0, g.y0) && onPage(g.x1, g.y1))
    .map(g => ({ ...g, len: Math.hypot(g.x1 - g.x0, g.y1 - g.y0), ang: Math.atan2(g.y1 - g.y0, g.x1 - g.x0) }))
    .filter(g => g.len > 0.5);
  const rad = (d: number) => (d * Math.PI) / 180;
  const parallel = (a: number, b: number, tol = 0.035) => Math.abs(Math.sin(a - b)) < tol;
  // a text item's frame: page point -> [u, v]; and back
  const frameOf = (t: T) => {
    const a = rad(t.rot),
      c = Math.cos(a),
      s = Math.sin(a);
    return {
      to: (x: number, y: number): [number, number] => {
        const dx = x - t.x,
          dy = y - t.y;
        return [dx * c + dy * s, -dx * s + dy * c];
      },
      from: (u: number, v: number): [number, number] => [t.x + u * c - v * s, t.y + u * s + v * c],
    };
  };
  const med = (a: number[]) => {
    const s = [...a].sort((p, q) => p - q);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };

  // ---------- scale: feet-inch dimension strings against the dimension line under them, at any angle ----------
  const DIM = /^(\d+)'\s*-\s*(\d+)(?:\s*(\d+)\/(\d+))?"?$/;
  const ratios: { s: string; ft: number; pt: number; r: number }[] = [];
  for (const t of text) {
    const m = DIM.exec(t.s);
    if (!m) continue;
    const F = frameOf(t);
    let ft = +m[1] + (+m[2] + (m[3] ? +m[3] / +m[4] : 0)) / 12;
    if (!m[3]) {
      const f = text.find(
        o =>
          o !== t &&
          Math.abs(o.rot - t.rot) < 1 &&
          /^\d+\/\d+$/.test(o.s) &&
          (([u, v]) => u > t.w - 1 && u < t.w + 8 && Math.abs(v) < t.h * 0.9)(F.to(o.x, o.y))
      );
      if (f) {
        const [a, b] = f.s.split("/").map(Number);
        ft += a / b / 12;
      }
    }
    if (ft < 3) continue;
    const uc = t.w / 2;
    const line = segs
      .filter(g => !g.dash && g.lw < MARKUP_LW && parallel(g.ang, rad(t.rot)) && g.len > Math.max(3 * t.w, 40))
      .map(g => {
        const p = F.to(g.x0, g.y0),
          q = F.to(g.x1, g.y1);
        return { g, v: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) };
      })
      .filter(L => L.v > -1 && L.v < 6 && L.a < uc - 5 && L.b > uc + 5)
      .sort((p, q) => Math.abs(p.v) - Math.abs(q.v))[0];
    if (line) ratios.push({ s: t.s, ft, pt: line.g.len, r: line.g.len / ft });
  }
  const agreed = ratios.filter(r => ratios.filter(q => Math.abs(q.r / r.r - 1) < 0.005).length >= 3);
  const STD = [1 / 32, 1 / 16, 3 / 32, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1, 1.5, 3].map(i => i * 72); // inches per foot × 72
  const raw0 = med((agreed.length ? agreed : ratios).map(r => r.r)),
    snap = STD.find(v => raw0 && Math.abs(v / raw0 - 1) < 0.01);
  const ptPerFt = snap || raw0;
  const ft = (pt: number) => (ptPerFt ? pt / ptPerFt : null);
  const fmtFt = (f: number | null) => {
    if (f == null) return null;
    const tot = Math.round(f * 12 * 16) / 16,
      F = Math.floor(tot / 12),
      I = tot - F * 12;
    return F + "'-" + (Number.isInteger(I) ? I : I.toFixed(2).replace(/\.?0+$/, "")) + '"';
  };

  // ---------- grids: long center lines (long-short dashes) with a short name just past one of their ends (the bubble) ----------
  const GRIDNAME = /^([A-Z]{1,2}_[A-Z0-9]{1,3}(\.\d)?|[A-Z]{1,2}(\.\d{1,2})?|[A-Z]?\d{1,2}(\.\d{1,2})?)$/;
  const minGrid = 0.12 * Math.max(PW, PH);
  // a center line's dashes alternate long and short; hidden lines' dashes are all one length
  const centerPat = (p: string) => {
    const a = p
      .split(",")
      .map(Number)
      .filter(x => x > 0);
    if (a.length < 4) return false;
    const on = a.filter((_, i) => i % 2 === 0);
    return Math.max(...on) >= 2 * Math.min(...on);
  };
  // CAD may draw one grid line as many pieces: join the pieces on the same line into one extent
  const dashed = [] as Dashed[];
  for (const g of segs.filter(g => g.dash && centerPat(g.pat)).sort((p, q) => q.len - p.len)) {
    const L = dashed.find(l => parallel(l.ang, g.ang, 0.01) && Math.abs((g.x0 - l.ox) * Math.sin(l.ang) - (g.y0 - l.oy) * Math.cos(l.ang)) < 1.5);
    if (!L) {
      dashed.push({ ox: g.x0, oy: g.y0, ang: g.ang, a: 0, b: g.len } as Dashed);
      continue;
    }
    const cx = Math.cos(L.ang),
      cy = Math.sin(L.ang),
      t0 = (g.x0 - L.ox) * cx + (g.y0 - L.oy) * cy,
      t1 = (g.x1 - L.ox) * cx + (g.y1 - L.oy) * cy;
    L.a = Math.min(L.a, t0, t1);
    L.b = Math.max(L.b, t0, t1);
  }
  // some CAD exports explode a dashed linetype into separate short solid pieces: a long row of short thin pieces on one
  // line, with gaps between them, is a dashed line too
  {
    const rows: { ox: number; oy: number; ang: number; pieces: G[] }[] = [];
    for (const g of segs.filter(g => !g.dash && g.lw < 1 && g.len >= 3 && g.len <= 40)) {
      const R = rows.find(l => parallel(l.ang, g.ang, 0.01) && Math.abs((g.x0 - l.ox) * Math.sin(l.ang) - (g.y0 - l.oy) * Math.cos(l.ang)) < 1);
      if (R) R.pieces.push(g);
      else rows.push({ ox: g.x0, oy: g.y0, ang: g.ang, pieces: [g] });
    }
    for (const R of rows) {
      if (R.pieces.length < 6) continue;
      const cx = Math.cos(R.ang),
        cy = Math.sin(R.ang),
        ts = R.pieces.flatMap(g => [(g.x0 - R.ox) * cx + (g.y0 - R.oy) * cy, (g.x1 - R.ox) * cx + (g.y1 - R.oy) * cy]);
      const a = Math.min(...ts),
        b = Math.max(...ts),
        cover = R.pieces.reduce((s, g) => s + g.len, 0) / (b - a);
      if (b - a > minGrid && cover > 0.4 && cover < 0.95) dashed.push({ ox: R.ox, oy: R.oy, ang: R.ang, a, b } as Dashed);
    }
  }
  dashed.forEach(l => {
    const cx = Math.cos(l.ang),
      cy = Math.sin(l.ang);
    l.x0 = l.ox + l.a * cx;
    l.y0 = l.oy + l.a * cy;
    l.x1 = l.ox + l.b * cx;
    l.y1 = l.oy + l.b * cy;
    l.len = l.b - l.a;
  });
  for (let i = dashed.length - 1; i >= 0; i--) if (dashed[i].len <= minGrid) dashed.splice(i, 1);
  const gridHits: Record<string, Dashed[]> = {};
  for (const t of text) {
    if (!GRIDNAME.test(t.s) || t.h < 6) continue;
    const F = frameOf(t),
      [cx, cy] = F.from(t.w / 2, -0.35 * t.h);
    let best: { g: Dashed; sc: number } | null = null;
    for (const g of dashed) {
      const dx = Math.cos(g.ang),
        dy = Math.sin(g.ang);
      for (const [ex, ey, o] of [
        [g.x0, g.y0, -1],
        [g.x1, g.y1, 1],
      ]) {
        const wx = cx - ex,
          wy = cy - ey,
          along = (wx * dx + wy * dy) * o,
          perp = Math.abs(wx * dy - wy * dx);
        if (along > -5 && along < 4 * t.h + 20 && perp < Math.max(12, t.w)) {
          const sc = Math.max(0, along) + perp;
          if (!best || sc < best.sc) best = { g, sc };
        }
      }
    }
    if (best) (gridHits[t.s] = gridHits[t.s] || []).push(best.g);
  }
  const grids: Grid[] = [];
  for (const [name, gs] of Object.entries(gridHits)) {
    // one line per name: the hit lines plus the dashed lines collinear with them, as one extent
    const g0 = gs[0];
    if (gs.some(g => g !== g0)) continue; // the same name on two different lines: not a grid
    grids.push({ name, ang: g0.ang, x0: g0.x0, y0: g0.y0, x1: g0.x1, y1: g0.y1, dir: "A", at: null });
  }
  const gdir = (g: { ang: number }): "H" | "V" | "A" => (Math.abs(Math.sin(g.ang)) < 0.01 ? "H" : Math.abs(Math.cos(g.ang)) < 0.01 ? "V" : "A");
  grids.forEach(g => {
    g.dir = gdir(g);
    g.at = g.dir === "H" ? (g.y0 + g.y1) / 2 : g.dir === "V" ? (g.x0 + g.x1) / 2 : null;
  });
  grids.sort((p, q) => (p.dir < q.dir ? -1 : p.dir > q.dir ? 1 : (p.at ?? 0) - (q.at ?? 0)));

  // ---------- members: a mark or size label, the text stacked with it, and the line just outside that block ----------
  const JOIST = /^(T|J|K|LH|DLH|JG)\d{1,4}[A-Z]?$|^\d{1,2}(K|KCS|LH|DLH)\d{0,2}$/; // a mark (T12, J145) or a series designation (22K, 28LH05)
  const GIRDER = /^\d{2}(G|BG|VG)\d{0,2}$/; // a joist girder designation (28G): drawn and carried like a beam
  const SIZE = /^((?:W|HSS|MC|C|WT|S|HP)\d+(?:\.\d+)?X[\d./]+(?:X[\d./]*)?)(?=$|\s*[[(])/i; // a bracketed note may follow ("W16X31 [ 27 ]"), free text may not ("W24x76 - ____ lbs" is a markup)
  const MARK = /^\d{0,3}[A-Z]{1,3}\d{3,5}[A-Z]?(\(\?\))?$/;
  const solid = segs.filter(g => !g.dash && g.lw < MARKUP_LW);
  const thinLines = solid.filter(g => g.lw < 1 && g.len > 3);
  const ptSegG = (px: number, py: number, a: Line) => {
    const rx = a.x1 - a.x0,
      ry = a.y1 - a.y0,
      L2 = rx * rx + ry * ry;
    const s = Math.max(0, Math.min(1, ((px - a.x0) * rx + (py - a.y0) * ry) / L2));
    return Math.hypot(px - a.x0 - rx * s, py - a.y0 - ry * s);
  };
  const members: Member[] = [],
    unplaced: ReadUnplaced[] = [],
    columns: ReadColumn[] = [];
  for (const t of text) {
    const sm = SIZE.exec(t.s);
    const kind: Kind | null = JOIST.test(t.s) ? "joist" : sm || GIRDER.test(t.s) ? "beam" : null;
    if (!kind) continue;
    const label = (sm ? sm[1] : t.s).toUpperCase(),
      F = frameOf(t),
      h = t.h,
      w = t.w;
    // the label block: rows of text at the same angle, each within ~one line of the last, overlapping it along the text
    const rows: { o: T; v: number; u: number }[] = [{ o: t, v: 0, u: 0 }];
    for (let pass = 0; pass < 2; pass++)
      for (const o of text) {
        if (rows.some(r => r.o === o) || Math.abs(o.rot - t.rot) > 2 || rows.length >= 4) continue;
        const [u, v] = F.to(o.x, o.y);
        if (u + o.w < -0.2 * w || u > 1.2 * w) continue;
        if (rows.some(r => (Math.abs(v - r.v) < 1.35 * h && Math.abs(v - r.v) > 0.5 * h) || (Math.abs(v - r.v) <= 0.5 * h && u + o.w < 0 && u + o.w > -1.5 * h)))
          rows.push({ o, v, u });
      }
    const top = Math.min(...rows.map(r => r.v)) - h,
      bottom = Math.max(...rows.map(r => r.v));
    const markRow = rows.filter(r => r.o !== t && MARK.test(r.o.s)).sort((p, q) => Math.abs(p.v + h) - Math.abs(q.v + h))[0];
    const pref = (g: G) => (kind === "beam" ? (g.lw > 1 ? 0 : 1) : g.lw <= 1 ? 0 : 1); // beams are drawn heavier than joists
    const dist = (v: number) => (v < -h ? -h - v : v > 0 ? v : 0); // from the label's own letters
    const cands: { g: G; v: number; d: number }[] = [];
    for (const g of solid) {
      if (!parallel(g.ang, rad(t.rot)) || g.len <= Math.max(40, 1.2 * w)) continue;
      if (kind === "joist" && ptPerFt && g.len < 8 * ptPerFt) continue; // no joist spans less than about 8 ft
      const p = F.to(g.x0, g.y0),
        q = F.to(g.x1, g.y1),
        v = (p[1] + q[1]) / 2,
        uc = w / 2;
      if (Math.min(p[0], q[0]) > uc || Math.max(p[0], q[0]) < uc) continue;
      const inWindow = (v > top - 0.6 * h - 2 && v < bottom + 0.8 * h + 2) || (v > -(h + 6) && v < 8);
      if (!inWindow) continue;
      // a line through the letters is a weaker match than one just outside them, but some joist marks are drawn right
      // over their own line
      const through = v > -0.8 * h && v < -0.15 * h;
      cands.push({ g, v, d: through ? Math.round(0.5 * h) : Math.round(dist(v)) });
    }
    // a series label (22K, 32LH) beside a hidden (evenly dashed) joist line is a joist by others, shown for reference
    if (kind === "joist" && /^\d/.test(t.s)) {
      const best = cands.length ? Math.min(...cands.map(c => c.d)) : Infinity;
      const hidden = segs.some(
        g =>
          g.dash &&
          !centerPat(g.pat) &&
          parallel(g.ang, rad(t.rot)) &&
          g.len > Math.max(40, 1.2 * w) &&
          (() => {
            const p = F.to(g.x0, g.y0),
              q = F.to(g.x1, g.y1),
              v = (p[1] + q[1]) / 2;
            return Math.min(p[0], q[0]) <= w / 2 && Math.max(p[0], q[0]) >= w / 2 && v > -(h + 6) && v < 8 && Math.round(dist(v)) <= best;
          })()
      );
      if (hidden) {
        unplaced.push({ label: t.s, kind, mark: null, note: "joist by others (dashed)" });
        continue;
      }
    }
    const mark = markRow ? markRow.o.s : null;
    // a column's piece mark has C before its number (C1131, 502C2003): a column callout, not a beam on the line beside it
    if (mark && /^\d{0,3}C\d/.test(mark)) {
      columns.push({ mark, label, x: +t.x.toFixed(1), y: +t.y.toFixed(1) });
      continue;
    }
    let c: { g: G } | undefined = cands.sort((p, q) => pref(p.g) - pref(q.g) || p.d - q.d || q.g.len - p.g.len)[0],
      via: "leader" | null = null;
    // a callout away from its member points at it with a leader: a thin line from the end of the label block to a
    // member line (one or two legs)
    if (!c) {
      const ends = [F.from(-2, -h / 2), F.from(w + 2, -h / 2)];
      for (const [ex, ey] of ends) {
        let leg = thinLines.find(g => Math.min(Math.hypot(g.x0 - ex, g.y0 - ey), Math.hypot(g.x1 - ex, g.y1 - ey)) < Math.max(4, 0.4 * h));
        let tip: [number, number] | null = null,
          from: [number, number] = [ex, ey],
          lastAng = 0;
        for (let hop = 0; leg && hop < 2; hop++) {
          const far: [number, number] =
            Math.hypot(leg.x0 - from[0], leg.y0 - from[1]) < Math.hypot(leg.x1 - from[0], leg.y1 - from[1]) ? [leg.x1, leg.y1] : [leg.x0, leg.y0];
          tip = far;
          lastAng = leg.ang;
          const prev: G = leg;
          leg = thinLines.find(
            g => g !== prev && !parallel(g.ang, prev.ang, 0.05) && Math.min(Math.hypot(g.x0 - far[0], g.y0 - far[1]), Math.hypot(g.x1 - far[0], g.y1 - far[1])) < 1.5
          );
          from = far;
        }
        if (!tip) continue;
        const tp = tip;
        // the tip must land along the line, not at an end, where a leader usually points at a column or a connection
        const along = (g: G) => {
          const rx = g.x1 - g.x0,
            ry = g.y1 - g.y0;
          return ((tp[0] - g.x0) * rx + (tp[1] - g.y0) * ry) / (rx * rx + ry * ry);
        };
        // and a leader meets its member at an angle: a line running on along the leader's last leg is not the target
        const hit = solid
          .filter(g => g.lw > 1 && g.len > 40 && ptSegG(tp[0], tp[1], g) < 4 && along(g) > 0.08 && along(g) < 0.92 && !parallel(g.ang, lastAng, 0.3))
          .sort((p, q) => q.len - p.len)[0];
        if (hit) {
          c = { g: hit };
          via = "leader";
          break;
        }
      }
    }
    if (!c) {
      unplaced.push({ label, kind, mark, x: +t.x.toFixed(1), y: +t.y.toFixed(1), rot: t.rot });
      continue;
    }
    const [sx, sy] = via ? [c.g.x0 + (c.g.x1 - c.g.x0) / 2, c.g.y0 + (c.g.y1 - c.g.y0) / 2] : F.from(w / 2, 0);
    members.push({ kind, label, mark, x0: c.g.x0, y0: c.g.y0, x1: c.g.x1, y1: c.g.y1, lw: c.g.lw, src: { x: sx, y: sy }, ...(via ? { via } : {}) });
  }
  // a joist stops at its supports: from the label, the first heavy line crossing it on each side (a beam or wall);
  // past that, the drawn line is an extension line or a top-chord extension
  {
    const heavy = segs.filter(g => g.lw > 1 && g.lw < MARKUP_LW && g.len > 30);
    const cross = (m: Line, g: G) => {
      // parameter along m where g crosses it, or null
      const rx = m.x1 - m.x0,
        ry = m.y1 - m.y0,
        sx = g.x1 - g.x0,
        sy = g.y1 - g.y0,
        den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9 || Math.abs(Math.sin(Math.atan2(ry, rx) - g.ang)) < 0.5) return null;
      const qx = g.x0 - m.x0,
        qy = g.y0 - m.y0,
        s = (qx * sy - qy * sx) / den,
        u = (qx * ry - qy * rx) / den;
      return u >= -0.01 && u <= 1.01 && s > -0.01 && s < 1.01 ? s : null;
    };
    for (const m of members) {
      if (m.kind !== "joist") continue;
      const L = Math.hypot(m.x1 - m.x0, m.y1 - m.y0),
        sc = ((m.src.x - m.x0) * (m.x1 - m.x0) + (m.src.y - m.y0) * (m.y1 - m.y0)) / (L * L);
      const ss = heavy.map(g => cross(m, g)).filter((s): s is number => s != null);
      const lo = ss.filter(s => s < sc).sort((a, b) => b - a)[0],
        hi = ss.filter(s => s > sc).sort((a, b) => a - b)[0];
      const ax = m.x0,
        ay = m.y0,
        bx = m.x1,
        by = m.y1;
      let trimmed = 0;
      if (lo != null && lo * L > 2) {
        trimmed += lo * L;
        m.x0 = ax + (bx - ax) * lo;
        m.y0 = ay + (by - ay) * lo;
      }
      if (hi != null && (1 - hi) * L > 2) {
        trimmed += (1 - hi) * L;
        m.x1 = ax + (bx - ax) * hi;
        m.y1 = ay + (by - ay) * hi;
      }
      if (trimmed) m.trimmed = trimmed;
    }
  }
  // a line that already carries its own label is that member: a leader landing on it points at something else there
  for (let i = members.length - 1; i >= 0; i--) {
    const m = members[i];
    if (m.via !== "leader") continue;
    const same = (o: Member) => o !== m && !o.via && Math.abs(o.x0 - m.x0) + Math.abs(o.y0 - m.y0) + Math.abs(o.x1 - m.x1) + Math.abs(o.y1 - m.y1) < 1;
    const flip = (o: Member) => o !== m && !o.via && Math.abs(o.x0 - m.x1) + Math.abs(o.y0 - m.y1) + Math.abs(o.x1 - m.x0) + Math.abs(o.y1 - m.y0) < 1;
    if (members.some(o => same(o) || flip(o))) {
      unplaced.push({ label: m.label, kind: m.kind, mark: m.mark, note: "leader to a labelled line" });
      members.splice(i, 1);
    }
  }
  // ---------- views: a detail, section or elevation drawn on the same sheet repeats plan members at other places ----------
  // Each view is a separate patch of linework with whitespace around it. The plan is the patch holding the most members;
  // members in another patch whose title says DETAIL, SECTION or ELEVATION are set aside, not read as plan members.
  const otherViews: ReadOther[] = [];
  {
    const CELL = 12,
      GW = Math.ceil(PW / CELL) + 1,
      GH = Math.ceil(PH / CELL) + 1,
      occ = new Uint8Array(GW * GH);
    const edge = 0.03 * Math.min(PW, PH),
      nearEdge = (x: number, y: number) => x < edge || y < edge || x > PW - edge || y > PH - edge;
    for (const g of segs) {
      if (nearEdge(g.x0, g.y0) && nearEdge(g.x1, g.y1)) continue; // the sheet border
      if (g.len > 0.5 * Math.min(PW, PH)) continue; // frame and title-block lines would join every view; the plan has plenty else
      const k = Math.max(1, Math.ceil(g.len / (CELL / 2)));
      for (let i = 0; i <= k; i++) {
        const x = g.x0 + ((g.x1 - g.x0) * i) / k,
          y = g.y0 + ((g.y1 - g.y0) * i) / k;
        occ[Math.floor(y / CELL) * GW + Math.floor(x / CELL)] = 1;
      }
    }
    const comp = new Int32Array(GW * GH).fill(-1),
      boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (let s0 = 0; s0 < occ.length; s0++) {
      if (!occ[s0] || comp[s0] >= 0) continue;
      const id = boxes.length,
        box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
        q = [s0];
      comp[s0] = id;
      while (q.length) {
        const c = q.pop()!,
          cx = c % GW,
          cy = (c - cx) / GW;
        box.x0 = Math.min(box.x0, cx * CELL);
        box.y0 = Math.min(box.y0, cy * CELL);
        box.x1 = Math.max(box.x1, (cx + 1) * CELL);
        box.y1 = Math.max(box.y1, (cy + 1) * CELL);
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            // gaps up to ~2 cells still join
            const nx = cx + dx,
              ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
            const nb = ny * GW + nx;
            if (occ[nb] && comp[nb] < 0) {
              comp[nb] = id;
              q.push(nb);
            }
          }
      }
      boxes.push(box);
    }
    const viewOf = (m: Member) => {
      const x = (m.x0 + m.x1) / 2,
        y = (m.y0 + m.y1) / 2;
      return comp[Math.floor(y / CELL) * GW + Math.floor(x / CELL)];
    };
    const count: Record<string, number> = {};
    members.forEach(m => {
      const v = viewOf(m);
      count[v] = (count[v] || 0) + 1;
    });
    const main = +(Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] as string);
    const TITLE = /\b(DETAIL|SECTION|ELEVATION)\b/i;
    const titled: Record<number, string> = {};
    for (const v of Object.keys(count).map(Number)) {
      if (v === main || v < 0) continue;
      const b = boxes[v],
        hgt = b.y1 - b.y0;
      const t = text.find(t => TITLE.test(t.s) && t.h >= 9 && t.x > b.x0 - 60 && t.x < b.x1 + 60 && t.y > b.y1 - 0.15 * hgt && t.y < b.y1 + 120);
      if (t) titled[v] = t.s;
    }
    for (let i = members.length - 1; i >= 0; i--) {
      const v = viewOf(members[i]);
      if (titled[v]) {
        otherViews.push({ label: members[i].label, mark: members[i].mark, view: titled[v] });
        members.splice(i, 1);
      }
    }
  }
  // A view drawn close to the plan joins its linework, so also: a piece mark names one piece design, and the same mark
  // drawn again at a clearly different length far across the sheet is a copy in another view (the copy farther from the
  // bulk of the members). Where two or more such copies sit together, everything in their area is that view.
  {
    const L = (m: Member) => Math.hypot(m.x1 - m.x0, m.y1 - m.y0),
      mid = (m: Member) => [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2];
    const cx = members.reduce((s, m) => s + mid(m)[0], 0) / (members.length || 1),
      cy = members.reduce((s, m) => s + mid(m)[1], 0) / (members.length || 1);
    const fromC = (m: Member) => Math.hypot(mid(m)[0] - cx, mid(m)[1] - cy),
      far = 0.25 * Math.max(PW, PH);
    const byMark: Record<string, Member[]> = {};
    members.forEach(m => {
      if (m.mark) (byMark[m.mark] = byMark[m.mark] || []).push(m);
    });
    const away = new Set<Member>();
    for (const ms of Object.values(byMark))
      for (const a of ms)
        for (const b of ms) {
          if (a === b || Math.max(L(a), L(b)) <= 1.1 * Math.min(L(a), L(b))) continue;
          if (Math.hypot(mid(a)[0] - mid(b)[0], mid(a)[1] - mid(b)[1]) > far) away.add(fromC(a) > fromC(b) ? a : b);
        }
    if (away.size >= 2) {
      const A = [...away],
        rb = {
          x0: Math.min(...A.flatMap(m => [m.x0, m.x1])) - 20,
          y0: Math.min(...A.flatMap(m => [m.y0, m.y1])) - 20,
          x1: Math.max(...A.flatMap(m => [m.x0, m.x1])) + 20,
          y1: Math.max(...A.flatMap(m => [m.y0, m.y1])) + 20,
        };
      for (let i = members.length - 1; i >= 0; i--) {
        const [x, y] = mid(members[i]);
        if (x >= rb.x0 && x <= rb.x1 && y >= rb.y0 && y <= rb.y1) {
          otherViews.push({ label: members[i].label, mark: members[i].mark, view: "copies of plan marks" });
          members.splice(i, 1);
        }
      }
    }
  }
  // endpoints in a fixed order (left to right, then top to bottom), so results compare across versions
  for (const m of members) if (m.x1 < m.x0 - 0.05 || (Math.abs(m.x1 - m.x0) <= 0.05 && m.y1 < m.y0)) [m.x0, m.y0, m.x1, m.y1] = [m.x1, m.y1, m.x0, m.y0];
  // the same line claimed twice by one label (a mark repeated for clarity) is one member; two labels on one line are two
  const dedup = uniq(members, m => (m.mark || m.label) + "|" + [m.x0, m.y0, m.x1, m.y1].map(v => v.toFixed(1)).join(","));
  // where each end lands: grid lines and beam lines crossing within 1 ft
  const ptSeg = (px: number, py: number, a: Line) => {
    const rx = a.x1 - a.x0,
      ry = a.y1 - a.y0,
      L2 = rx * rx + ry * ry;
    const s = Math.max(0, Math.min(1, ((px - a.x0) * rx + (py - a.y0) * ry) / L2));
    return Math.hypot(px - a.x0 - rx * s, py - a.y0 - ry * s);
  };
  const near = (x: number, y: number, m: Member) => {
    const tol = ptPerFt || 9,
      ang = Math.atan2(m.y1 - m.y0, m.x1 - m.x0);
    const gs = grids
      .filter(
        g =>
          !parallel(g.ang, ang, 0.2) &&
          ptSeg(x, y, { x0: g.x0 - (g.x1 - g.x0) * 0.05, y0: g.y0 - (g.y1 - g.y0) * 0.05, x1: g.x1 + (g.x1 - g.x0) * 0.05, y1: g.y1 + (g.y1 - g.y0) * 0.05 }) < tol
      )
      .map(g => g.name);
    const bs = dedup
      .filter(b => b !== m && b.kind === "beam" && !parallel(Math.atan2(b.y1 - b.y0, b.x1 - b.x0), ang, 0.2) && ptSeg(x, y, b) < tol)
      .map(b => "beam " + (b.mark || b.label));
    return [...gs, ...bs];
  };
  const wPerFt = (s: string) => {
    const m = /^W\d+X([\d.]+)$/i.exec(s);
    return m ? +m[1] : null;
  }; // nominal lb/ft = the number after X
  dedup.forEach((m, i) => {
    m.n = i + 1;
    const lenPt = Math.hypot(m.x1 - m.x0, m.y1 - m.y0),
      f = ft(lenPt);
    m.lenFt = f != null ? +f.toFixed(3) : null;
    m.len = fmtFt(m.lenFt);
    const a = (Math.atan2(m.y1 - m.y0, m.x1 - m.x0) * 180) / Math.PI;
    m.dir = Math.abs(Math.sin(rad(a))) < 0.01 ? "H" : Math.abs(Math.cos(rad(a))) < 0.01 ? "V" : "A" + a.toFixed(1);
    m.ends = [near(m.x0, m.y0, m), near(m.x1, m.y1, m)];
    const w = m.kind === "beam" ? wPerFt(m.label) : null;
    if (w && m.lenFt) m.liftLb = Math.round(w * m.lenFt);
  });

  const tr = (v: number | null | undefined) => (v != null ? ft(v) : null);
  return {
    page: n,
    sheet: { wIn: +(PW / 72).toFixed(1), hIn: +(PH / 72).toFixed(1) },
    v: READER_VERSION,
    scale: {
      ptPerFt: ptPerFt ? +ptPerFt.toFixed(3) : ptPerFt,
      inchesPerFoot: ptPerFt ? +(ptPerFt / 72).toFixed(4) : ptPerFt,
      from: ratios.length + " dimension strings",
      agreed: agreed.length,
    },
    grids: grids.map(g => ({ name: g.name, dir: g.dir, at: g.at != null ? +g.at.toFixed(2) : null, x0: +g.x0.toFixed(1), y0: +g.y0.toFixed(1), x1: +g.x1.toFixed(1), y1: +g.y1.toFixed(1) })),
    members: dedup.map(m => {
      const t = m.trimmed ? tr(m.trimmed) : undefined;
      return {
        n: m.n!,
        kind: m.kind,
        mark: m.mark,
        label: m.label,
        dir: m.dir!,
        len: m.len ?? null,
        lenFt: m.lenFt ?? null,
        ends: m.ends!,
        ...(m.liftLb ? { liftLb: m.liftLb } : {}),
        ...(m.trimmed ? { trimmedFt: t != null ? +t.toFixed(2) : null } : {}),
        ...(m.via ? { via: m.via } : {}),
        at: [+m.x0.toFixed(1), +m.y0.toFixed(1), +m.x1.toFixed(1), +m.y1.toFixed(1)] as [number, number, number, number],
      };
    }),
    columns,
    otherViews,
    unplaced,
  };
}
