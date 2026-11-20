/**
 * Drawing callouts read from a sheet's PDF text (ported from SteelBuild core/callouts.js): which detail / section /
 * sheet references link where, where a referenced detail sits on its sheet, and the drawing scales printed on the
 * sheet. Pure functions: the viewer turns pdf.js text items into boxes (textBoxes) and calls these.
 *
 * A box is { s: text, x, y, w, h, rot } in page units (pdf.js viewport at scale 1, origin top-left, y down);
 * h is the font height and rot marks text that doesn't run left to right.
 */
import { normSheet } from "@shared/drawings";

export type Box = { s: string; x: number; y: number; w: number; h: number; rot: boolean };
export type Area = { x: number; y: number; w: number; h: number };
export type Span = { a: number; z: number; b: Box };
export type TextLine = { base: number; h: number; x1: number; s: string; spans: Span[] };
export type SheetIndex<S> = Map<string, { sid: S; sheet: string }>;
export type LinkKind = "callout" | "bubble" | "sheet";
export type Link<S> = Area & { sid: S; sheet: string; detail: string; kind: LinkKind; text: string; same: boolean };
export type Located = Area & { sure: boolean };
export type PrintedScale = { label: string; /** feet per page unit */ fpu: number };

/** A sheet number: 1–3 letters, an optional separator, digits, an optional decimal part and suffix letter
 * (S-501, S501, E2.01, A-301A). Purely numeric sheet numbers (shop sheets like 1001) are matched only inside an
 * explicit callout, never on their own, because numbers alone are usually dimensions. */
const SHEET = "[A-Z]{1,3}[-–.]?\\d{1,4}(?:\\.\\d{1,2})?[A-Z]?|\\d{3,5}[A-Z]?";
const DET = "[A-Z]?\\d{1,3}[A-Z]?|[A-Z]{1,2}";
const TITLE_WORDS = /\b(DETAIL|DET\b|SECTION|SECT\b|ELEVATION|ELEV\b|PLAN|VIEW|SCALE|TYP\b|TYPICAL|CONNECTION|ENLARGED|PARTIAL)/i;

const live = (boxes: Box[]) => boxes.filter(b => !b.rot && b.s && b.s.trim());

/** Join text items that sit on one line into strings, keeping which characters came from which box. */
export function lines(boxes: Box[]): TextLine[] {
  const flat = live(boxes)
    .slice()
    .sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
  const out: TextLine[] = [];
  let open: TextLine[] = [];
  for (const b of flat) {
    const base = b.y + b.h;
    if (open.length > 8) open = open.filter(l => base - l.base < 0.4 * l.h);
    const L = open.find(
      l => Math.abs(l.base - base) < 0.4 * Math.min(l.h, b.h) && b.h / l.h < 1.6 && l.h / b.h < 1.6 && b.x >= l.x1 - 0.5 * b.h && b.x - l.x1 < 2.5 * b.h
    );
    if (L) {
      const gap = b.x - L.x1;
      if (gap > 0.2 * b.h && !/\s$/.test(L.s)) L.s += " ";
      L.spans.push({ a: L.s.length, z: L.s.length + b.s.length, b });
      L.s += b.s;
      L.x1 = Math.max(L.x1, b.x + b.w);
    } else {
      const n: TextLine = { base, h: b.h, x1: b.x + b.w, s: b.s, spans: [{ a: 0, z: b.s.length, b }] };
      out.push(n);
      open.push(n);
    }
  }
  return out;
}

