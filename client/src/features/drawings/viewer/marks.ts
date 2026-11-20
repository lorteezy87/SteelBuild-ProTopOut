/**
 * Markups on a sheet: tools, colours and the geometry the viewer, its SVG layer and the PDF export share.
 * Stored points are fractions of the page (0–1); everything here works in page units unless it says otherwise.
 */
import type { RouterOutputs } from "@/lib/ref";
import { feet } from "./callouts";

export type Mark = RouterOutputs["drawings"]["marks"]["marks"][number];
export type ScaleRow = RouterOutputs["drawings"]["marks"]["scales"][number];
export type MarkKind = "note" | "cloud" | "rect" | "arrow" | "pen" | "text" | "highlight" | "length" | "area" | "count";
export type P2 = [number, number];
/** "pan" selects and pans; "cal" sets the scale from a known length; "plugin:<id>" is a plugin's two-point tool. */
export type Tool = "pan" | MarkKind | "cal" | `plugin:${string}`;

export const MARK_TOOLS: { id: "pan" | MarkKind | "cal"; label: string; key: string }[] = [
  { id: "pan", label: "Pan and select", key: "V" },
  { id: "note", label: "Note pin", key: "O" },
  { id: "cloud", label: "Cloud", key: "C" },
  { id: "rect", label: "Rectangle", key: "R" },
  { id: "arrow", label: "Arrow", key: "A" },
  { id: "pen", label: "Pen", key: "P" },
  { id: "text", label: "Text", key: "T" },
  { id: "highlight", label: "Highlight", key: "H" },
  { id: "length", label: "Measure length", key: "M" },
  { id: "area", label: "Measure area", key: "G" },
  { id: "count", label: "Count", key: "N" },
  { id: "cal", label: "Set scale by known length", key: "K" },
];

export const KIND_NAMES: Record<string, string> = {
  note: "Note",
  cloud: "Cloud",
  rect: "Rectangle",
  arrow: "Arrow",
  pen: "Pen",
  text: "Text",
  highlight: "Highlight",
  length: "Length",
  area: "Area",
  count: "Count",
};

export const MARK_COLORS = [
  { hex: "#E8590C", label: "Orange" },
  { hex: "#C92A2A", label: "Red" },
  { hex: "#E0A100", label: "Yellow" },
  { hex: "#1C7ED6", label: "Blue" },
  { hex: "#2F9E44", label: "Green" },
] as const;
export const HIGHLIGHT = "#F5C400";

/** Shapes drawn from two points (their handles are those points); the rest resize by their bounding box. */
export const TWO_PT: string[] = ["cloud", "rect", "highlight", "arrow", "length"];
/** Shapes placed with one click. */
export const ONE_PT: string[] = ["note", "text"];
/** Shapes placed click by click (Enter, a double-click or the first point again finishes). */
export const POLY: string[] = ["area", "count"];

export const bbox = (pts: P2[]) => {
  const xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1]),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
export const polyArea = (pts: P2[]) =>
  Math.abs(
    pts.reduce((a, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return a + p[0] * q[1] - q[0] * p[1];
    }, 0)
  ) / 2;
export const centroid = (pts: P2[]): P2 => pts.reduce<P2>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
export const sqft = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 1 : 0 }) + " sq ft";
export const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Stored fractions → page units. */
export const toPage = (pts: [number, number][], W: number, H: number): P2[] => pts.map(q => [q[0] * W, q[1] * H]);

/** Page units → stored fractions: clamped to the page, rounded, and long pen strokes thinned to at most `max` points. */
export function toFrac(pts: P2[], W: number, H: number, max = 400): [number, number][] {
  const r = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1e5) / 1e5;
  let out = pts.filter(p => isFinite(p[0]) && isFinite(p[1])).map(([x, y]) => [r(x / W), r(y / H)] as [number, number]);
  if (out.length > max) {
    const step = Math.ceil(out.length / max),
      last = out[out.length - 1];
    out = out.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== last) out.push(last);
  }
  return out;
}

/** The squares a selected markup can be reshaped by. */
export function handles(kind: string, pts: P2[]): P2[] {
  if (ONE_PT.includes(kind)) return [];
  if (TWO_PT.includes(kind)) return pts.slice(0, 2);
  const b = bbox(pts);
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
}

