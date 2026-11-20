/**
 * Revision overlay: both revisions rendered to the same size; ink only in the older one in one colour, only in this
 * one in another, and in both in grey. Aligned by the sheet edges.
 */
import { authFetch } from "@/lib/authFetch";
import { LOW_MEM, MAX_CANVAS_PX, openPdfUrl } from "../pdf";
import { hexRgb } from "./marks";

export const CMP_OLD = "#C92A2A";
export const CMP_NEW = "#1C7ED6";
export const CMP_BOTH = "#8A8F96";

export type RevFiles = { url: string | null; previewUrl: string | null };

async function fetchBlob(url: string) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Could not load the drawing (${res.status})`);
  return res.blob();
}

/** A revision's page as a bitmap, long edge about maxEdge (its PDF when it has one, else its preview image). */
export async function revisionBitmap(r: RevFiles, page: number, maxEdge: number, gone: () => boolean): Promise<ImageBitmap | null> {
  if (r.url) {
    let doc: Awaited<ReturnType<typeof openPdfUrl>> | null = null;
    try {
      doc = await openPdfUrl(r.url);
      if (gone()) return null;
      const P = await doc.getPage(Math.min(page, doc.numPages));
      const vp1 = P.getViewport({ scale: 1 });
      const s = Math.min(4, maxEdge / Math.max(vp1.width, vp1.height), Math.sqrt(MAX_CANVAS_PX / (vp1.width * vp1.height)));
      const vp = P.getViewport({ scale: s });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      await P.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
      if (gone()) return null;
      const bmp = await createImageBitmap(c);
      c.width = 0;
      return bmp;
    } catch (e) {
      if (!r.previewUrl) throw e;
    } finally {
      if (doc) void doc.destroy();
    }
  }
  if (!r.previewUrl) return null;
  const b = await fetchBlob(r.previewUrl);
  return gone() ? null : createImageBitmap(b);
}

/** The overlay of `old` on `cur` as a PNG blob, or null when the viewer moved on meanwhile. */
export async function buildOverlay(old: RevFiles, cur: RevFiles, page: number, gone: () => boolean): Promise<Blob | null> {
  const edge = LOW_MEM ? 2400 : 3200;
  const [a, b] = await Promise.all([revisionBitmap(old, page, edge, gone), revisionBitmap(cur, page, edge, gone)]);
  try {
    if (!a || !b || gone()) return null;
    const c = document.createElement("canvas");
    c.width = b.width;
    c.height = b.height;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(b, 0, 0);
    const nb = g.getImageData(0, 0, c.width, c.height);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(a, 0, 0, c.width, c.height);
    const ob = g.getImageData(0, 0, c.width, c.height);
    const O = hexRgb(CMP_OLD),
      N = hexRgb(CMP_NEW),
      K = hexRgb(CMP_BOTH),
      d = nb.data,
      o = ob.data;
    for (let i = 0; i < d.length; i += 4) {
      const dn = 255 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11),
        dold = 255 - (o[i] * 0.3 + o[i + 1] * 0.59 + o[i + 2] * 0.11),
        n1 = dn > 70,
        o1 = dold > 70;
      const col = n1 && o1 ? K : n1 ? N : o1 ? O : null;
      if (col) {
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = n1 && o1 ? 150 : 255;
      } else d[i + 3] = 0;
    }
    g.putImageData(nb, 0, 0);
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, "image/png"));
    c.width = 0;
    return gone() ? null : blob;
  } finally {
    a?.close();
    b?.close();
  }
}