/** Typical width of a character relative to the font size, for proportional drawing fonts (Arial-like). */
export const cw = (ch: string) =>
  /[il.,:;'|!]/.test(ch)
    ? 0.28
    : /[\s1/()\-fjtrI]/.test(ch)
      ? 0.33
      : /[MW]/.test(ch)
        ? 0.85
        : /[mw]/.test(ch)
          ? 0.75
          : /[A-Z]/.test(ch)
            ? 0.68
            : /[0-9]/.test(ch)
              ? 0.56
              : 0.52;

/** The page area of characters a..z of a joined line (each box's width shared among its characters by typical width). */
export function areaOf(line: TextLine, a: number, z: number): Area | null {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const sp of line.spans) {
    const lo = Math.max(a, sp.a),
      hi = Math.min(z, sp.z);
    if (lo >= hi) continue;
    const ws = [...sp.b.s].map(cw),
      tot = ws.reduce((p, q) => p + q, 0) || 1;
    const at = (n: number) => sp.b.x + (sp.b.w * ws.slice(0, n - sp.a).reduce((p, q) => p + q, 0)) / tot;
    x0 = Math.min(x0, at(lo));
    x1 = Math.max(x1, at(hi));
    y0 = Math.min(y0, sp.b.y);
    y1 = Math.max(y1, sp.b.y + sp.b.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const overlaps = (r: Area, a: Area) => r.x < a.x + a.w && a.x < r.x + r.w && r.y < a.y + a.h && a.y < r.y + r.h;

/**
 * Every link on a sheet. index: normalized sheet number → { sid, sheet } for the job's register; self: this sheet's
 * number. kind is 'callout' (5/S-501, DETAIL 5 ON S-501), 'bubble' (a detail or section bubble: 5 above S-501) or
 * 'sheet' (SEE S-501, or a sheet number alone).
 */
export function find<S>(boxes: Box[], index: SheetIndex<S>, self: string): Link<S>[] {
  const me = normSheet(self || "");
  const out: Link<S>[] = [];
  const taken: Area[] = [];
  const hit = (sheetTxt: string, detail: string, area: Area | null, kind: LinkKind, text: string) => {
    const k = normSheet(sheetTxt),
      t = index.get(k);
    if (!t || !area) return;
    if (k === me && !detail) return; // the sheet's own number (title block) isn't a link
    if (taken.some(r => overlaps(r, area))) return;
    taken.push(area);
    out.push({ ...area, sid: t.sid, sheet: t.sheet, detail: detail ? detail.toUpperCase() : "", kind, text: text.trim(), same: k === me });
  };
  // 1. detail and section bubbles: an identifier with a sheet number directly under it
  const single = live(boxes);
  const DETX = new RegExp("^(?:" + DET + ")$", "i"),
    SHX = new RegExp("^(?:" + SHEET + ")$", "i");
  const sheetNos = single.filter(b => SHX.test(b.s.trim()) && index.has(normSheet(b.s)));
  for (const top of sheetNos.length ? single : []) {
    if (!DETX.test(top.s.trim())) continue;
    const cx = top.x + top.w / 2;
    const bot = sheetNos
      .filter(
        b =>
          b !== top &&
          Math.abs(b.x + b.w / 2 - cx) < Math.max(top.w, b.w) / 2 + top.h * 0.8 &&
          b.y - (top.y + top.h) > -0.3 * top.h &&
          b.y - (top.y + top.h) < 1.6 * top.h &&
          b.h / top.h > 0.45 &&
          b.h / top.h < 2.2
      )
      .sort((a, b) => a.y - b.y)[0];
    if (!bot) continue;
    const pad = top.h * 0.6,
      x0 = Math.min(top.x, bot.x) - pad,
      x1 = Math.max(top.x + top.w, bot.x + bot.w) + pad;
    hit(bot.s, top.s.trim(), { x: x0, y: top.y - pad, w: x1 - x0, h: bot.y + bot.h - top.y + 2 * pad }, "bubble", top.s.trim() + "/" + bot.s.trim());
  }
  // 2. written callouts, on joined lines
  const RX: [RegExp, LinkKind, number, number][] = [
    [
      new RegExp(
        "\\b(?:DETAIL|DET\\.?|SECTION|SECT\\.?|ELEVATION|ELEV\\.?|VIEW)\\s+(" +
          DET +
          ")\\s*(?:,|ON|@|\\/)?\\s*(?:SHEET|SHT\\.?|DWG\\.?)?\\s*(" +
          SHEET +
          ")\\b",
        "gi"
      ),
      "callout",
      1,
      2,
    ],
    [new RegExp("(?:^|[^\\w/])(" + DET + ")\\s*\\/\\s*(" + SHEET + ")\\b", "gi"), "callout", 1, 2],
    [new RegExp("\\b(?:SEE|REFER\\s+TO|REF\\.?|ON)\\s+(?:SHEET|SHT\\.?|DWG\\.?|DRAWING)?\\s*(" + SHEET + ")\\b", "gi"), "sheet", 0, 1],
  ];
  for (const L of lines(boxes)) {
    for (const [rx, kind, di, si] of RX) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(L.s))) {
        const full = m[0],
          lead = full.length - full.replace(/^[^\w]+/, "").length,
          a = m.index + lead,
          z = m.index + full.length;
        hit(m[si], di ? m[di] : "", areaOf(L, a, z), kind, full.slice(lead));
        if (m.index === rx.lastIndex) rx.lastIndex++;
      }
    }
    // 3. a lettered sheet number on its own (e.g. in a drawing list or a note)
    const lone = /(?:^|[^\w/-])([A-Z]{1,3}[-–.]?\d{1,4}(?:\.\d{1,2})?[A-Z]?)(?![\w/])/gi;
    let m: RegExpExecArray | null;
    while ((m = lone.exec(L.s))) {
      const a = m.index + m[0].length - m[1].length;
      hit(m[1], "", areaOf(L, a, a + m[1].length), "sheet", m[1]);
    }
  }
  return out;
}

