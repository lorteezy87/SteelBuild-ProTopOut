/**
 * Drawing files in the browser (ported from SteelBuild core/pdf.js): pdf.js loading, page rendering, title-block
 * crops with the PDF text inside each box, title-block text parsing, one-page PDFs split with pdf-lib, and a page's
 * line work and text for the framing reader.
 *
 * Page units everywhere: pdf.js's viewport at scale 1, origin top-left, y down (what the viewer and markups use).
 */
import { authFetch } from "@/lib/authFetch";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PdfJs = typeof import("pdfjs-dist");
let _pdf: Promise<PdfJs> | null = null;
/** pdf.js, loaded on first use (it is large) with its worker. */
export function getPdf(): Promise<PdfJs> {
  if (!_pdf)
    _pdf = import("pdfjs-dist")
      .then(lib => {
        lib.GlobalWorkerOptions.workerSrc = workerUrl;
        return lib;
      })
      .catch(e => {
        _pdf = null;
        throw e;
      });
  return _pdf;
}

type PdfLib = typeof import("pdf-lib");
let _lib: Promise<PdfLib> | null = null;
export function getPdfLib(): Promise<PdfLib> {
  if (!_lib)
    _lib = import("pdf-lib").catch(e => {
      _lib = null;
      throw e;
    });
  return _lib;
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : null;
/** Phones and low-memory devices get smaller page images and fewer pages per import. */
export const LOW_MEM = !!nav && ((!!nav.deviceMemory && nav.deviceMemory <= 4) || /Mobi|Android|iPhone|iPad/i.test(nav.userAgent || ""));
export const MAX_PAGES = LOW_MEM ? 40 : 150;
export const PAGE_EDGE = LOW_MEM ? 1800 : 2400;
export const ZOOM_EDGE = LOW_MEM ? 2800 : 4000;
export const MAX_CANVAS_PX = LOW_MEM ? 8e6 : 16e6;
export const MAX_FILE_MB = LOW_MEM ? 80 : 200;
/** Largest single upload the server takes (one-page PDF or page image). */
export const UPLOAD_MAX_MB = 25;
const MAX_IMAGE_PX = LOW_MEM ? 40e6 : 100e6;
const IMAGE_EDGE = LOW_MEM ? 6000 : 10000;
/** pdf.js paces "display" renders with animation frames, which stop while the tab is hidden; "print" keeps going. */
const RENDER_INTENT = "print";

export const okDrawingFile = (f: File) =>
  ["pdf", "png", "jpg", "jpeg", "webp"].includes(String(f.name).split(".").pop()!.toLowerCase()) ||
  ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(f.type);

export class DrawingError extends Error {
  constructor(
    message: string,
    public code: "password" | "unreadable" | "empty" | "too_big_image"
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Open / render                                                       */
/* ------------------------------------------------------------------ */

export type DrawingSource = { isPdf: true; doc: PDFDocumentProxy; pages: number; bytes: ArrayBuffer } | { isPdf: false; bmp: ImageBitmap; pages: 1 };

/** Open a drawing file once; pages are rendered or cropped from it on demand. */
export async function openDrawing(file: File | Blob, name = (file as File).name ?? ""): Promise<DrawingSource> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  if (!isPdf) {
    const url = URL.createObjectURL(file);
    try {
      const dim = await new Promise<[number, number]>((res, rej) => {
        const im = new Image();
        im.onload = () => res([im.naturalWidth, im.naturalHeight]);
        im.onerror = () => rej(new DrawingError("Not a readable image", "unreadable"));
        im.src = url;
      });
      if (dim[0] * dim[1] > MAX_IMAGE_PX) throw new DrawingError("Image too large", "too_big_image");
      const k = Math.min(1, IMAGE_EDGE / Math.max(dim[0], dim[1]));
      const bmp =
        k < 1
          ? await createImageBitmap(file, { resizeWidth: Math.round(dim[0] * k), resizeHeight: Math.round(dim[1] * k), resizeQuality: "high" })
          : await createImageBitmap(file);
      return { isPdf: false, bmp, pages: 1 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const lib = await getPdf();
  const bytes = await file.arrayBuffer();
  // pdf.js takes ownership of the buffer it is given, so it gets a copy and the original stays for pdf-lib.
  const task = lib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    try {
      void task.destroy();
    } catch {
      /* ignore */
    }
    throw new DrawingError("Could not open", (e as { name?: string })?.name === "PasswordException" ? "password" : "unreadable");
  }
  if (!doc.numPages) {
    void doc.destroy();
    throw new DrawingError("No pages", "empty");
  }
  return { isPdf: true, doc, pages: doc.numPages, bytes };
}

export function closeDrawing(src: DrawingSource | null | undefined) {
  try {
    if (!src) return;
    if (src.isPdf) void src.doc.destroy();
    else src.bmp.close();
  } catch {
    /* ignore */
  }
}

export const canvasBlob = (c: HTMLCanvasElement, type = "image/jpeg", q = 0.85) =>
  new Promise<Blob>((res, rej) =>
    c.toBlob(
      b => {
        c.width = 0;
        c.height = 0;
        if (b) res(b);
        else rej(new Error("Could not encode the page"));
      },
      type,
      q
    )
  );

function fitCanvas(w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  return c;
}

/** The whole page as a JPEG, long edge ≤ maxEdge: what is stored as the revision's preview. */
export async function renderPage(src: DrawingSource, n: number, maxEdge = PAGE_EDGE): Promise<Blob> {
  if (!src.isPdf) {
    const c = fitCanvas(src.bmp.width, src.bmp.height, maxEdge);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src.bmp, 0, 0, c.width, c.height);
    return canvasBlob(c);
  }
  const page = await src.doc.getPage(n);
  try {
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, maxEdge / Math.max(vp1.width, vp1.height), Math.sqrt(MAX_CANVAS_PX / (vp1.width * vp1.height))) });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp, intent: RENDER_INTENT }).promise;
    return await canvasBlob(c);
  } finally {
    page.cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* Title blocks                                                        */
/* ------------------------------------------------------------------ */

export type Rect = { x: number; y: number; w: number; h: number };
export type TbBoxes = { sheet: Rect; title: Rect; rev: Rect };
export const TB_FIELDS = [
  { k: "sheet", label: "Sheet no.", color: "#E8590C" },
  { k: "title", label: "Sheet title", color: "#2563EB" },
  { k: "rev", label: "Revision", color: "#16A34A" },
] as const;
export type TbField = (typeof TB_FIELDS)[number]["k"];
export const TB_DEFAULT: TbBoxes = { sheet: { x: 0.88, y: 0.9, w: 0.11, h: 0.08 }, title: { x: 0.7, y: 0.8, w: 0.29, h: 0.09 }, rev: { x: 0.7, y: 0.6, w: 0.29, h: 0.18 } };

type TextItemLike = { str: string; transform: number[]; width: number };
const isText = (i: unknown): i is TextItemLike => !!i && typeof (i as TextItemLike).str === "string";

/** The title-block boxes rendered sharp (for AI reading and the row thumbnail), plus the PDF text inside each. */
export async function cropBoxes(src: DrawingSource, n: number, rs: Rect[]): Promise<{ blob: Blob; text: string }[]> {
  if (!src.isPdf) {
    const out = [];
    for (const r of rs) out.push(await cropImage(src.bmp, r));
    return out;
  }
  const page = await src.doc.getPage(n);
  try {
    let items: TextItemLike[] | null = null;
    try {
      items = ((await page.getTextContent()).items as unknown[]).filter(isText);
    } catch {
      /* no text */
    }
    const out = [];
    for (const r of rs) out.push(await cropOne(page, r, items));
    return out;
  } finally {
    page.cleanup();
  }
}

async function cropImage(bmp: ImageBitmap, r: Rect) {
  const W = bmp.width,
    H = bmp.height,
    sx = r.x * W,
    sy = r.y * H,
    sw = Math.max(1, r.w * W),
    sh = Math.max(1, r.h * H);
  const k = Math.min(2, Math.sqrt(2.5e6 / (sw * sh)), 4000 / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { blob: await canvasBlob(c), text: "" };
}

async function cropOne(page: PDFPageProxy, r: Rect, items: TextItemLike[] | null) {
  const vp1 = page.getViewport({ scale: 1 });
  const rx = r.x * vp1.width,
    ry = r.y * vp1.height,
    rw = Math.max(1, r.w * vp1.width),
    rh = Math.max(1, r.h * vp1.height);
  const scale = Math.min(8, Math.sqrt(2.5e6 / (rw * rh)), 4000 / Math.max(rw, rh));
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rw * scale));
  c.height = Math.max(1, Math.round(rh * scale));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp, transform: [1, 0, 0, 1, -rx * scale, -ry * scale], intent: RENDER_INTENT }).promise;
  return { blob: await canvasBlob(c), text: textIn(items ?? [], vp1, rx, ry, rw, rh) };
}

