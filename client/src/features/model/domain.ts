/**
 * Model (SteelBuild docs/model/01-plan.md): the framing read from the register's drawings, piece by piece. Record
 * cleaning and pure rules here — no React, no window, no tRPC — so the tests load this file directly.
 * Ported from SteelBuild src/modules/model/domain.js (MD).
 *
 * A read: one per sheet revision page (server table model_reads): what the reader (reader.ts) found there — each
 * piece's kind, mark, size, the line it is on (page units, as the viewer draws), its length and what its ends land on —
 * plus the page's scale and grid lines, the labels it couldn't place, the pieces it set aside as another view, and each
 * piece's review: needs review (auto), accepted (ok), fixed (edit), added by hand (add) or rejected (no).
 * Settings: one per job — the lift allowance, base elevation and the joist weights from the supplier's joist list.
 * Pieces stay in the page units of the sheet they came from; lists, weights and totals are worked out from them.
 *
 * This app has no piece-mark daily-log stages, so nothing here colours or counts pieces by a logged erection stage
 * (SteelBuild's MD.stages / logOf); pieces are grouped by review state and by the sheet's erection sequence instead.
 */
import type { ReadOut } from "./reader";

export type Kind = "beam" | "joist";
export type PieceState = "auto" | "ok" | "edit" | "add" | "no";
export type Line4 = [number, number, number, number];
export type Piece = {
  id: string;
  k: Kind;
  mark: string;
  size: string;
  a: Line4;
  len: number;
  ends: (string | null)[][];
  via: "" | "leader" | "hand";
  st: PieceState;
  by?: number;
  at?: string;
  note?: string;
};
export type ReadData = {
  w: number;
  h: number;
  ppf: number;
  sl: string;
  lvl: string;
  lvlBy: "" | "read" | "hand";
  tos: number | null;
  tosBy: "" | "read" | "hand";
  grids: { n: string; a: Line4 }[];
  pcs: Piece[];
  cols: { mark: string; size: string; x: number; y: number }[];
  left: { label: string; k: Kind; mark: string; x: number; y: number; note: string }[];
  aside: { label: string; mark: string; view: string }[];
};
export type Settings = { allow: number; base: number | null; jw: { mark: string; lb: number }[] };
export type RevLite = { n: number; state: string; pdf: string | null; img: string | null };
/** A register sheet as the model needs it. seq: the erection sequence (task id as text, '' when none). */
export type SheetLite = { id: number; sheet: string; title: string; seq: string; revs: RevLite[] };
/** A stored read with where it belongs. key: MD.idOf(sid, rev, pg); id: the server's id (null before it is saved). */
export type ReadRec = ReadData & { key: string; id: number | null; sid: number; rev: number; pg: number; v: number; version: number; by: number | null; at: string };

export const STATES: Record<PieceState, string> = { auto: "Needs review", ok: "Accepted", edit: "Fixed", add: "Added by hand", no: "Rejected" };
export const MAX = { pcs: 700, grids: 120, cols: 300, left: 400, aside: 100, jw: 1000 };
export const FIELD_MAX = { mark: 24, size: 30, note: 200 };
/** pages read per drawing (a register sheet is normally one page) */
export const PAGES = 4;

const r2 = (v: number) => Math.round(v * 100) / 100;
const clampN = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, r2(n))) : 0;
};
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const pick = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T => (opts.includes(v as T) ? (v as T) : dflt);
const line = (a: unknown): Line4 | null => (Array.isArray(a) && a.length === 4 ? (a.map(v => clampN(v, -1e5, 1e5)) as Line4) : null);
/** an elevation in feet, or null when not known (blank is not zero) */
const elevOrNull = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(20000, Math.max(-2000, Math.round(n * 10000) / 10000)) : null;
};