/** A markup's points after dragging its body ('move') or handle i ('h') by (dx, dy). */
export function reshape(kind: string, pts: P2[], mode: "move" | "h", i: number, dx: number, dy: number): P2[] {
  if (mode === "move") return pts.map(q => [q[0] + dx, q[1] + dy]);
  if (TWO_PT.includes(kind)) return pts.map((q, j) => (j === i ? [q[0] + dx, q[1] + dy] : q));
  const b = bbox(pts);
  const c: P2[] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  const o = c[(i + 2) % 4],
    h = c[i];
  const sx = Math.abs(h[0] - o[0]) > 1e-6 ? (h[0] + dx - o[0]) / (h[0] - o[0]) : 1;
  const sy = Math.abs(h[1] - o[1]) > 1e-6 ? (h[1] + dy - o[1]) / (h[1] - o[1]) : 1;
  return pts.map(q => [o[0] + (q[0] - o[0]) * sx, o[1] + (q[1] - o[1]) * sy]);
}

/** Cloud scallops around a box: each arc's end point and radius (an SVG arc path, or sampled for the PDF). */
export function cloudArcs(x0: number, y0: number, w: number, h: number, W: number, H: number): { x: number; y: number; r: number }[] {
  const r0 = Math.max(Math.min(W, H) * 0.006, Math.min(w, h) / 6);
  const c4: P2[] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
  const out: { x: number; y: number; r: number }[] = [];
  c4.forEach((p, i) => {
    const q = c4[(i + 1) % 4],
      L = dist(p, q),
      n = Math.max(1, Math.round(L / (r0 * 2)));
    for (let j = 1; j <= n; j++) out.push({ x: p[0] + ((q[0] - p[0]) * j) / n, y: p[1] + ((q[1] - p[1]) * j) / n, r: L / n / 2 });
  });
  return out;
}

/** The cloud as a polyline (half circles bulging outwards), for the PDF export. */
export function cloudPolyline(x0: number, y0: number, w: number, h: number, W: number, H: number): P2[] {
  const r0 = Math.max(Math.min(W, H) * 0.006, Math.min(w, h) / 6);
  const box: P2[] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
  const arc: P2[] = [];
  box.forEach((p, i) => {
    const q = box[(i + 1) % 4],
      L = dist(p, q),
      n = Math.max(1, Math.round(L / (r0 * 2))),
      ux = (q[0] - p[0]) / (L || 1),
      uy = (q[1] - p[1]) / (L || 1);
    for (let j = 0; j < n; j++) {
      const s0: P2 = [p[0] + (ux * L * j) / n, p[1] + (uy * L * j) / n],
        rr = L / n / 2,
        c: P2 = [s0[0] + ux * rr, s0[1] + uy * rr];
      for (let t = 0; t <= 8; t++) {
        const th = (Math.PI * t) / 8;
        arc.push([c[0] - ux * Math.cos(th) * rr + uy * Math.sin(th) * rr, c[1] - uy * Math.cos(th) * rr - ux * Math.sin(th) * rr]);
      }
    }
  });
  return arc;
}

/** What a measuring markup reads, given feet per page unit (null: no scale set). */
export function measureText(kind: string, pts: P2[], fpu: number | null): string {
  if (kind === "length") return fpu && pts.length >= 2 ? feet(dist(pts[0], pts[pts.length - 1]) * fpu) : "set the scale";
  if (kind === "area") return fpu && pts.length >= 3 ? sqft(polyArea(pts) * fpu * fpu) : "set the scale";
  if (kind === "count") return "Count: " + pts.length;
  return "";
}

/** A markup's box in page units: its points' box, or for text the words it shows (font size scales with the sheet). */
export function markBounds(m: { kind: string; note?: string | null; points: [number, number][] }, W: number, H: number) {
  const pts = toPage(m.points, W, H);
  if (m.kind === "text" && pts.length) {
    const fs = Math.max(W, H) * 0.008,
      n = Math.max(1, (m.note || "").length);
    return { x: pts[0][0], y: pts[0][1] - fs * 1.1, w: fs * 0.55 * n, h: fs * 1.4 };
  }
  if (m.kind === "note" && pts.length) {
    const s = Math.max(W, H) * 0.006;
    return { x: pts[0][0] - s, y: pts[0][1] - s * 3, w: 2 * s, h: s * 3 };
  }
  return bbox(pts);
}

/** The topmost markup under a point (page units), within tol of its box. */
export function markAt<M extends { kind: string; note?: string | null; points: [number, number][] }>(
  marks: M[],
  p: P2,
  W: number,
  H: number,
  tol: number
): M | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    const b = markBounds(m, W, H);
    if (p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol) return m;
  }
  return null;
}

/** The server's rule, mirrored: anyone who may mark adds markups; only the author or an editor changes one. */
export const mayChange = (m: { createdBy: number | null }, me: number, canMark: boolean, canEdit: boolean) => canMark && (m.createdBy === me || canEdit);

/** Feet per page unit for a page, from its stored scale (feet across the full page width). */
export const fpuOf = (scale: { feetPerWidth: number } | null | undefined, W: number) => (scale && W ? scale.feetPerWidth / W : null);

export const hexRgb = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  return m ? ([0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]) : [0, 0, 0];
};