/** Text items inside a box, in reading order: lines top to bottom, items left to right, joined with two spaces. */
function textIn(items: TextItemLike[], vp1: { convertToViewportPoint: (x: number, y: number) => number[] }, rx: number, ry: number, rw: number, rh: number) {
  const its: { x: number; y: number; s: string }[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [x, y] = vp1.convertToViewportPoint(it.transform[4], it.transform[5]);
    if (x >= rx - 2 && x <= rx + rw + 2 && y >= ry - 2 && y <= ry + rh + 2) its.push({ x, y, s: it.str.trim() });
  }
  its.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));
  const lines: { y: number; s: string[] }[] = [];
  for (const it of its) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.y - it.y) <= 3) L.s.push(it.s);
    else lines.push({ y: it.y, s: [it.s] });
  }
  return lines
    .map(l => l.s.join("  "))
    .join("\n")
    .slice(0, 4000);
}

/** The three crops stacked into one labelled image: the row thumbnail. */
export async function stackCrops(blobs: Blob[]): Promise<Blob> {
  const bmps = await Promise.all(blobs.map(b => createImageBitmap(b)));
  const W = Math.min(1400, Math.max(...bmps.map(b => b.width))),
    bar = 30;
  const sizes = bmps.map(b => {
    const k = Math.min(1, W / b.width, 600 / b.height);
    return [Math.round(b.width * k), Math.round(b.height * k)] as const;
  });
  const c = document.createElement("canvas");
  c.width = W;
  c.height = sizes.reduce((a, [, h]) => a + h + bar, 0);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  let y = 0;
  bmps.forEach((b, i) => {
    g.fillStyle = "#1b1f23";
    g.fillRect(0, y, W, bar);
    g.fillStyle = "#fff";
    g.font = "600 16px sans-serif";
    g.fillText(`${i + 1}. ${TB_FIELDS[i].label.toUpperCase()}`, 10, y + 21);
    g.drawImage(b, 0, y + bar, sizes[i][0], sizes[i][1]);
    y += bar + sizes[i][1];
    b.close();
  });
  return canvasBlob(c);
}