/**
 * Where detail `detail` is drawn on a sheet: its title bubble or title. Scores each box whose text is exactly the
 * detail id: a sheet number (this sheet's) or a bar right under it, a title word (DETAIL, SECTION, SCALE …) beside
 * it, and a larger-than-usual font. Returns null when nothing scores well enough (never a guess).
 */
export function locate(boxes: Box[], detail: string, self: string): Located | null {
  const want = String(detail || "")
      .trim()
      .toUpperCase(),
    me = normSheet(self || "");
  if (!want) return null;
  const single = live(boxes),
    hs = single.map(b => b.h).sort((a, b) => a - b),
    med = hs[Math.floor(hs.length / 2)] || 1;
  const SHX = new RegExp("^(?:" + SHEET + ")$", "i"),
    unders = single.filter(o => SHX.test(o.s.trim()) || /^[-–—_]+$/.test(o.s.trim())),
    titles = single.filter(o => TITLE_WORDS.test(o.s));
  let best: { b: Box; sc: number } | null = null;
  for (const b of single) {
    if (b.s.trim().toUpperCase() !== want) continue;
    let sc = 0;
    const under = unders.find(
      o =>
        o !== b && Math.abs(o.x + o.w / 2 - (b.x + b.w / 2)) < Math.max(o.w, b.w) / 2 + b.h && o.y - (b.y + b.h) > -0.3 * b.h && o.y - (b.y + b.h) < 1.6 * b.h
    );
    if (under && (normSheet(under.s) === me || /^[-–—_]+$/.test(under.s.trim()))) sc += 3;
    else if (under && SHX.test(under.s.trim())) sc -= 2; // a bubble pointing elsewhere: a callout, not this title
    if (titles.some(o => o !== b && o.x > b.x && o.x - (b.x + b.w) < 14 * b.h && Math.abs(o.y - b.y) < 2.5 * b.h)) sc += 2;
    if (b.h >= med * 1.4) sc += 1;
    if (!best || sc > best.sc || (sc === best.sc && b.h > best.b.h)) best = { b, sc };
  }
  if (!best || best.sc < 2) return null;
  const p = best.b.h * 4;
  return { x: best.b.x - p, y: best.b.y - p, w: best.b.w + 2 * p, h: best.b.h + 2 * p, sure: best.sc >= 3 };
}

/**
 * Drawing scales printed on the sheet, as feet per page unit (1 unit = 1/72 inch on a full-size PDF):
 * 1/8" = 1'-0", 3/4"=1'-0", 1" = 10' (engineering); 1:50 is skipped (metric paper scales vary).
 */
export function scales(boxes: Box[]): PrintedScale[] {
  const seen = new Map<string, PrintedScale>();
  for (const L of lines(boxes)) {
    const rx = /(\d+(?:\s*\d+\/\d+|\/\d+)?|\d*\.\d+)\s*"?\s*=\s*(\d+)\s*'\s*(?:-\s*(\d+)\s*"?)?/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(L.s))) {
      const inch = m[1]
        .trim()
        .split(/\s+/)
        .reduce((a, p) => a + (p.includes("/") ? +p.split("/")[0] / +p.split("/")[1] : +p), 0);
      const ft = +m[2] + (m[3] ? +m[3] / 12 : 0);
      if (!(inch > 0) || !(ft > 0)) continue;
      const label = m[0].replace(/\s+/g, " ").trim(),
        fpu = ft / inch / 72;
      if (!seen.has(label)) seen.set(label, { label, fpu });
    }
  }
  return [...seen.values()];
}

