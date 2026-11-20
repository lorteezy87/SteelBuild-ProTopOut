/**
 * "PDF with markups": the sheet's original page (or its preview image on a new page) with the markups drawn in as PDF
 * vector lines and text, plus what plugins add (framing lines), then a page listing the markups. Points map through
 * pdf.js's viewport (convertToPdfPoint), so rotated and cropped pages land right.
 */
import { authFetch } from "@/lib/authFetch";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { getPdfLib } from "../pdf";
import type { ViewerPlugin } from "./plugin";
import { HIGHLIGHT, KIND_NAMES, bbox, centroid, cloudPolyline, hexRgb, measureText, toPage, type Mark, type P2 } from "./marks";

export type PluginPdf = NonNullable<ReturnType<NonNullable<ViewerPlugin["pdf"]>>>;

export type ExportInput = {
  sheetNumber: string;
  title: string;
  rev: { number: number; url: string | null; previewUrl: string | null };
  page: number;
  pages: number;
  /** page size in page units */
  W: number;
  H: number;
  /** the pdf.js page on screen; null when the viewer shows the preview image */
  pdfPage: PDFPageProxy | null;
  marks: Mark[];
  /** feet per page unit, null without a scale */
  fpu: number | null;
  who: (userId: number | null) => string;
  when: (m: Mark) => string;
  extras: { label: string; out: PluginPdf }[];
  today: string;
};

