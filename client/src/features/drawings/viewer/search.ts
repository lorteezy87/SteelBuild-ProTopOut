/**
 * "Search all": every PDF sheet in the job, page by page. Each PDF's text is read once per session (cached by URL);
 * a PDF left half-read (stopped) is not cached.
 */
import { openPdfUrl } from "../pdf";
import { lines, searchLines, textBoxes, type Area, type TextLine } from "./callouts";

/** Pages read per PDF (one-page revision PDFs are the norm; this caps odd multi-page uploads). */
export const SEARCH_PAGE_CAP = 20;
/** Matches listed at most. */
export const SEARCH_RESULT_CAP = 500;

const cache = new Map<string, TextLine[][]>();

/** The joined text lines of each page of the PDF at url, or null when it couldn't be read or the search stopped. */
export async function pdfLines(url: string, stopped: () => boolean): Promise<TextLine[][] | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  let doc: Awaited<ReturnType<typeof openPdfUrl>> | null = null;
  try {
    doc = await openPdfUrl(url);
    const pages: TextLine[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, SEARCH_PAGE_CAP); n++) {
      if (stopped()) return null;
      const P = await doc.getPage(n);
      pages.push(lines(textBoxes((await P.getTextContent()).items, P.getViewport({ scale: 1 }))));
      P.cleanup();
    }
    cache.set(url, pages);
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return pages;
  } catch {
    return null;
  } finally {
    if (doc) void doc.destroy();
  }
}

/** The text of a one-page PDF the viewer has just read, so "Search all" needn't open it again. */
export function rememberOnePage(url: string, ls: TextLine[]) {
  if (!cache.has(url)) cache.set(url, [ls]);
}

export type SearchHit = { sheetId: number; sheet: string; rev: number; page: number; area: Area; snip: string };

/** Matches of q on one PDF's pages. */
export function hitsIn(pages: TextLine[][], q: string, base: Omit<SearchHit, "page" | "area" | "snip">, room: number): SearchHit[] {
  const out: SearchHit[] = [];
  const n = q.trim().length;
  pages.forEach((ls, pi) => {
    for (const h of searchLines(ls, q)) {
      if (out.length >= room) return;
      const s = h.line.s;
      out.push({ ...base, page: pi + 1, area: h.area, snip: (h.at > 30 ? "…" : "") + s.slice(Math.max(0, h.at - 30), h.at + n + 40) });
    }
  });
  return out;
}