/** Feet as a field dimension: 12'-6 1/2" (to the nearest 1/16"). */
export function feet(ft: number): string {
  if (!isFinite(ft)) return "—";
  const neg = ft < 0;
  ft = Math.abs(ft);
  let whole = Math.floor(ft),
    six = Math.round((ft - whole) * 12 * 16);
  if (six >= 192) {
    whole++;
    six = 0;
  }
  const i = Math.floor(six / 16),
    f = six % 16;
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = f ? g(f, 16) : 1;
  return (neg ? "-" : "") + whole + "'-" + i + (f ? " " + f / d + "/" + 16 / d : "") + '"';
}

/** "20'", "12'-6\"", "12' 6 1/2\"", "6\"", "12.5" (feet) → feet; NaN when it isn't a length. */
export function parseFeet(t: string): number {
  const v = String(t || "")
    .trim()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"');
  if (!v) return NaN;
  const m = /^(?:(\d+(?:\.\d+)?)\s*'?)?\s*-?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*")?$/.exec(v);
  if (!m || (!m[1] && !m[2])) return NaN;
  if (m[1] && !m[2] && !/'/.test(v) && /"/.test(v)) return NaN;
  return (m[1] ? +m[1] : 0) + (m[2] ? (+m[2] + (m[3] ? +m[3] / +m[4] : 0)) / 12 : 0);
}

/* ------------------------------------------------------------------ */
/* pdf.js text items → boxes                                           */
/* ------------------------------------------------------------------ */

type M6 = number[];
const mul = (a: M6, b: M6): M6 => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export type TextItemLike = { str: string; transform: number[]; width: number };
export const isTextItem = (i: unknown): i is TextItemLike => !!i && typeof (i as TextItemLike).str === "string" && Array.isArray((i as TextItemLike).transform);

/** pdf.js text items → callout boxes in viewport units (vp: the page's viewport at scale 1). */
export function textBoxes(items: unknown[], vp: { transform: number[]; scale: number }): Box[] {
  const out: Box[] = [];
  for (const it of items || []) {
    if (!isTextItem(it) || !it.str || !it.str.trim()) continue;
    const m = mul(vp.transform, it.transform),
      len = Math.hypot(m[0], m[1]) || 1,
      dx = m[0] / len,
      dy = m[1] / len;
    const w = (it.width || 0) * vp.scale,
      x0 = m[4],
      y0 = m[5],
      x1 = x0 + dx * w,
      y1 = y0 + dy * w;
    const pts = [
      [x0, y0],
      [x1, y1],
      [x0 + m[2], y0 + m[3]],
      [x1 + m[2], y1 + m[3]],
    ];
    const xs = pts.map(p => p[0]),
      ys = pts.map(p => p[1]);
    const X = Math.min(...xs),
      Y = Math.min(...ys);
    out.push({ s: it.str, x: X, y: Y, w: Math.max(...xs) - X, h: Math.max(...ys) - Y, rot: dx < 0.95 });
  }
  return out;
}

/** Links on a sheet, without a detail's own title bubble (5 over this sheet's number would only link to itself). */
export function sheetLinks<S>(boxes: Box[], index: SheetIndex<S>, self: string): Link<S>[] {
  if (!boxes.length) return [];
  return find(boxes, index, self).filter(l => {
    if (!l.same) return true;
    const at = locate(boxes, l.detail, self);
    return !(at && overlaps(at, l));
  });
}

/** Every occurrence of `q` (case-insensitive) in joined lines, as page areas. */
export function searchLines(ls: TextLine[], q: string): { area: Area; line: TextLine; at: number }[] {
  const want = q.trim().toLowerCase();
  const out: { area: Area; line: TextLine; at: number }[] = [];
  if (!want) return out;
  for (const L of ls) {
    const s = L.s.toLowerCase();
    let i = s.indexOf(want);
    while (i >= 0) {
      const a = areaOf(L, i, i + want.length);
      if (a) out.push({ area: a, line: L, at: i });
      i = s.indexOf(want, i + 1);
    }
  }
  return out;
}