async function bytesOf(url: string) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Could not load the drawing (${res.status})`);
  return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") || "" };
}

/** Text Helvetica (WinAnsi) can write. */
const safe = (t: string) =>
  String(t)
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function exportMarkupPdf(x: ExportInput): Promise<{ blob: Blob; name: string }> {
  const lib = await getPdfLib();
  const { W, H } = x;
  const out = await lib.PDFDocument.create();
  let pg: PDFPage;
  let map: (px: number, py: number) => number[];
  if (x.rev.url && x.pdfPage) {
    const { bytes } = await bytesOf(x.rev.url);
    const src = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    [pg] = await out.copyPages(src, [Math.min(x.page, src.getPageCount()) - 1]);
    out.addPage(pg);
    const vp = x.pdfPage.getViewport({ scale: 1 });
    map = (px, py) => vp.convertToPdfPoint(px, py) as number[];
  } else if (x.rev.previewUrl) {
    const { bytes, type } = await bytesOf(x.rev.previewUrl);
    const img = /png/i.test(type) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    const kk = 2592 / Math.max(W, H),
      pw = W * kk,
      ph = H * kk;
    pg = out.addPage([pw, ph]);
    pg.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    map = (px, py) => [px * kk, ph - py * kk];
  } else throw new Error("No drawing");

  const rot = pg.getRotation().angle || 0;
  const font = await out.embedFont(lib.StandardFonts.Helvetica),
    bold = await out.embedFont(lib.StandardFonts.HelveticaBold);
  const P = (q: P2) => {
    const [a, b] = map(q[0], q[1]);
    return { x: a, y: b };
  };
  const o = P([0, 0]),
    e = P([1, 0]);
  const pu = Math.hypot(e.x - o.x, e.y - o.y); // PDF points per page unit
  const ink = (c: string): RGB => {
    const [R, G, B] = /^#?[0-9a-f]{6}$/i.test(c) ? hexRgb(c) : hexRgb("#2F9E44");
    return lib.rgb(R / 255, G / 255, B / 255);
  };
  const line = (a: P2, b: P2, col: RGB, t = 2) => pg.drawLine({ start: P(a), end: P(b), thickness: t, color: col });
  const path = (pts: P2[], col: RGB, close: boolean, t = 2) =>
    pts.forEach((p, i) => {
      if (i) line(pts[i - 1], p, col, t);
      else if (close && pts.length > 2) line(pts[pts.length - 1], p, col, t);
    });
  const text = (t: string, at: P2, size: number, col: RGB, f: PDFFont = font) =>
    pg.drawText(safe(t), { ...P(at), size, font: f, color: col, rotate: lib.degrees(rot) });
  const U = Math.max(W, H),
    LS = Math.max(10, U * pu * 0.0065),
    TS = Math.max(8, U * pu * 0.005); // label and tag sizes scale with the sheet

  for (const m of x.marks) {
    const pts = toPage(m.points, W, H),
      col = ink(m.color),
      a = pts[0],
      b = pts[pts.length - 1],
      bb = bbox(pts);
    const box: P2[] = [
      [bb.x, bb.y],
      [bb.x + bb.w, bb.y],
      [bb.x + bb.w, bb.y + bb.h],
      [bb.x, bb.y + bb.h],
    ];
    if (m.kind === "rect") path(box, col, true);
    else if (m.kind === "highlight") {
      const c = box.map(P),
        xs = c.map(q => q.x),
        ys = c.map(q => q.y);
      pg.drawRectangle({
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        color: ink(HIGHLIGHT),
        opacity: 0.3,
      });
    } else if (m.kind === "cloud") path(cloudPolyline(bb.x, bb.y, bb.w, bb.h, W, H), col, false);
    else if (m.kind === "arrow" || m.kind === "length") {
      line(a, b, col);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]),
        hl = U * 0.006;
      if (m.kind === "arrow") [-0.4, 0.4].forEach(d => line(b, [b[0] - hl * Math.cos(ang + d), b[1] - hl * Math.sin(ang + d)], col));
      else {
        [a, b].forEach(p =>
          line([p[0] + (Math.sin(ang) * hl) / 2, p[1] - (Math.cos(ang) * hl) / 2], [p[0] - (Math.sin(ang) * hl) / 2, p[1] + (Math.cos(ang) * hl) / 2], col)
        );
        text(x.fpu ? measureText("length", pts, x.fpu) : "no scale", [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - U * 0.003], LS, col, bold);
      }
    } else if (m.kind === "pen") path(pts, col, false);
    else if (m.kind === "area") {
      path(pts, col, true);
      text(x.fpu ? measureText("area", pts, x.fpu) : "no scale", centroid(pts), LS, col, bold);
    } else if (m.kind === "count")
      pts.forEach((p, i) => {
        pg.drawCircle({ ...P(p), size: U * pu * 0.004, color: col });
        text(String(i + 1), [p[0] + U * 0.005, p[1] - U * 0.002], TS, col, bold);
      });
    else if (m.kind === "text") text(m.note || "", a, U * 0.008 * pu, col, bold);
    else if (m.kind === "note") pg.drawCircle({ ...P(a), size: U * pu * 0.005, borderColor: col, borderWidth: 2, color: lib.rgb(1, 1, 1) });
    if (m.label && m.kind !== "text") text(m.label, [a[0] + U * 0.002, a[1] - U * 0.004], TS, col, bold);
  }

  // what plugins draw in: lines, labels, and a list page each
  for (const ex of x.extras) {
    for (const L of ex.out.lines) line([L.a.x, L.a.y], [L.b.x, L.b.y], ink(L.color), L.width ?? 1.5);
    for (const L of ex.out.labels) text(L.text, [L.at.x, L.at.y], TS, ink(L.color), bold);
  }
  const listPage = (title: string, note: string | null, rows: string[]) => {
    let lp = out.addPage([612, 792]),
      y = 750;
    const put = (t: string, sz: number, f: PDFFont = font) => {
      if (y < 60) {
        lp = out.addPage([612, 792]);
        y = 750;
      }
      lp.drawText(safe(t), { x: 48, y, size: sz, font: f });
      y -= sz + 6;
    };
    put(title, 14, bold);
    if (note) put(note, 9);
    y -= 6;
    for (const r of rows) {
      const words = safe(r).split(" ");
      let ln = "";
      for (const w of words) {
        if ((ln + " " + w).length > 100) {
          put(ln, 10);
          ln = "   " + w;
        } else ln = ln ? ln + " " + w : w;
      }
      if (ln) put(ln, 10);
    }
  };
  for (const ex of x.extras) if (ex.out.list?.length) listPage(ex.out.listTitle || ex.label, null, ex.out.list);

  // the markup list, on its own page
  if (x.marks.length)
    listPage(
      `Markups - ${x.sheetNumber} Rev ${x.rev.number}${x.pages > 1 ? ` page ${x.page}` : ""}`,
      `${x.title ? x.title + ". " : ""}Exported ${x.today}. Markups are notes on the drawing, not a revision of it.`,
      x.marks.map(m => {
        const pts = toPage(m.points, W, H);
        const meas = m.kind === "length" || m.kind === "area" || m.kind === "count" ? ` [${measureText(m.kind, pts, x.fpu)}]` : "";
        return `${m.label ?? "-"}  ${KIND_NAMES[m.kind] ?? "Note"}${meas}${m.note ? " - " + m.note : ""} (${x.who(m.createdBy)}, ${x.when(m)})`;
      })
    );

  const bytes = await out.save();
  const name = `${x.sheetNumber}-Rev${x.rev.number}-markups.pdf`.replace(/[^\w.-]+/g, "_");
  return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), name };
}
