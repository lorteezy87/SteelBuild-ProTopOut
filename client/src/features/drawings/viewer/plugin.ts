/**
 * Contract between the sheet viewer (features/drawings/viewer) and modules that add a tab to it — the framing
 * model's "Framing" tab (features/model). Ported from SteelBuild's registry `viewer` field:
 *   { id, label, count(v), panel(v), overlay(v), pdf(v), tool, grab, drag, drop, click }.
 *
 * Coordinates are PAGE UNITS: pdf.js viewport at scale 1, origin top-left, y down (what pageGeometry / PDFGEO and the
 * framing reader use). Markups are stored as fractions of the page; the viewer converts.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import type { ReactNode } from "react";
import type { PageText, Seg } from "../pdf";

export type Pt = { x: number; y: number };

/** What the viewer tells a plugin about the page on screen. */
export type ViewerCtx = {
  projectId: number;
  sheetId: number;
  sheetNumber: string;
  /** revision number shown */
  rev: number;
  /** 1-based page within the revision's PDF (one-page PDFs: always 1) */
  page: number;
  /** page size in page units (0 while loading) */
  w: number;
  h: number;
  /** the pdf.js page, null for an image-only revision (no PDF: nothing to read or snap to) */
  pdfPage: PDFPageProxy | null;
  /** the page's line work, worked out once when first asked for (empty without a PDF) */
  segs: () => Promise<Seg[]>;
  /** the page's text items with positions (empty without a PDF) */
  text: () => Promise<PageText[]>;
  /** screen pixels per page unit at the current zoom (for hit tolerances and stroke widths) */
  scale: number;
  /** this plugin's view state, kept by the viewer while it is open (selection, filters…) */
  state: Record<string, unknown>;
  setState: (patch: Record<string, unknown>) => void;
  /** zoom the view to a box in page units */
  zoomTo: (box: { x: number; y: number; w: number; h: number }) => void;
  /** short message in the viewer's toast */
  say: (msg: string) => void;
};

export type ViewerPlugin = {
  id: string;
  label: string;
  /** number shown on the side tab (e.g. pieces needing review) */
  count?: (v: ViewerCtx) => number | null;
  /** the side tab's contents */
  panel: (v: ViewerCtx) => ReactNode;
  /** SVG drawn over the page; the viewer wraps it in <g> whose user units are page units */
  overlay?: (v: ViewerCtx) => ReactNode;
  /** a two-point drawing tool the viewer offers in its toolbar while this tab is open */
  tool?: {
    label: string;
    may: (v: ViewerCtx) => boolean;
    /** snap a point (page units) as the pointer moves; `from` is the first point once placed */
    snap?: (v: ViewerCtx, p: Pt, from: Pt | null) => Pt;
    done: (v: ViewerCtx, a: Pt, b: Pt) => void;
  };
  /** a click on the drawing no markup took; return true when handled */
  click?: (v: ViewerCtx, p: Pt) => boolean;
  /** a handle under the pointer to drag (return null for none), then its drag and drop */
  grab?: (v: ViewerCtx, p: Pt) => unknown | null;
  drag?: (v: ViewerCtx, handle: unknown, p: Pt) => void;
  drop?: (v: ViewerCtx, handle: unknown, p: Pt, moved: boolean) => void;
  /** extra lines drawn into "PDF with markups" (page units), with a caption list page */
  pdf?: (v: ViewerCtx) => { lines: { a: Pt; b: Pt; color: string; width?: number }[]; labels: { at: Pt; text: string; color: string }[]; listTitle?: string; list?: string[] } | null;
};