export const MD = {
  STATES,
  idOf: (sid: number | string, rev: number, pg: number) => ("mr-" + sid + "-" + rev + "-" + pg).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80),
  live: (p: { st: PieceState }) => p.st !== "no",
  accepted: (p: { st: PieceState }) => p.st === "ok" || p.st === "edit" || p.st === "add",
  /** feet and inches to the nearest sixteenth: 23'-5 7/8" */
  feet: (f: number | null | undefined) => {
    if (!(f != null && f > 0)) return "—";
    const t = Math.round(f * 192) / 16,
      F = Math.floor(t / 12),
      I = t - F * 12,
      w = Math.floor(I),
      fr = Math.round((I - w) * 16);
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a),
      n = fr / g(fr, 16),
      dd = 16 / g(fr, 16);
    return F + "'-" + w + (fr ? " " + n + "/" + dd : "") + '"';
  },
  lb: (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US") + " lb"),
  /** the revision whose drawing a sheet shows: the issued one with a drawing, else the newest with one */
  curRev: (x: Pick<SheetLite, "revs">): RevLite | null => {
    const rs = (x.revs || []).filter(r => r.pdf || r.img);
    return rs.find(r => r.state === "issued") || [...rs].sort((a, b) => b.n - a.n)[0] || null;
  },
  pieceName: (p: { mark?: string; size?: string }) => [p.mark, p.size].filter(Boolean).join(" ") || "Piece",

  // ---------- weight ----------
  /**
   * lb per foot of a shape. W, S, M, HP, C, MC, WT, MT and ST shapes: the nominal weight in their name (W24X76 → 76).
   * HSS and angles: from their dimensions (steel at 490 lb/ft³ is 3.40 lb/ft per square inch of section), marked
   * approximate. Anything else: unknown (null).
   */
  lbPerFt: (size: string | null | undefined): { lb: number; approx: boolean } | null => {
    const s = String(size || "")
      .toUpperCase()
      .replace(/\s+/g, "");
    let m = /^(W|S|M|HP|C|MC|WT|MT|ST)\d+(?:\.\d+)?X(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return { lb: +m[2], approx: false };
    const num = (t: string) => {
      const q = /^(\d+)?(?:-?(\d+)\/(\d+))?$|^(\d*\.\d+)$/.exec(t || "");
      if (!q) return NaN;
      if (q[4]) return +q[4];
      return (q[1] ? +q[1] : 0) + (q[2] ? +q[2] / +q[3] : 0);
    };
    m = /^HSS(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X([\d./-]+)$/.exec(s);
    if (m) {
      const a = +m[1],
        b = +m[2],
        t = num(m[3]);
      if (!(t > 0) || t * 2 >= Math.min(a, b)) return null;
      return { lb: Math.round(3.4 * 2 * t * (a + b - 2 * t) * 100) / 100, approx: true };
    }
    m = /^L(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X([\d./-]+)$/.exec(s);
    if (m) {
      const a = +m[1],
        b = +m[2],
        t = num(m[3]);
      if (!(t > 0) || t >= Math.min(a, b)) return null;
      return { lb: Math.round(3.4 * t * (a + b - t) * 100) / 100, approx: true };
    }
    return null;
  },
  /**
   * A piece's weight: a joist's from the project's joist list (lb per joist, by mark); a beam's from its shape and
   * length. The project's allowance (connections, %) is added to both. null when unknown.
   */
  weight: (p: { k: Kind; mark?: string; size?: string; len: number }, cfg: Partial<Settings> | null | undefined): { lb: number; approx: boolean; src: "list" | "shape" } | null => {
    const k = 1 + ((cfg && cfg.allow) || 0) / 100;
    if (p.k === "joist") {
      const j = cfg && (cfg.jw || []).find(x => x.mark === String(p.mark || p.size || "").toUpperCase());
      return j && j.lb > 0 ? { lb: Math.round(j.lb * k), approx: false, src: "list" } : null;
    }
    const w = MD.lbPerFt(p.size);
    return w && p.len > 0 ? { lb: Math.round(w.lb * p.len * k), approx: w.approx, src: "shape" } : null;
  },
  noSettings: (): Settings => ({ allow: 0, base: null, jw: [] }),

  // ---------- from the reader to a record ----------
  /** The reader's result as a read's data. Every piece starts as needing review; the level comes from MS.levelFields. */
  fromRead: (out: ReadOut, geo: { w: number; h: number }): ReadData => ({
    w: r2(geo.w),
    h: r2(geo.h),
    ppf: out.scale && out.scale.ptPerFt ? r2(out.scale.ptPerFt) : 0,
    sl: out.scale && out.scale.ptPerFt ? (out.scale.agreed >= 3 ? "from " + out.scale.agreed + " dimensions" : "from " + out.scale.from) : "",
    lvl: "",
    lvlBy: "",
    tos: null,
    tosBy: "",
    grids: (out.grids || []).slice(0, MAX.grids).map(g => ({ n: g.name, a: [g.x0, g.y0, g.x1, g.y1] as Line4 })),
    pcs: (out.members || []).slice(0, MAX.pcs).map(m => ({
      id: "p" + m.n,
      k: m.kind,
      mark: m.mark || "",
      size: m.label,
      a: m.at,
      len: m.lenFt || 0,
      ends: m.ends || [[], []],
      via: m.via || "",
      st: "auto" as const,
    })),
    cols: (out.columns || []).slice(0, MAX.cols).map(c => ({ mark: c.mark, size: c.label, x: c.x, y: c.y })),
    left: (out.unplaced || []).slice(0, MAX.left).map(u => ({ label: u.label, k: u.kind, mark: u.mark || "", x: u.x || 0, y: u.y || 0, note: u.note || "" })),
    aside: (out.otherViews || []).slice(0, MAX.aside).map(v => ({ label: v.label, mark: v.mark || "", view: v.view })),
  }),
  /**
   * A read's data cut to what the server keeps (SteelBuild MD_SAN.mdlRead; the server's zod schema refuses rather than
   * cuts): strings capped, numbers rounded and held in range, unknown states and kinds back to their default, lists
   * capped, pieces without a line or id dropped, duplicate piece ids dropped.
   */
  clean: (d: Partial<Record<keyof ReadData, unknown>>): ReadData => {
    const arr = <X>(v: unknown, f: (x: unknown) => X | null, max: number): X[] =>
      (Array.isArray(v) ? v : [])
        .map(f)
        .filter((x): x is X => x != null)
        .slice(0, max);
    const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    const ids = new Set<string>();
    return {
      w: clampN(d.w, 0, 1e5),
      h: clampN(d.h, 0, 1e5),
      ppf: clampN(d.ppf, 0, 1e4),
      sl: str(d.sl, 40),
      lvl: str(d.lvl, 30),
      lvlBy: pick(d.lvlBy, ["", "read", "hand"] as const, ""),
      tos: elevOrNull(d.tos),
      tosBy: pick(d.tosBy, ["", "read", "hand"] as const, ""),
      grids: arr(
        d.grids,
        g => {
          const o = obj(g),
            a = o && line(o.a),
            n = o && str(o.n, 12);
          return a && n ? { n, a } : null;
        },
        MAX.grids
      ),
      pcs: arr(
        d.pcs,
        p => {
          const o = obj(p);
          if (!o) return null;
          const a = line(o.a),
            id = str(o.id, 40).replace(/[^A-Za-z0-9_.:-]/g, "");
          if (!a || !id || ids.has(id)) return null;
          ids.add(id);
          const by = typeof o.by === "number" && Number.isInteger(o.by) ? o.by : undefined;
          return {
            id,
            k: pick(o.k, ["beam", "joist"] as const, "beam"),
            mark: str(o.mark, FIELD_MAX.mark),
            size: str(o.size, FIELD_MAX.size),
            a,
            len: clampN(o.len, 0, 1000),
            ends: arr(o.ends, e => arr(e, s => (s == null || s === "" ? null : str(s, 40)), 6), 2),
            via: pick(o.via, ["", "leader", "hand"] as const, ""),
            st: pick(o.st, Object.keys(STATES) as PieceState[], "auto"),
            ...(by != null ? { by } : {}),
            ...(o.at ? { at: str(o.at, 30) } : {}),
            ...(o.note ? { note: str(o.note, FIELD_MAX.note) } : {}),
          };
        },
        MAX.pcs
      ),
      cols: arr(
        d.cols,
        c => {
          const o = obj(c);
          return o ? { mark: str(o.mark, 24), size: str(o.size, 30), x: clampN(o.x, -1e5, 1e5), y: clampN(o.y, -1e5, 1e5) } : null;
        },
        MAX.cols
      ),
      left: arr(
        d.left,
        u => {
          const o = obj(u);
          return o
            ? { label: str(o.label, 30), k: pick(o.k, ["beam", "joist"] as const, "beam"), mark: str(o.mark, 24), x: clampN(o.x, -1e5, 1e5), y: clampN(o.y, -1e5, 1e5), note: str(o.note, 60) }
            : null;
        },
        MAX.left
      ),
      aside: arr(
        d.aside,
        u => {
          const o = obj(u);
          return o ? { label: str(o.label, 30), mark: str(o.mark, 24), view: str(o.view, 60) } : null;
        },
        MAX.aside
      ),
    };
  },
  /** Settings cut to what the server keeps (SteelBuild MD_SAN.mdlJob). */
  cleanSettings: (d: { allow?: unknown; base?: unknown; jw?: unknown }): Settings => {
    const seen = new Set<string>();
    return {
      allow: clampN(d.allow, 0, 50),
      base: elevOrNull(d.base),
      jw: (Array.isArray(d.jw) ? d.jw : [])
        .map(x => {
          const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null,
            mark = o ? str(o.mark, 24).trim().toUpperCase() : "";
          return mark && !seen.has(mark) && seen.add(mark) ? { mark, lb: clampN(o!.lb, 0, 1e6) } : null;
        })
        .filter((x): x is { mark: string; lb: number } => !!x)
        .slice(0, MAX.jw),
    };
  },
  /** a piece's length in feet from its line on the page (page units per foot; 0 when the page has no scale), to the hundredth */
  lenOf: (a: readonly number[], ppf: number) => (ppf > 0 ? Math.round((Math.hypot(a[2] - a[0], a[3] - a[1]) / ppf) * 100) / 100 : 0),
  /** A page scale's name: a standard architectural scale (1/8" = 1'-0") when it is one, else inches to feet (1" = 7'). */
  scaleName: (ppf: number) => {
    if (!(ppf > 0)) return "";
    const ipf = ppf / 72,
      std = (
        [
          [1 / 16, "1/16"],
          [3 / 32, "3/32"],
          [1 / 8, "1/8"],
          [3 / 16, "3/16"],
          [1 / 4, "1/4"],
          [3 / 8, "3/8"],
          [1 / 2, "1/2"],
          [3 / 4, "3/4"],
          [1, "1"],
          [1.5, "1 1/2"],
          [3, "3"],
        ] as [number, string][]
      ).find(q => Math.abs(ipf / q[0] - 1) < 0.01);
    return std ? std[1] + "\" = 1'-0\"" : '1" = ' + Math.round((72 / ppf) * 100) / 100 + "'";
  },

  // ---------- the sheet's own lines (snapping) and the pieces over it ----------
  /** The lines worth snapping to, as a flat array x0 y0 x1 y1 …: those at least 10 page units long. */
  lineIndex: (segs: readonly { 0: number; 1: number; 2: number; 3: number }[] | null | undefined) => {
    const out: number[] = [];
    (segs || []).forEach(q => {
      if (Math.hypot(q[2] - q[0], q[3] - q[1]) >= 10) out.push(q[0], q[1], q[2], q[3]);
    });
    return Float64Array.from(out);
  },
  /**
   * Point p moved onto the sheet's lines: the nearest line end within tol ('end'), else the nearest point on a line
   * within tol ('on'), where a line running toward from (the piece's other end) wins over one crossing it; else p ('').
   */
  snap: (L: Float64Array, p: readonly number[], tol: number, from?: readonly number[] | null): [number, number, "" | "end" | "on"] => {
    let best: [number, number, "" | "end" | "on"] | null = null,
      bd = tol;
    for (let i = 0; i < L.length; i += 4)
      for (let j = 0; j < 4; j += 2) {
        const d = Math.hypot(L[i + j] - p[0], L[i + j + 1] - p[1]);
        if (d < bd) {
          bd = d;
          best = [L[i + j], L[i + j + 1], "end"];
        }
      }
    if (best) return best;
    bd = tol;
    const fl = from ? Math.hypot(p[0] - from[0], p[1] - from[1]) : 0;
    for (let i = 0; i < L.length; i += 4) {
      const x0 = L[i],
        y0 = L[i + 1],
        dx = L[i + 2] - x0,
        dy = L[i + 3] - y0,
        ll = dx * dx + dy * dy;
      if (!ll) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / ll)),
        qx = x0 + t * dx,
        qy = y0 + t * dy;
      let d = Math.hypot(qx - p[0], qy - p[1]);
      if (from && fl > tol && Math.abs(dx * (p[1] - from[1]) - dy * (p[0] - from[0])) / (Math.sqrt(ll) * fl) < 0.05) d *= 0.5;
      if (d < bd) {
        bd = d;
        best = [qx, qy, "on"];
      }
    }
    return best || [p[0], p[1], ""];
  },
  /** The piece whose line passes within tol of p (the nearest), or null. */
  pieceAt: <P extends { a: readonly number[] }>(pcs: P[] | null | undefined, p: readonly number[], tol: number): P | null => {
    let best: P | null = null,
      bd = tol;
    (pcs || []).forEach(q => {
      const a = q.a,
        dx = a[2] - a[0],
        dy = a[3] - a[1],
        ll = dx * dx + dy * dy,
        t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll)) : 0;
      const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    });
    return best;
  },

  // ---------- a project's pieces ----------
  /**
   * The reads of each sheet's current revision (MD.curRev), page by page, and the sheets with a drawing and no read of
   * their current revision (old: an older revision was read; pdf: the current revision has a PDF to read).
   */
  reads: (sheets: SheetLite[], recs: ReadRec[]) => {
    const out: { x: SheetLite; r: ReadRec }[] = [],
      unread: { x: SheetLite; cur: RevLite; pdf: boolean; old: number | null }[] = [];
    sheets.forEach(x => {
      const cur = MD.curRev(x);
      if (!cur) return;
      const mine = recs.filter(r => r.sid === x.id && r.rev === cur.n).sort((a, b) => a.pg - b.pg);
      if (mine.length) mine.forEach(r => out.push({ x, r }));
      else {
        const older = recs.filter(r => r.sid === x.id).sort((a, b) => b.rev - a.rev)[0];
        unread.push({ x, cur, pdf: !!cur.pdf, old: older ? older.rev : null });
      }
    });
    return { reads: out, unread };
  },
  /** Every live piece of the project's current reads, one row each, with its weight. */
  rows: (sheets: SheetLite[], recs: ReadRec[], cfg: Settings): Row[] => {
    const { reads } = MD.reads(sheets, recs),
      out: Row[] = [];
    reads.forEach(({ x, r }) =>
      r.pcs.filter(MD.live).forEach(p => {
        const w = MD.weight(p, cfg);
        out.push({
          key: r.key + "/" + p.id,
          rid: r.key,
          pid: p.id,
          sid: x.id,
          sheet: x.sheet,
          seq: x.seq,
          rev: r.rev,
          pg: r.pg,
          lvl: r.lvl,
          k: p.k,
          mark: p.mark,
          size: p.size,
          len: p.len,
          lb: w ? w.lb : null,
          approx: !!(w && w.approx),
          st: p.st,
          via: p.via,
          ends: p.ends,
          a: p.a,
        });
      })
    );
    return out;
  },
  /** Piece marks on the drawings read for a project (upper case). */
  marks: (sheets: SheetLite[], recs: ReadRec[]) => {
    const s = new Set<string>();
    MD.reads(sheets, recs).reads.forEach(({ r }) =>
      r.pcs.filter(MD.live).forEach(p => {
        if (p.mark) s.add(p.mark.toUpperCase());
        if (p.k === "joist" && p.size) s.add(p.size.toUpperCase());
      })
    );
    return s;
  },
  /** Totals: pieces, weight known, tons, needing review; by size (heaviest total first) and by sheet (in sheet order). */
  totals: (rows: Row[]) => {
    const by = new Map<string, SizeTotal>(),
      bs = new Map<number, SheetTotal>();
    let lb = 0,
      known = 0,
      review = 0;
    rows.forEach(r => {
      const k = r.size || "(no size)",
        t = by.get(k) || { size: k, n: 0, ft: 0, lb: 0, unknown: 0 };
      const s = bs.get(r.sid) || { sid: r.sid, sheet: r.sheet, n: 0, ft: 0, lb: 0, unknown: 0, review: 0 };
      t.n++;
      s.n++;
      t.ft += r.len || 0;
      s.ft += r.len || 0;
      if (r.lb != null) {
        t.lb += r.lb;
        s.lb += r.lb;
        lb += r.lb;
        known++;
      } else {
        t.unknown++;
        s.unknown++;
      }
      if (r.st === "auto") {
        review++;
        s.review++;
      }
      by.set(k, t);
      bs.set(r.sid, s);
    });
    return {
      n: rows.length,
      lb,
      tons: lb / 2000,
      known,
      review,
      sizes: [...by.values()].sort((a, b) => b.lb - a.lb || a.size.localeCompare(b.size)),
      sheets: [...bs.values()].sort((a, b) => a.sheet.localeCompare(b.sheet, undefined, { numeric: true })),
    };
  },
  /**
   * Suggestions for the mark being typed last in a pieces field (text: the whole field): marks starting with it, with
   * their sheet and grid ends; every mark on a sheet when it names one; every mark with an end on a grid line when it
   * names one. → [{ l, add: [marks] }], at most 8; marks already in the field are left out.
   */
  suggest: (sheets: SheetLite[], recs: ReadRec[], text: string) => {
    const s = String(text || ""),
      m = /([^,\s]+)$/.exec(s);
    if (!m) return [];
    const tok = m[1].toUpperCase(),
      have = new Set(
        s
          .slice(0, m.index)
          .split(/[,\s]+/)
          .map(t => t.toUpperCase())
          .filter(Boolean)
      );
    const byMark = new Map<string, { sheet: string; size: string; ends: string[] }>(),
      bySheet = new Map<string, { sheet: string; marks: Set<string> }>(),
      byGrid = new Map<string, { grid: string; marks: Set<string> }>(),
      norm = (t: string) => String(t || "").toUpperCase().replace(/[\s._-]/g, "");
    MD.reads(sheets, recs).reads.forEach(({ x, r }) =>
      r.pcs.filter(MD.live).forEach(p => {
        const k = String(p.mark || (p.k === "joist" ? p.size : "") || "").toUpperCase();
        if (!k) return;
        if (!byMark.has(k)) byMark.set(k, { sheet: x.sheet, size: p.mark ? p.size : "", ends: (p.ends || []).map(e => (e || []).join("/")).filter(Boolean) });
        const sh = bySheet.get(norm(x.sheet)) || { sheet: x.sheet, marks: new Set<string>() };
        sh.marks.add(k);
        bySheet.set(norm(x.sheet), sh);
        (p.ends || []).forEach(e =>
          (e || []).forEach(g => {
            const gk = norm(g || "");
            if (!gk || !g) return;
            const gg = byGrid.get(gk) || { grid: g, marks: new Set<string>() };
            gg.marks.add(k);
            byGrid.set(gk, gg);
          })
        );
      })
    );
    const out: { l: string; add: string[] }[] = [],
      fresh = (set: Set<string>) => [...set].filter(k => !have.has(k)).sort();
    const sh = bySheet.get(norm(tok));
    if (sh && fresh(sh.marks).length) out.push({ l: "All " + fresh(sh.marks).length + " marks on " + sh.sheet, add: fresh(sh.marks) });
    const g = byGrid.get(norm(tok));
    if (g && fresh(g.marks).length) out.push({ l: "All " + fresh(g.marks).length + " marks at grid " + g.grid, add: fresh(g.marks) });
    [...byMark.keys()]
      .filter(k => k.startsWith(tok) && k !== tok && !have.has(k))
      .sort()
      .slice(0, 8 - out.length)
      .forEach(k => {
        const o = byMark.get(k)!;
        out.push({ l: [k, o.size, o.sheet, o.ends.join("–")].filter(Boolean).join(" · "), add: [k] });
      });
    return out.slice(0, 8);
  },
  /** A pieces field's hint: marks typed that no drawing read for the project has (a typo or a sheet not read). */
  pieceHint: (sheets: SheetLite[], recs: ReadRec[], text: string) => {
    const known = MD.marks(sheets, recs);
    if (!known.size) return "";
    const typed = String(text || "")
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase())
      .filter(Boolean);
    const unknown = [...new Set(typed.filter(t => !known.has(t)))];
    if (unknown.length)
      return "Not on the drawings read for this project: " + unknown.slice(0, 8).join(", ") + (unknown.length > 8 ? " and " + (unknown.length - 8) + " more" : "") + ". Check the mark.";
    return typed.length ? "All on the drawings read for this project." : known.size + " piece marks are on the drawings read for this project. Leave blank for an aggregate quantity.";
  },
  /** The joist weights typed one per line ("T12 1950" or "T12, 1,950 lb") → [{ mark, lb }] and the lines it couldn't read. */
  parseJw: (text: string) => {
    const out: { mark: string; lb: number }[] = [],
      bad: string[] = [];
    String(text || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(l => {
        const m = /^([A-Za-z0-9-]{1,24})[\s,;:=\t]+([\d,]+(?:\.\d+)?)\s*(?:lbs?|#)?$/i.exec(l);
        if (m && +m[2].replace(/,/g, "") > 0) out.push({ mark: m[1].toUpperCase(), lb: +m[2].replace(/,/g, "") });
        else bad.push(l);
      });
    const seen = new Set<string>();
    return { jw: out.filter(x => (seen.has(x.mark) ? false : (seen.add(x.mark), true))).slice(0, MAX.jw), bad };
  },
  /** The piece list as CSV rows (header first). seqName: a sequence's name from its id. */
  csvRows: (rows: Row[], seqName: (seq: string) => string = s => s) => [
    ["Sheet", "Rev", "Page", "Sequence", "Level", "Mark", "Size", "Kind", "Length (ft)", "Length", "Weight (lb)", "Weight approximate", "Review", "Ends"],
    ...rows.map(r => [
      r.sheet,
      r.rev,
      r.pg,
      r.seq ? seqName(r.seq) : "",
      r.lvl,
      r.mark,
      r.size,
      r.k,
      r.len ? Math.round(r.len * 1000) / 1000 : "",
      MD.feet(r.len),
      r.lb == null ? "" : r.lb,
      r.approx ? "yes" : "",
      STATES[r.st],
      (r.ends || []).map(e => e.filter(Boolean).join(" ")).join(" | "),
    ]),
  ],
};

export type Row = {
  key: string;
  rid: string;
  pid: string;
  sid: number;
  sheet: string;
  seq: string;
  rev: number;
  pg: number;
  lvl: string;
  k: Kind;
  mark: string;
  size: string;
  len: number;
  lb: number | null;
  approx: boolean;
  st: PieceState;
  via: Piece["via"];
  ends: (string | null)[][];
  a: Line4;
};
export type SizeTotal = { size: string; n: number; ft: number; lb: number; unknown: number };
export type SheetTotal = { sid: number; sheet: string; n: number; ft: number; lb: number; unknown: number; review: number };

// ---------- review: changes to one read's data (pure; the caller saves with the read's version) ----------
export type Who = { by?: number; at: string };
const stamp = (w: Who) => ({ at: w.at, ...(w.by != null ? { by: w.by } : {}) });
const plural = (n: number, one: string, many?: string) => n.toLocaleString("en-US") + " " + (n === 1 ? one : many || one + "s");
export { plural };

export const REVIEW = {
  /**
   * Set the review state of pieces: ok (accept), no (reject), auto (back to needs review). An accepted, fixed or added
   * piece is not "accepted" again. → the new data and the history line, or null when nothing changes.
   */
  setState: (d: ReadData, ids: string[], st: "ok" | "no" | "auto", who: Who) => {
    const want = new Set(ids),
      hits = (p: Piece) => want.has(p.id) && p.st !== st && !(st === "ok" && MD.accepted(p));
    const hit = d.pcs.filter(hits);
    if (!hit.length) return null;
    const verb = { ok: "Accepted", no: "Rejected", auto: "Back to needs review" }[st];
    return {
      data: { ...d, pcs: d.pcs.map(p => (hits(p) ? { ...p, st, ...stamp(who) } : p)) },
      summary: verb + ": " + (hit.length === 1 ? MD.pieceName(hit[0]) : plural(hit.length, "piece")),
      n: hit.length,
    };
  },
  /** An end dragged to where it really is: its length worked out again, the piece counts as fixed (added stays added). */
  moveEnd: (d: ReadData, pid: string, a: readonly number[], who: Who) => {
    const p = d.pcs.find(q => q.id === pid);
    if (!p) return null;
    const a2 = a.map(n => Math.round(n * 100) / 100) as Line4,
      len = MD.lenOf(a2, d.ppf);
    return {
      data: { ...d, pcs: d.pcs.map(q => (q.id === pid ? { ...q, a: a2, len, st: q.st === "add" ? ("add" as const) : ("edit" as const), ...stamp(who) } : q)) },
      summary: "Moved an end: " + MD.pieceName(p) + (d.ppf ? ", " + MD.feet(p.len) + " → " + MD.feet(len) : ""),
      len,
    };
  },
  /** A piece fixed: its kind, mark, size and note; it counts as fixed (added stays added). */
  fix: (d: ReadData, pid: string, f: PieceFields, who: Who) => {
    const p = d.pcs.find(q => q.id === pid);
    if (!p) return null;
    const g = cleanFields(f),
      was = MD.pieceName(p);
    return {
      data: { ...d, pcs: d.pcs.map(q => (q.id === pid ? { ...q, k: g.k, mark: g.mark, size: g.size, note: g.note || undefined, st: q.st === "add" ? ("add" as const) : ("edit" as const), ...stamp(who) } : q)) },
      summary: "Fixed: " + was + (MD.pieceName(g) !== was ? " → " + MD.pieceName(g) : ""),
    };
  },
  /**
   * A piece drawn by hand (Draw missed piece, or Place for a label the reader couldn't place, which then leaves that
   * list). d: the page's read, or null when it has none (a scan, or a sheet nobody read): one is started with the page
   * size and the viewer's scale (ppf, 0 when none). id: a new piece id.
   */
  add: (d: ReadData | null, ctx: { a: readonly number[]; w: number; h: number; ppf: number; place?: Placing | null }, f: PieceFields, id: string, who: Who): { error: string } | { data: ReadData; summary: string; piece: Piece } => {
    if (d && d.pcs.length >= MAX.pcs) return { error: "This page already has " + MAX.pcs + " pieces, the most one page holds." };
    const base: ReadData = d || { ...MD.clean({ w: ctx.w, h: ctx.h, ppf: ctx.ppf }), sl: ctx.ppf ? "the viewer’s scale" : "" };
    const g = cleanFields(f),
      a = ctx.a.map(n => Math.round(n * 100) / 100) as Line4;
    // the page's read scale when it has one, else the viewer's
    const pc: Piece = { id, k: g.k, mark: g.mark, size: g.size, a, len: MD.lenOf(a, base.ppf || ctx.ppf), ends: [[], []], via: "hand", st: "add", ...stamp(who), ...(g.note ? { note: g.note } : {}) };
    const place = ctx.place,
      i = place ? base.left.findIndex(u => sameLabel(u, place)) : -1;
    return {
      data: { ...base, pcs: [...base.pcs, pc], ...(i >= 0 ? { left: base.left.filter((_, j) => j !== i) } : {}) },
      summary: (d ? (place ? "Placed by hand (a label the reader couldn’t place): " : "Added by hand: ") : "Started by hand (not read): ") + MD.pieceName(pc),
      piece: pc,
    };
  },
  /** A page's level and top-of-steel elevation set by hand. */
  setLevel: (d: ReadData, lvl: string, tos: number | null) => ({
    data: { ...d, lvl: lvl.trim().slice(0, 30), lvlBy: "hand" as const, tos, tosBy: "hand" as const },
    summary: "Level set: " + (lvl.trim() || "none") + ", top of steel " + (tos == null ? "not known" : elevText(tos)),
  }),
};
export type PieceFields = { k: Kind | string; mark: string; size: string; note?: string };
export type Placing = { label: string; mark: string; k: Kind; x: number; y: number };
const sameLabel = (u: Placing, q: Placing) => u.label === q.label && u.mark === q.mark && u.x === q.x && u.y === q.y;
/** A piece form's values as stored: kind, mark and size upper case without spaces in the size, capped. */
export const cleanFields = (f: PieceFields) => ({
  k: (f.k === "joist" ? "joist" : "beam") as Kind,
  mark: String(f.mark || "").trim().toUpperCase().slice(0, FIELD_MAX.mark),
  size: String(f.size || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, FIELD_MAX.size),
  note: String(f.note || "").trim().slice(0, FIELD_MAX.note),
});
/** an elevation as drawings write it: 13'-6", 0'-0", -2'-0"; '' when not known */
export const elevText = (v: number | null | undefined) => (v == null ? "" : v === 0 ? "0'-0\"" : (v < 0 ? "-" : "") + MD.feet(Math.abs(v)));