/**
 * The three fields read from the PDF's own text inside each box. Scanned sheets have no text: blanks.
 * A lettered sheet number beats a bare one ("PROJ NO 2025-118  SHEET S-301" is S-301).
 */
export function parseTbText(texts: string[]): { sheet: string; title: string; rev: string; letter: string } {
  const [st, tt, rt] = texts.map(t => String(t || ""));
  const cleanSheet = st.replace(/\b(SHEET|DWG|DRAWING|DRAW\.?)\s*(NO\.?|NUMBER|NUM\.?|#)?\s*:?/gi, " ");
  const cands = [
    ...cleanSheet.matchAll(/\b(?:([A-Z]{1,4})([-.]?)|(?!(?:NO|OF|PG)\b)([A-Z]{1,2})([ \t]*[-.]?[ \t]*))(\d{1,4}(?:[.-]\d{1,3})?[A-Z]?)\b|\b(\d{3,5}[A-Z]?)\b/gi),
  ].map(x => x[6] || (x[1] || x[3]) + (x[2] || x[4] || "").replace(/[ \t]+/g, "") + x[5]);
  const sheet = cands.find(c => /^[A-Z]/i.test(c)) || cands[0] || "";
  const title = tt
    .split("\n")
    .map(l => l.replace(/^\s*(SHEET\s+|DRAWING\s+|DWG\.?\s+)?TITLE\s*:?\s*/i, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const r = tbRev(rt);
  return { sheet: sheet.toUpperCase(), title, rev: r.rev, letter: r.letter };
}

/**
 * The revision a revision box states ('' when none can be read — never a quiet 0). Lettered revisions are review
 * rounds before the numbered issue ("A IFR, B RPC, 0 IFC" is Rev 0): when any revision is numbered, letters are left
 * out; a block with letters alone counts them (A=1, B=2) and says which letter (letter: 'B' for 2).
 */
export function tbRev(rt: string): { rev: string; letter: string } {
  const revs: string[] = [];
  for (const x of String(rt || "").matchAll(/\bREV(?:ISION)?(?:\s*(?:NO\.?|#)\s*:?\s*|\s*[:.]\s*|\s+)([0-9]{1,2}|[A-Z])\b/gi)) revs.push(x[1]);
  for (const x of String(rt || "").matchAll(/^\s*([0-9]{1,2}|[A-Z])\s+(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/gim)) revs.push(x[1]);
  const lone = String(rt || "")
    .trim()
    .match(/^([0-9]{1,2}|[A-Z])$/i);
  if (!revs.length && lone) revs.push(lone[1]);
  const num = revs.filter(v => /^\d+$/.test(v));
  const nums = (num.length ? num.map(Number) : revs.map(v => v.toUpperCase().charCodeAt(0) - 64)).filter(n => n >= 0 && n < 100);
  const rev = nums.length ? String(Math.max(...nums)) : "";
  return { rev, letter: rev && !num.length ? String.fromCharCode(64 + Number(rev)) : "" };
}

/** A date in the revision box text next to the stated revision (a number, or the letter it was read from), as YYYY-MM-DD ('' when none). */
export function tbRevDate(rt: string, rev: string): string {
  if (!rev) return "";
  for (const line of String(rt || "").split("\n")) {
    const m = line.match(/^\s*([0-9]{1,2}|[A-Z])\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    const iso = line.match(/^\s*([0-9]{1,2}|[A-Z])\s+(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/);
    if (iso && iso[1].toUpperCase() === rev.toUpperCase()) return `${iso[2]}-${iso[3].padStart(2, "0")}-${iso[4].padStart(2, "0")}`;
    if (m && m[1].toUpperCase() === rev.toUpperCase()) {
      const y = m[4].length === 2 ? `20${m[4]}` : m[4];
      return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
  }
  return "";
}

/** The erection sequence a title states ("SEQ 4 ROOF FRAMING" → 4), or null. */
export function tbSeqNumber(title: string): number | null {
  const n = String(title || "").match(/\bSEQ(?:UENCE)?\.?[\s#:-]*(\d{1,2})\b/i);
  return n ? Number(n[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Splitting                                                           */
/* ------------------------------------------------------------------ */

/** Page n of a loaded pdf-lib document as its own PDF (fonts and vector content kept, so its text stays readable). */
export async function pagePdf(lib: PdfLib, srcDoc: import("pdf-lib").PDFDocument, n: number): Promise<Blob> {
  const out = await lib.PDFDocument.create();
  const [pg] = await out.copyPages(srcDoc, [n - 1]);
  out.addPage(pg);
  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/* ------------------------------------------------------------------ */
/* Line work and text for the framing reader                           */
/* ------------------------------------------------------------------ */

/** [x0, y0, x1, y1, line width, dashed (1/0), dash pattern] */
export type Seg = [number, number, number, number, number, number, string];
export type PageText = { s: string; x: number; y: number; h: number; rot: number; w: number };
type M6 = number[];

export const PDFGEO = {
  mul: (m: M6, n: M6): M6 => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  /** fnArray / argsArray of page.getOperatorList(), pdf.js's OPS table and the viewport transform at scale 1. */
  lines(fnArray: number[], argsArray: unknown[], OPS: Record<string, number>, vt: M6, max = 400000): Seg[] {
    const mul = PDFGEO.mul;
    const app = (m: M6, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    let ctm = vt.slice(),
      lw = 1,
      dash = 0,
      pat = "",
      inAnnot = false,
      cx = 0,
      cy = 0,
      sx = 0,
      sy = 0;
    const stack: [M6, number, number, string][] = [];
    const segs: Seg[] = [];
    const sc = () => Math.hypot(ctm[0], ctm[1]);
    const patOf = (arr: ArrayLike<number> | undefined) => (arr && arr.length ? Array.from(arr).map(x => +(x * sc()).toFixed(1)).join(",") : "");
    const push = (x0: number, y0: number, x1: number, y1: number) => {
      if (segs.length >= max) return;
      const p = app(ctm, x0, y0),
        q = app(ctm, x1, y1);
      segs.push([+p[0].toFixed(2), +p[1].toFixed(2), +q[0].toFixed(2), +q[1].toFixed(2), +(lw * sc()).toFixed(3), dash, pat]);
    };
    for (let k = 0; k < fnArray.length; k++) {
      const fn = fnArray[k];
      const a = argsArray[k] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (fn === OPS.beginAnnotation) {
        inAnnot = true;
        continue;
      }
      if (fn === OPS.endAnnotation) {
        inAnnot = false;
        continue;
      }
      if (inAnnot) continue;
      if (fn === OPS.save) stack.push([ctm.slice(), lw, dash, pat]);
      else if (fn === OPS.restore) {
        const t = stack.pop();
        if (t) [ctm, lw, dash, pat] = t;
      } else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push([ctm.slice(), lw, dash, pat]);
        if (a && a[0] && a[0].length === 6) ctm = mul(ctm, Array.from(a[0]));
      } else if (fn === OPS.paintFormXObjectEnd) {
        const t = stack.pop();
        if (t) [ctm, lw, dash, pat] = t;
      } else if (fn === OPS.setLineWidth) lw = a[0];
      else if (fn === OPS.setDash) {
        dash = a[0] && a[0].length ? 1 : 0;
        pat = patOf(a[0]);
      } else if (fn === OPS.setGState) {
        for (const [key, v] of a[0] || []) {
          if (key === "LW") lw = v;
          if (key === "D") {
            dash = v && v[0] && v[0].length ? 1 : 0;
            pat = patOf(v && v[0]);
          }
        }
      } else if (fn === OPS.constructPath) {
        if (Array.isArray(a[0])) {
          // pdf.js 3 and 4: [op codes], [coordinates]
          const ops = a[0] as number[],
            c = a[1] as number[];
          let j = 0;
          for (const op of ops) {
            if (op === OPS.moveTo) {
              cx = c[j++];
              cy = c[j++];
              sx = cx;
              sy = cy;
            } else if (op === OPS.lineTo) {
              const x = c[j++],
                y = c[j++];
              push(cx, cy, x, y);
              cx = x;
              cy = y;
            } else if (op === OPS.curveTo) {
              j += 4;
              cx = c[j++];
              cy = c[j++];
            } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
              j += 2;
              cx = c[j++];
              cy = c[j++];
            } else if (op === OPS.closePath) {
              if (cx !== sx || cy !== sy) push(cx, cy, sx, sy);
              cx = sx;
              cy = sy;
            } else if (op === OPS.rectangle) {
              const x = c[j++],
                y = c[j++],
                w = c[j++],
                h = c[j++];
              push(x, y, x + w, y);
              push(x + w, y, x + w, y + h);
              push(x + w, y + h, x, y + h);
              push(x, y + h, x, y);
              cx = sx = x;
              cy = sy = y;
            }
          }
        } else if (a[1] && a[1][0]) {
          // pdf.js 5: one packed list (moveTo 0, lineTo 1, curveTo 2, quadraticCurveTo 3, closePath 4)
          const d = a[1][0] as number[];
          let i = 0;
          while (i < d.length) {
            const op = d[i++];
            if (op === 0) {
              cx = d[i++];
              cy = d[i++];
              sx = cx;
              sy = cy;
            } else if (op === 1) {
              const x = d[i++],
                y = d[i++];
              push(cx, cy, x, y);
              cx = x;
              cy = y;
            } else if (op === 2) {
              i += 4;
              cx = d[i++];
              cy = d[i++];
            } else if (op === 3) {
              i += 2;
              cx = d[i++];
              cy = d[i++];
            } else if (op === 4) {
              if (cx !== sx || cy !== sy) push(cx, cy, sx, sy);
              cx = sx;
              cy = sy;
            } else break;
          }
        }
      }
    }
    return segs;
  },
  /** items of page.getTextContent(), the viewport transform at scale 1 */
  text(items: unknown[], vt: M6): PageText[] {
    return items.filter(isText).filter(i => i.str && i.str.trim()).map(i => {
      const t = PDFGEO.mul(vt, i.transform);
      return { s: i.str, x: +t[4].toFixed(2), y: +t[5].toFixed(2), h: +Math.hypot(t[2], t[3]).toFixed(2), rot: +((Math.atan2(t[1], t[0]) * 180) / Math.PI).toFixed(1), w: +i.width.toFixed(2) };
    });
  },
};

/** The line work of a pdf.js page already open (snapping drawn lines to the sheet's lines). */
export async function pageSegs(page: PDFPageProxy): Promise<Seg[]> {
  const lib = await getPdf();
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList({ annotationMode: lib.AnnotationMode.DISABLE });
  return PDFGEO.lines(ol.fnArray, ol.argsArray, lib.OPS as unknown as Record<string, number>, vp.transform);
}

/** A page's size, text and line work in page units, for the framing reader. */
export async function pageGeometry(page: PDFPageProxy): Promise<{ w: number; h: number; text: PageText[]; segs: Seg[] }> {
  const lib = await getPdf();
  const vp = page.getViewport({ scale: 1 });
  const [ol, tc] = await Promise.all([page.getOperatorList({ annotationMode: lib.AnnotationMode.DISABLE }), page.getTextContent()]);
  return {
    w: vp.width,
    h: vp.height,
    text: PDFGEO.text(tc.items, vp.transform),
    segs: PDFGEO.lines(ol.fnArray, ol.argsArray, lib.OPS as unknown as Record<string, number>, vp.transform),
  };
}

/** Open a stored drawing (a revision's one-page PDF) by URL. */
export async function openPdfUrl(url: string): Promise<PDFDocumentProxy> {
  const lib = await getPdf();
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Could not load the drawing (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  return lib.getDocument({ data, isEvalSupported: false }).promise;
}

/** Blob → base64 (no data: prefix), for tRPC uploads. */
export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
