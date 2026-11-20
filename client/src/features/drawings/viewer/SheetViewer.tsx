/**
 * Sheet viewer (ported from SteelBuild app/viewer.jsx): a full-screen drawing viewer for every sheet in the job's
 * register. Renders the revision's PDF sharp at any zoom (a whole-page image plus, once the view settles, a sharp
 * render of just the visible area), falls back to the stored preview image, links callouts to the sheets and details
 * they reference (callouts.ts), searches the sheet's text and every sheet's, keeps markups and measurements, overlays
 * another revision, exports "PDF with markups", and hosts plugin tabs (plugin.ts).
 *
 * The view transform (k = screen px per page unit, tx/ty = page origin on screen) lives in a ref and is written
 * straight to the DOM, so panning never re-renders anything; the zoom level is committed to state once it settles
 * (stroke widths and tags follow it).
 */
import { authFetch } from "@/lib/authFetch";
import { cn } from "@/lib/utils";
import { errMsg, fmtDateTime } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  Download,
  FileDown,
  Hand,
  Hash,
  Highlighter,
  MapPin,
  Maximize,
  MoveUpRight,
  PanelLeft,
  Pencil,
  Pentagon,
  Ruler,
  Scale,
  Search,
  Square,
  Type,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Register } from "../model";
import { LOW_MEM, MAX_CANVAS_PX, PDFGEO, openPdfUrl, pageSegs, type PageText, type Seg } from "../pdf";
import {
  feet,
  lines,
  locate,
  parseFeet,
  scales as printedScales,
  searchLines,
  sheetLinks,
  textBoxes,
  type Area,
  type Box,
  type Link,
  type PrintedScale,
} from "./callouts";
import { CMP_BOTH, CMP_NEW, CMP_OLD, buildOverlay } from "./compare";
import { exportMarkupPdf } from "./exportPdf";
import { MarkupLayer, Shape } from "./MarkupLayer";
import {
  KIND_NAMES,
  MARK_COLORS,
  MARK_TOOLS,
  ONE_PT,
  POLY,
  bbox,
  dist,
  fpuOf,
  handles,
  markAt,
  markBounds,
  mayChange,
  measureText,
  polyArea,
  reshape,
  sqft,
  toFrac,
  toPage,
  type Mark,
  type MarkKind,
  type P2,
  type Tool,
} from "./marks";
import { LinksPanel, MarksPanel, SEARCH_IDLE, SearchAllPanel, SheetsPanel, type SearchAll } from "./Panels";
import type { Pt, ViewerCtx, ViewerPlugin } from "./plugin";
import { revStateLabel, sheetIndex, sortSheets, viewRev } from "./revs";
import { SEARCH_RESULT_CAP, hitsIn, pdfLines, rememberOnePage, type SearchHit } from "./search";

export type SheetViewerProps = {
  projectId: number;
  sheets: Register["sheets"];
  sheetId: number;
  rev?: number;
  plugins?: ViewerPlugin[];
  initialTab?: string;
  onClose: () => void;
  onOpenSheet?: (sheetId: number) => void;
};

type View = { k: number; tx: number; ty: number };
type Place = { sheetId: number; rev: number; page: number; view: View };
type After = { detail?: string; box?: Area; focus?: Area; view?: View; sel?: number };
type LoadState = { status: "loading" | "ready" | "error"; kind: "pdf" | "image"; W: number; H: number; pages: number; note: string; err: string };
type Draft = { kind: Tool; p: P2[] };
type Pending = { kind: MarkKind | "cal"; p: P2[] };

const MAX_ZOOM = 40;
const BASE_PX = Math.min(LOW_MEM ? 6e6 : 12e6, MAX_CANVAS_PX * 0.75);
const NARROW = 1024;
const TOOL_ICONS: Record<string, LucideIcon> = {
  pan: Hand,
  note: MapPin,
  cloud: Cloud,
  rect: Square,
  arrow: MoveUpRight,
  pen: Pencil,
  text: Type,
  highlight: Highlighter,
  length: Ruler,
  area: Pentagon,
  count: Hash,
  cal: Scale,
};
const LOADING: LoadState = { status: "loading", kind: "pdf", W: 0, H: 0, pages: 1, note: "", err: "" };

async function loadImage(url: string, signal: AbortSignal) {
  const response = await authFetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load the drawing (${response.status})`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  const im = new Image();
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<HTMLImageElement>((res, rej) => {
      onAbort = () => {
        im.src = "";
        rej(new DOMException("Image load cancelled", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Image did not load"));
      im.src = objectUrl;
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    im.onload = im.onerror = null;
    // Once decoded the canvas can use the image without keeping its blob URL alive.
    // Errors, navigation and unmount cancellation all pass through this cleanup too.
    URL.revokeObjectURL(objectUrl);
  }
}

/* ------------------------------------------------------------------ */
/* Small chrome                                                        */
/* ------------------------------------------------------------------ */

function TB({
  label,
  onClick,
  pressed,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed == null ? undefined : pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] min-w-[30px] items-center justify-center gap-1 rounded-[3px] border px-2 text-[12px] font-medium text-[var(--ks-solid-ink)]",
        pressed ? "border-[var(--ks-accent)] bg-[var(--ks-sidebar-selected)]" : "border-[var(--ks-graphite-3)] bg-[var(--ks-graphite-2)] hover:bg-[var(--ks-graphite-3)]",
        disabled && "cursor-default opacity-40 hover:bg-[var(--ks-graphite-2)]",
        className
      )}
    >
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-[22px] w-px bg-[var(--ks-graphite-3)]" />;
const darkSelect = "h-[30px] rounded-[3px] border border-[var(--ks-graphite-3)] bg-[var(--ks-paper)] px-1.5 text-[12px] font-medium text-[var(--ks-ink)]";
const card = "absolute z-[3] rounded-[4px] border border-[var(--ks-rule)] bg-[var(--ks-paper)] text-[var(--ks-ink)] shadow-[0_6px_24px_rgba(0,0,0,0.35)]";

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

export function SheetViewer({ projectId, sheets, sheetId, rev: initialRev, plugins = [], initialTab, onClose, onOpenSheet }: SheetViewerProps) {
  const { userName, today } = useRefData();
  const utils = trpc.useUtils();

  // ---------- what is shown ----------
  const [cur, setCur] = useState<{ sheetId: number; rev: number; page: number }>({ sheetId, rev: initialRev ?? -1, page: 1 });
  const [ld, setLd] = useState<LoadState>(LOADING);
  const [links, setLinks] = useState<Link<number>[]>([]);
  const [printed, setPrinted] = useState<PrintedScale[]>([]);
  const [hasText, setHasText] = useState(false);
  const [k, setK] = useState(1);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < NARROW);
  const [side, setSide] = useState<string | null>(() => initialTab ?? (typeof window !== "undefined" && window.innerWidth < NARROW ? null : "sheets"));
  const [toolsOpen, setToolsOpen] = useState(false);
  const [back, setBack] = useState<Place[]>([]);
  const [fwd, setFwd] = useState<Place[]>([]);
  const [msg, setMsg] = useState("");
  const [flash, setFlash] = useState<Area | null>(null);
  const [hover, setHover] = useState(-1);
  // ---------- markups ----------
  const [tool, setTool] = useState<Tool>("pan");
  const [color, setColor] = useState<string>(MARK_COLORS[0].hex);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<P2 | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [label, setLabel] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ id: number; pts: P2[] } | null>(null);
  const [otherRevs, setOtherRevs] = useState(false);
  // ---------- search, overlay, export ----------
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Area[]>([]);
  const [hi, setHi] = useState(-1);
  const [all, setAll] = useState<SearchAll>(SEARCH_IDLE);
  const [cmp, setCmp] = useState<{ rev: number; url: string } | null>(null);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mods, setMods] = useState<Record<string, Record<string, unknown>>>({});

  // ---------- refs ----------
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const hiRef = useRef<HTMLCanvasElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const dimsRef = useRef({ W: 0, H: 0, kind: "pdf" as "pdf" | "image" });
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const imageLoadRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<unknown[]>([]);
  const boxesRef = useRef<Box[]>([]);
  const bsRef = useRef(1);
  const baseTask = useRef<RenderTask | null>(null);
  const hiTask = useRef<RenderTask | null>(null);
  const hiKey = useRef("");
  /** the view the sharp layer was drawn for: while only panning it slides along instead of disappearing */
  const hiView = useRef<{ k: number; tx: number; ty: number; cw: number; ch: number } | null>(null);
  const seqRef = useRef(0);
  const allSeq = useRef(0);
  const deadRef = useRef(false);
  const fitPending = useRef(true);
  const settleT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const msgT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flashT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const segsC = useRef<{ page: PDFPageProxy; p: Promise<Seg[]> } | null>(null);
  const textC = useRef<{ page: PDFPageProxy; p: Promise<PageText[]> } | null>(null);
  const ptrs = useRef(new Map<number, [number, number]>());
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean; pan: boolean } | null>(null);
  const pinchRef = useRef<{ d: number; k: number; tx: number; ty: number; cx: number; cy: number } | null>(null);
  const editRef = useRef<{ id: number; kind: string; mode: "move" | "h"; i: number; p0: P2; pts: P2[] } | null>(null);
  const editPts = useRef<P2[] | null>(null);
  const modEdit = useRef<{ plugin: ViewerPlugin; handle: unknown } | null>(null);
  const spaceRef = useRef(false);
  const cmpUrl = useRef<string | null>(null);
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;

  // ---------- derived ----------
  const sheet = sheets.find(s => s.id === cur.sheetId) ?? null;
  const r = sheet ? (sheet.revs.find(x => x.number === cur.rev) ?? null) : null;
  const jobSheets = useMemo(() => sortSheets(sheets), [sheets]);
  const index = useMemo(() => sheetIndex(sheets), [sheets]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const ready = ld.status === "ready";
  const { W, H } = ld;
  const revsWithDrawing = sheet ? sheet.revs.filter(x => x.url || x.previewUrl).sort((a, b) => b.number - a.number) : [];
  const issued = sheet?.revs.find(x => x.state === "issued") ?? null;
  const bare = issued && !issued.url && !issued.previewUrl ? issued : null;
  const current = !bare && sheet ? viewRev(sheet) : null;
  const stale = !!(r && current && r.number !== current.number);

  const marksQ = trpc.drawings.marks.useQuery({ sheetId: cur.sheetId }, { staleTime: 15_000 });
  const md = marksQ.data;
  const canMark = !!md?.canMark;
  const canEdit = !!md?.canEdit;
  const me = md?.me ?? -1;
  const allMarks = md?.marks ?? [];
  const marks = useMemo(
    () => (ready ? allMarks.filter(m => m.points.length && m.page === cur.page && (otherRevs || m.rev === cur.rev)) : []),
    [allMarks, ready, cur.page, cur.rev, otherRevs]
  );
  const scaleRow = md?.scales.find(s => s.rev === cur.rev && s.page === cur.page) ?? null;
  const fpu = fpuOf(scaleRow, W);
  const selM = sel != null ? (allMarks.find(m => m.id === sel) ?? null) : null;
  const mayEditSel = !!selM && mayChange(selM, me, canMark, canEdit);

  const saveM = trpc.drawings.saveMark.useMutation();
  const removeM = trpc.drawings.removeMark.useMutation();
  const scaleM = trpc.drawings.setScale.useMutation();
  const refreshMarks = useCallback((sid: number) => utils.drawings.marks.invalidate({ sheetId: sid }), [utils]);

  const say = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(msgT.current);
    msgT.current = setTimeout(() => setMsg(""), 6000);
  }, []);
  const flashIt = useCallback((a: Area) => {
    setFlash(a);
    clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setFlash(null), 2200);
  }, []);

  /* ---------------- view ---------------- */

  const size = (): [number, number] => {
    const b = boxRef.current;
    return b ? [b.clientWidth, b.clientHeight] : [800, 600];
  };
  const fitK = () => {
    const [cw, ch] = size(),
      { W: w, H: h } = dimsRef.current;
    return w ? Math.min(cw / w, ch / h) * 0.97 : 1;
  };

  /** A sharp render of just the visible area once the view settles, when the whole-page image would be blurry. */
  const sharpen = useCallback(async () => {
    const P = pageRef.current,
      c = hiRef.current;
    if (!P || !c || dimsRef.current.kind !== "pdf") return;
    const { k: kk, tx, ty } = viewRef.current;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    if (kk * dpr <= bsRef.current * 1.05) {
      hiKey.current = "";
      c.style.display = "none";
      return;
    }
    const [cw, ch] = size();
    if (cw * ch * dpr * dpr > MAX_CANVAS_PX) dpr = Math.sqrt(MAX_CANVAS_PX / (cw * ch));
    const key = [kk, tx, ty, cw, ch].join(",");
    if (key === hiKey.current) return;
    try {
      hiTask.current?.cancel();
    } catch {
      /* ignore */
    }
    const off = document.createElement("canvas");
    off.width = Math.round(cw * dpr);
    off.height = Math.round(ch * dpr);
    const g = off.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, off.width, off.height);
    try {
      const task = P.render({ canvasContext: g, viewport: P.getViewport({ scale: kk * dpr, offsetX: tx * dpr, offsetY: ty * dpr }) });
      hiTask.current = task;
      await task.promise;
    } catch {
      return;
    }
    const now = viewRef.current;
    if ([now.k, now.tx, now.ty, ...size()].join(",") !== key || pageRef.current !== P) return;
    c.width = off.width;
    c.height = off.height;
    c.getContext("2d")!.drawImage(off, 0, 0);
    off.width = 0;
    hiKey.current = key;
    hiView.current = { k: kk, tx, ty, cw, ch };
    c.style.transform = "";
    c.style.display = cmpUrl.current ? "none" : "block";
  }, []);

  const applyView = useCallback(
    (k0: number, tx: number, ty: number) => {
      const kk = Math.max(fitK() * 0.5, Math.min(MAX_ZOOM, k0));
      viewRef.current = { k: kk, tx, ty };
      const t = `translate(${tx}px,${ty}px) scale(${kk})`;
      if (stageRef.current) stageRef.current.style.transform = t;
      if (svgRef.current) svgRef.current.style.transform = t;
      const [cw, ch] = size(),
        hv = hiView.current,
        hc = hiRef.current;
      if (hc) {
        const slide = !!hiKey.current && !!hv && hv.k === kk && hv.cw === cw && hv.ch === ch && !cmpUrl.current;
        hc.style.display = slide ? "block" : "none";
        if (slide) hc.style.transform = `translate(${tx - hv.tx}px,${ty - hv.ty}px)`;
      }
      if (pctRef.current) pctRef.current.textContent = Math.round((kk / fitK()) * 100) + "%";
      clearTimeout(settleT.current);
      settleT.current = setTimeout(() => {
        setK(kk);
        void sharpen();
      }, 140);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sharpen]
  );
  const fit = useCallback(() => {
    const [cw, ch] = size(),
      { W: w, H: h } = dimsRef.current;
    if (!w) return;
    const kk = fitK();
    applyView(kk, (cw - w * kk) / 2, (ch - h * kk) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyView]);
  const zoomAt = (f: number, cx: number, cy: number) => {
    fitPending.current = false;
    const { k: k0, tx, ty } = viewRef.current,
      k2 = Math.max(fitK() * 0.5, Math.min(MAX_ZOOM, k0 * f)),
      rr = k2 / k0;
    applyView(k2, cx - (cx - tx) * rr, cy - (cy - ty) * rr);
  };
  const zoomTo = useCallback(
    (a: Area, room = 1.4) => {
      fitPending.current = false;
      const [cw, ch] = size();
      const kk = Math.min(MAX_ZOOM, Math.max(fitK(), Math.min(cw / (a.w * room), ch / (a.h * room))));
      applyView(kk, cw / 2 - (a.x + a.w / 2) * kk, ch / 2 - (a.y + a.h / 2) * kk);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyView]
  );
  const zoomCenter = (f: number) => {
    const [cw, ch] = size();
    zoomAt(f, cw / 2, ch / 2);
  };
  const toPagePt = (e: { clientX: number; clientY: number }): P2 => {
    const b = boxRef.current!.getBoundingClientRect(),
      { k: kk, tx, ty } = viewRef.current;
    return [(e.clientX - b.left - tx) / kk, (e.clientY - b.top - ty) / kk];
  };

  /* ---------------- loading ---------------- */

  const release = () => {
    imageLoadRef.current?.abort();
    imageLoadRef.current = null;
    try {
      baseTask.current?.cancel();
      hiTask.current?.cancel();
    } catch {
      /* ignore */
    }
    if (docRef.current) void docRef.current.destroy();
    docRef.current = null;
    pageRef.current = null;
    boxesRef.current = [];
    itemsRef.current = [];
    segsC.current = null;
    textC.current = null;
    hiKey.current = "";
    hiView.current = null;
    if (hiRef.current) hiRef.current.style.display = "none";
  };
  const dropCmp = () => {
    if (cmpUrl.current) URL.revokeObjectURL(cmpUrl.current);
    cmpUrl.current = null;
    setCmp(null);
  };

  const goDetail = useCallback(
    (detail: string, sheetNumber: string) => {
      const at = locate(boxesRef.current, detail, sheetNumber);
      if (at) {
        zoomTo(at, 3);
        flashIt(at);
        if (!at.sure) say(`Detail ${detail}: best match on ${sheetNumber}. Check it's the right one.`);
      } else say(`Detail ${detail} not found on ${sheetNumber}. Showing the whole sheet.`);
    },
    [zoomTo, flashIt, say]
  );

  /** Open a sheet (its default revision unless rev is given) and, once drawn, zoom per `after`. */
  const open = useCallback(
    async (to: { sheetId: number; rev?: number | null; page?: number }, after: After = {}): Promise<boolean> => {
      const x = sheetsRef.current.find(s => s.id === to.sheetId);
      let rv = x ? viewRev(x, to.rev) : null;
      if (x && !rv && to.rev != null && (rv = viewRev(x))) say(`Rev ${to.rev} has no drawing attached. Showing Rev ${rv.number}.`);
      if (!x || !rv) {
        const why = x ? `${x.sheetNumber} has no drawing attached yet.` : "That sheet is no longer in the register.";
        // nothing on screen yet (the first open): say it where the drawing would be
        if (!dimsRef.current.W) setLd({ ...LOADING, status: "error", err: why });
        else say(why);
        return false;
      }
      const seq = ++seqRef.current;
      const stale = () => seq !== seqRef.current || deadRef.current;
      release();
      dropCmp();
      fitPending.current = true;
      setCur({ sheetId: x.id, rev: rv.number, page: to.page ?? 1 });
      setLd(LOADING);
      setLinks([]);
      setPrinted([]);
      setHasText(false);
      setHits([]);
      setHi(-1);
      setSel(null);
      setDraft(null);
      setPending(null);
      setEdit(null);
      setFlash(null);
      setHover(-1);
      setMods(m => Object.fromEntries(Object.entries(m).map(([id, s]) => [id, { ...s, sel: null }])));
      let kind: "pdf" | "image" | null = null,
        w = 0,
        h = 0,
        pages = 1,
        pg = 1,
        note = "",
        boxes: Box[] = [];
      const c = baseRef.current;
      if (!c) return false;
      const g = c.getContext("2d")!;
      try {
        if (rv.url) {
          try {
            const doc = await openPdfUrl(rv.url);
            if (stale()) {
              void doc.destroy();
              return false;
            }
            docRef.current = doc;
            pages = doc.numPages;
            pg = Math.max(1, Math.min(to.page ?? 1, pages));
            const P = await doc.getPage(pg);
            if (stale()) return false;
            pageRef.current = P;
            const vp = P.getViewport({ scale: 1 });
            w = vp.width;
            h = vp.height;
            try {
              itemsRef.current = (await P.getTextContent()).items;
              boxes = textBoxes(itemsRef.current, vp);
            } catch {
              /* no text */
            }
            if (stale()) return false;
            const bs = Math.min(4, Math.sqrt(BASE_PX / (w * h)));
            bsRef.current = bs;
            c.width = Math.round(w * bs);
            c.height = Math.round(h * bs);
            g.fillStyle = "#fff";
            g.fillRect(0, 0, c.width, c.height);
            try {
              const task = P.render({ canvasContext: g, viewport: P.getViewport({ scale: bs }) });
              baseTask.current = task;
              await task.promise;
            } catch {
              if (stale()) return false;
            }
            kind = "pdf";
          } catch (e) {
            if (stale()) return false;
            release();
            if (!rv.previewUrl) throw e;
            note = "The PDF couldn't be opened, so this is the stored preview: no links, text search or printed scales.";
          }
        }
        if (!kind) {
          const controller = new AbortController();
          imageLoadRef.current = controller;
          let im: HTMLImageElement;
          try {
            im = await loadImage(rv.previewUrl!, controller.signal);
          } finally {
            if (imageLoadRef.current === controller) imageLoadRef.current = null;
          }
          if (stale()) return false;
          w = im.naturalWidth;
          h = im.naturalHeight;
          const s = Math.min(1, Math.sqrt(MAX_CANVAS_PX / (w * h)));
          bsRef.current = s;
          c.width = Math.round(w * s);
          c.height = Math.round(h * s);
          g.fillStyle = "#fff";
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(im, 0, 0, c.width, c.height);
          kind = "image";
          if (!note)
            note =
              "Preview image only: no PDF is stored for this revision, so callout links, text search and printed scales aren't available. Attach the PDF to get them.";
        }
      } catch {
        if (!stale())
          setLd({
            ...LOADING,
            status: "error",
            err: "This drawing couldn't be loaded. Close the viewer and open it again. If it still won't load, the file may have been removed.",
          });
        return false;
      }
      if (stale()) return false;
      boxesRef.current = boxes;
      dimsRef.current = { W: w, H: h, kind };
      setLinks(sheetLinks(boxes, indexRef.current, x.sheetNumber));
      setPrinted(boxes.length ? printedScales(boxes) : []);
      setHasText(boxes.length > 0);
      if (kind === "pdf" && pages === 1 && boxes.length && rv.url) rememberOnePage(rv.url, lines(boxes));
      setCur({ sheetId: x.id, rev: rv.number, page: pg });
      setLd({ status: "ready", kind, W: w, H: h, pages, note, err: "" });
      onOpenSheet?.(x.id);
      requestAnimationFrame(() => {
        if (stale()) return;
        if (after.view) {
          fitPending.current = false;
          applyView(after.view.k, after.view.tx, after.view.ty);
          return;
        }
        fit();
        if (after.detail) goDetail(after.detail, x.sheetNumber);
        else if (after.box) {
          zoomTo(after.box, 2.2);
          flashIt(after.box);
        } else if (after.focus) {
          const f = after.focus;
          zoomTo({ x: f.x - f.h * 6, y: f.y - f.h * 4, w: f.w + f.h * 12, h: f.h * 9 }, 1.1);
          flashIt(f);
        }
        if (after.sel != null) setSel(after.sel);
      });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, fit, applyView, zoomTo, flashIt, goDetail, onOpenSheet]
  );

  // first open, and tidy-up on close
  useEffect(() => {
    deadRef.current = false;
    void open({ sheetId, rev: initialRev });
    return () => {
      deadRef.current = true;
      seqRef.current++;
      allSeq.current++;
      clearTimeout(settleT.current);
      clearTimeout(msgT.current);
      clearTimeout(flashT.current);
      release();
      if (cmpUrl.current) URL.revokeObjectURL(cmpUrl.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refit or resharpen when the drawing area changes size; narrow layout on small screens
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (fitPending.current) fit();
      else {
        const v = viewRef.current;
        applyView(v.k, v.tx, v.ty);
      }
    });
    ro.observe(el);
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [fit, applyView]);

  /* ---------------- navigation ---------------- */

  const here = (): Place => ({ ...cur, view: { ...viewRef.current } });
  const pushBack = (from: Place) => {
    setBack(b => [...b, from].slice(-50));
    setFwd([]);
  };
  const follow = async (l: Link<number>) => {
    if (l.same || l.sid === cur.sheetId) {
      if (!l.detail || !sheet) return;
      pushBack(here());
      goDetail(l.detail, sheet.sheetNumber);
      return;
    }
    const from = here();
    if (await open({ sheetId: l.sid }, { detail: l.detail || undefined })) pushBack(from);
  };
  const goTo = (to: Place) => {
    if (to.sheetId === cur.sheetId && to.rev === cur.rev && to.page === cur.page) {
      applyView(to.view.k, to.view.tx, to.view.ty);
      return Promise.resolve(true);
    }
    return open(to, { view: to.view });
  };
  const goBack = async () => {
    if (!back.length) return;
    const to = back[back.length - 1],
      from = here();
    setBack(back.slice(0, -1));
    if (await goTo(to)) setFwd(f => [...f, from]);
  };
  const goFwd = async () => {
    if (!fwd.length) return;
    const to = fwd[fwd.length - 1],
      from = here();
    setFwd(fwd.slice(0, -1));
    if (await goTo(to)) setBack(b => [...b, from]);
  };
  const openOther = async (sid: number, rv?: number, after: After = {}) => {
    const from = here();
    if (await open({ sheetId: sid, rev: rv }, after)) pushBack(from);
  };
  const step = (d: number) => {
    const L = jobSheets.filter(s => viewRev(s)),
      i = L.findIndex(s => s.id === cur.sheetId),
      n = L[i + d];
    if (n) void openOther(n.id);
  };
  const goPage = (p: number) => void open({ sheetId: cur.sheetId, rev: cur.rev, page: p });

  /* ---------------- search ---------------- */

  const showHit = (i: number, hs = hits) => {
    const h = hs[i];
    if (!h) return;
    setHi(i);
    zoomTo({ x: h.x - h.h * 6, y: h.y - h.h * 4, w: h.w + h.h * 12, h: h.h * 9 }, 1.1);
  };
  const lastQ = useRef("");
  const searchHere = () => {
    if (hits.length && q === lastQ.current) return showHit((hi + 1) % hits.length);
    lastQ.current = q;
    if (!q.trim()) {
      setHits([]);
      setHi(-1);
      return;
    }
    const hs = searchLines(lines(boxesRef.current), q).map(h => h.area);
    setHits(hs);
    setHi(hs.length ? 0 : -1);
    if (hs.length) showHit(0, hs);
    else say(`No matches for "${q.trim()}" on this sheet.`);
  };
  const searchAll = async () => {
    const want = all.q.trim();
    if (!want) return;
    const seq = ++allSeq.current;
    const stopped = () => seq !== allSeq.current;
    const list = jobSheets.map(s => ({ s, r: viewRev(s) })).filter(o => o.r);
    const withPdf = list.filter(o => o.r!.url);
    const res: SearchHit[] = [];
    setAll({ q: all.q, running: true, done: 0, total: withPdf.length, res: [], skipped: list.length - withPdf.length, failed: 0, ran: true });
    for (const o of withPdf) {
      if (stopped()) return;
      const pages = await pdfLines(o.r!.url!, stopped);
      if (stopped()) return;
      if (pages) res.push(...hitsIn(pages, want, { sheetId: o.s.id, sheet: o.s.sheetNumber, rev: o.r!.number }, SEARCH_RESULT_CAP - res.length));
      setAll(a => ({ ...a, done: a.done + 1, failed: a.failed + (pages ? 0 : 1), res: res.slice() }));
    }
    if (!stopped()) setAll(a => ({ ...a, running: false }));
  };
  const openHit = async (h: SearchHit) => {
    const a = h.area;
    if (h.sheetId === cur.sheetId && h.rev === cur.rev && h.page === cur.page) {
      zoomTo({ x: a.x - a.h * 6, y: a.y - a.h * 4, w: a.w + a.h * 12, h: a.h * 9 }, 1.1);
      flashIt(a);
      return;
    }
    const from = here();
    if (await open({ sheetId: h.sheetId, rev: h.rev, page: h.page }, { focus: a })) pushBack(from);
  };

  /* ---------------- plugins ---------------- */

  const segsOf = (): Promise<Seg[]> => {
    const P = pageRef.current;
    if (!P || dimsRef.current.kind !== "pdf") return Promise.resolve([]);
    if (segsC.current?.page === P) return segsC.current.p;
    const p = pageSegs(P).catch(() => [] as Seg[]);
    segsC.current = { page: P, p };
    return p;
  };
  const textOf = (): Promise<PageText[]> => {
    const P = pageRef.current;
    if (!P || dimsRef.current.kind !== "pdf") return Promise.resolve([]);
    if (textC.current?.page === P) return textC.current.p;
    const vt = P.getViewport({ scale: 1 }).transform;
    const p = (itemsRef.current.length ? Promise.resolve(itemsRef.current) : P.getTextContent().then(t => t.items as unknown[]))
      .then(items => PDFGEO.text(items, vt))
      .catch(() => [] as PageText[]);
    textC.current = { page: P, p };
    return p;
  };
  const ctxFor = (p: ViewerPlugin): ViewerCtx => ({
    projectId,
    sheetId: cur.sheetId,
    sheetNumber: sheet?.sheetNumber ?? "",
    rev: cur.rev,
    page: cur.page,
    w: ready ? W : 0,
    h: ready ? H : 0,
    pdfPage: ready && ld.kind === "pdf" ? pageRef.current : null,
    segs: segsOf,
    text: textOf,
    scale: k,
    state: mods[p.id] ?? {},
    setState: patch => setMods(m => ({ ...m, [p.id]: { ...(m[p.id] ?? {}), ...patch } })),
    zoomTo: b => zoomTo(b),
    say,
  });
  const pluginOfTool = (t: Tool) => (t.startsWith("plugin:") ? (plugins.find(p => "plugin:" + p.id === t) ?? null) : null);
  const activePlugin = side ? (plugins.find(p => p.id === side) ?? null) : null;
  const P2pt = (p: P2): Pt => ({ x: p[0], y: p[1] });
  const ptP2 = (p: Pt): P2 => [p.x, p.y];

  /* ---------------- markups ---------------- */

  const setMarkData = (sid: number, fn: (ms: Mark[]) => Mark[]) =>
    utils.drawings.marks.setData({ sheetId: sid }, old => (old ? { ...old, marks: fn(old.marks) } : old));

  const saveScale = async (feetPerUnit: number, lab: string) => {
    if (!W) return;
    try {
      await scaleM.mutateAsync({ sheetId: cur.sheetId, rev: cur.rev, page: cur.page, feetPerWidth: feetPerUnit * W, label: lab.slice(0, 60) });
      await refreshMarks(cur.sheetId);
      say(`Scale set: ${lab}. Measurements on Rev ${cur.rev} use it.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const clearScale = async () => {
    try {
      await scaleM.mutateAsync({ sheetId: cur.sheetId, rev: cur.rev, page: cur.page, feetPerWidth: null });
      await refreshMarks(cur.sheetId);
      say("Scale cleared.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const startPending = (kind: MarkKind | "cal", p: P2[]) => {
    setPending({ kind, p });
    setLabel(kind === "length" || kind === "area" || kind === "count" ? (kind === "count" || fpu ? measureText(kind, p, fpu) : "") : "");
  };
  const finishPoly = () => {
    const d = draft;
    if (!d || (d.kind !== "area" && d.kind !== "count")) return;
    if (d.kind === "area" && d.p.length < 3) return say("An area needs at least three points.");
    setDraft(null);
    setCursor(null);
    startPending(d.kind, d.p);
  };

  const commitPending = async () => {
    const P = pending;
    if (!P || !sheet) return;
    const text = label.trim();
    if (P.kind === "cal") {
      const ft = parseFeet(text);
      if (!(ft > 0)) return say(`Enter the real length, e.g. 20' or 12'-6".`);
      const d = dist(P.p[0], P.p[1]);
      if (!(d > 0)) return;
      setPending(null);
      setTool("pan");
      return saveScale(ft / d, "calibrated " + feet(ft));
    }
    if ((P.kind === "text" || P.kind === "note") && !text) return say(P.kind === "text" ? "Type the text for this markup." : "Type the note for this pin.");
    const sid = cur.sheetId;
    try {
      const res = await saveM.mutateAsync({ sheetId: sid, rev: cur.rev, page: cur.page, kind: P.kind, points: toFrac(P.p, W, H), color, note: text || null });
      setPending(null);
      setLabel("");
      await refreshMarks(sid);
      setSel(res.id);
      say(`${res.label ? res.label + " " : ""}${KIND_NAMES[P.kind]} added to Rev ${cur.rev}.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveFields = async (m: Mark, patch: Partial<Pick<Mark, "points" | "color" | "note">>, verb: string) => {
    const next = { ...m, ...patch };
    setMarkData(m.sheetId, ms => ms.map(x => (x.id === m.id ? next : x)));
    try {
      await saveM.mutateAsync({
        id: m.id,
        sheetId: m.sheetId,
        rev: m.rev,
        page: m.page,
        kind: m.kind as MarkKind,
        points: next.points,
        color: next.color,
        note: next.note,
      });
      say(`${m.label ?? KIND_NAMES[m.kind] ?? "Markup"} ${verb}.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
    void refreshMarks(m.sheetId);
  };

  const delMark = async (m: Mark) => {
    if (!mayChange(m, me, canMark, canEdit)) return;
    setSel(null);
    setMarkData(m.sheetId, ms => ms.filter(x => x.id !== m.id));
    try {
      const res = await removeM.mutateAsync({ id: m.id });
      const old = res.mark;
      const name = `${old.label ?? KIND_NAMES[old.kind] ?? "Markup"}`;
      toast(`${name} removed.`, {
        action: {
          label: "Undo",
          onClick: () => {
            saveM
              .mutateAsync({
                sheetId: old.sheetId,
                rev: old.rev,
                page: old.page,
                kind: old.kind as MarkKind,
                points: old.points,
                color: old.color,
                note: old.note,
              })
              .then(() => refreshMarks(old.sheetId))
              .then(() => toast.success(`${name} restored.`))
              .catch(e => toast.error(errMsg(e)));
          },
        },
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
    void refreshMarks(m.sheetId);
  };

  const pickMark = (m: Mark) => {
    if (!sheet) return;
    if (m.rev !== cur.rev || m.page !== cur.page) {
      if (!viewRev(sheet, m.rev)) return say(`Rev ${m.rev} has no drawing to show this markup on.`);
      const from = here();
      void open({ sheetId: sheet.id, rev: m.rev, page: m.page }, { box: markBox(m), sel: m.id }).then(ok => ok && pushBack(from));
      return;
    }
    setSel(m.id);
    zoomTo(markBox(m), 3);
  };
  const markBox = (m: Mark): Area => {
    const b = bbox(toPage(m.points, dimsRef.current.W || 1, dimsRef.current.H || 1));
    const pad = Math.max(dimsRef.current.W, dimsRef.current.H) * 0.01;
    return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  };

  /* ---------------- export and overlay ---------------- */

  const downloadOriginal = async () => {
    if (!r?.url) return;
    try {
      const response = await authFetch(r.url);
      if (!response.ok) throw new Error(`Could not load the drawing (${response.status})`);
      const blob = await response.blob();
      if (deadRef.current) return;
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = r.fileName || `${sheet?.sheetNumber ?? "drawing"}.pdf`;
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const exportPdf = async () => {
    if (!sheet || !r || exporting || !ready) return;
    setExporting(true);
    try {
      const extras = plugins.flatMap(p => {
        const out = p.pdf?.(ctxFor(p));
        return out ? [{ label: p.label, out }] : [];
      });
      const { blob, name } = await exportMarkupPdf({
        sheetNumber: sheet.sheetNumber,
        title: sheet.title,
        rev: r,
        page: cur.page,
        pages: ld.pages,
        W,
        H,
        pdfPage: ld.kind === "pdf" ? pageRef.current : null,
        marks: marks.filter(m => m.rev === cur.rev),
        fpu,
        who: id => userName(id),
        when: m => fmtDateTime(m.updatedAt ?? m.createdAt),
        extras,
        today,
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const n = marks.filter(m => m.rev === cur.rev).length;
      say(`PDF downloaded with ${n} markup${n === 1 ? "" : "s"}${extras.length ? " and " + extras.map(e => e.label.toLowerCase()).join(", ") : ""}.`);
    } catch {
      say("The PDF couldn't be made: the drawing file didn't load.");
    }
    setExporting(false);
  };

  const overlay = async (n: number | null) => {
    dropCmp();
    if (n == null || !sheet || !r) return;
    const old = viewRev(sheet, n);
    if (!old) return;
    const seq = seqRef.current;
    const gone = () => deadRef.current || seq !== seqRef.current;
    setCmpBusy(true);
    try {
      const blob = await buildOverlay(old, r, cur.page, gone);
      if (!blob || gone()) return;
      const url = URL.createObjectURL(blob);
      cmpUrl.current = url;
      if (hiRef.current) hiRef.current.style.display = "none";
      setCmp({ rev: n, url });
    } catch {
      if (!gone()) say("The overlay couldn't be made: one of the drawings didn't load.");
    } finally {
      if (!deadRef.current) setCmpBusy(false);
    }
  };
  const closeOverlay = () => {
    dropCmp();
    void sharpen();
    const v = viewRef.current;
    applyView(v.k, v.tx, v.ty);
  };

  /* ---------------- pointer ---------------- */

  const linkAt = ([x, y]: P2) => links.findIndex(l => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || pending) return;
    if (e.button === 1) e.preventDefault();
    boxRef.current?.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    fitPending.current = false;
    if (ptrs.current.size === 2) {
      editRef.current = null;
      modEdit.current = null;
      const [a, b] = [...ptrs.current.values()],
        v = viewRef.current;
      pinchRef.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: v.k, tx: v.tx, ty: v.ty, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
      dragRef.current = null;
      setDraft(null);
      return;
    }
    const pan = tool === "pan" || e.button === 1 || spaceRef.current;
    const v = viewRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, moved: false, pan };
    const plainPan = pan && tool === "pan" && !spaceRef.current && e.button !== 1;
    // the selected markup: drag a handle to reshape it, or its body to move it
    if (plainPan && selM && mayEditSel && selM.rev === cur.rev && selM.page === cur.page) {
      const p = toPagePt(e),
        pts = toPage(selM.points, W, H),
        tol = 9 / v.k;
      const hi0 = handles(selM.kind, pts).findIndex(h => Math.abs(h[0] - p[0]) < tol && Math.abs(h[1] - p[1]) < tol),
        bb = markBounds(selM, W, H);
      if (hi0 >= 0 || (p[0] >= bb.x - tol && p[0] <= bb.x + bb.w + tol && p[1] >= bb.y - tol && p[1] <= bb.y + bb.h + tol)) {
        dragRef.current.pan = false;
        editRef.current = { id: selM.id, kind: selM.kind, mode: hi0 >= 0 ? "h" : "move", i: hi0, p0: p, pts };
        return;
      }
    }
    // a plugin's handle under the pointer: the drag goes to it instead of panning
    if (plainPan) {
      const p = P2pt(toPagePt(e));
      for (const pl of plugins) {
        const h = pl.grab?.(ctxFor(pl), p);
        if (h != null) {
          dragRef.current.pan = false;
          modEdit.current = { plugin: pl, handle: h };
          return;
        }
      }
    }
    const pt = pluginOfTool(tool);
    if (pt?.tool) {
      const ctx = ctxFor(pt);
      if (!pt.tool.may(ctx)) return;
      const p = toPagePt(e),
        s = pt.tool.snap ? ptP2(pt.tool.snap(ctx, P2pt(p), null)) : p;
      setDraft({ kind: tool, p: [s, s] });
      return;
    }
    if (!pan && canMark) {
      const p = toPagePt(e);
      if (POLY.includes(tool)) {
        dragRef.current = null;
        const near = (q0: P2) => dist(q0, p) * v.k < 8;
        if (draft && draft.kind === tool) {
          if (tool === "area" && draft.p.length >= 3 && near(draft.p[0])) return finishPoly();
          if (near(draft.p[draft.p.length - 1])) return;
          setDraft({ ...draft, p: [...draft.p, p] });
          return;
        }
        setDraft({ kind: tool, p: [p] });
        setCursor(p);
        return;
      }
      setDraft({ kind: tool, p: [p, p] });
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    const pin = pinchRef.current;
    if (pin && ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()],
        d = Math.hypot(a[0] - b[0], a[1] - b[1]),
        r0 = boxRef.current!.getBoundingClientRect();
      const kk = Math.max(fitK() * 0.5, Math.min(MAX_ZOOM, (pin.k * d) / pin.d)),
        f = kk / pin.k,
        cx = (a[0] + b[0]) / 2 - r0.left,
        cy = (a[1] + b[1]) / 2 - r0.top,
        ox = pin.cx - r0.left,
        oy = pin.cy - r0.top;
      applyView(kk, cx - (ox - pin.tx) * f, cy - (oy - pin.ty) * f);
      return;
    }
    const D = dragRef.current;
    if (D && Math.abs(e.clientX - D.x) + Math.abs(e.clientY - D.y) > 3) D.moved = true;
    const E = editRef.current;
    if (E && D) {
      if (!D.moved) return;
      const p = toPagePt(e);
      const pts = reshape(E.kind, E.pts, E.mode, E.i, p[0] - E.p0[0], p[1] - E.p0[1]);
      editPts.current = pts;
      setEdit({ id: E.id, pts });
      return;
    }
    const M = modEdit.current;
    if (M && D) {
      if (D.moved) M.plugin.drag?.(ctxFor(M.plugin), M.handle, P2pt(toPagePt(e)));
      return;
    }
    if (!D) {
      // hover: links under the pointer, and the rubber band of an area being drawn
      if (draft && draft.kind === "area") return setCursor(toPagePt(e));
      if (tool !== "pan" || !ready) return;
      const i = linkAt(toPagePt(e));
      if (i !== hover) setHover(i);
      return;
    }
    if (D.pan) {
      applyView(viewRef.current.k, D.tx + e.clientX - D.x, D.ty + e.clientY - D.y);
      return;
    }
    if (!draft) return;
    const p = toPagePt(e);
    if (draft.kind === "pen") {
      setDraft(d => {
        if (!d) return d;
        const last = d.p[d.p.length - 1];
        return dist(p, last) * viewRef.current.k > 2 ? { ...d, p: [...d.p, p] } : d;
      });
      return;
    }
    const pt = pluginOfTool(draft.kind);
    const snapped = pt?.tool?.snap ? ptP2(pt.tool.snap(ctxFor(pt), P2pt(p), P2pt(draft.p[0]))) : p;
    setDraft(d => (d ? { ...d, p: [d.p[0], snapped] } : d));
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchRef.current = null;
    const D = dragRef.current;
    dragRef.current = null;
    const E = editRef.current;
    if (E) {
      editRef.current = null;
      const pts = editPts.current;
      editPts.current = null;
      setEdit(null);
      const m = allMarks.find(x => x.id === E.id);
      if (pts && m && D?.moved) void saveFields(m, { points: toFrac(pts, W, H) }, E.mode === "move" ? "moved" : "reshaped");
      return;
    }
    const M = modEdit.current;
    if (M) {
      modEdit.current = null;
      M.plugin.drop?.(ctxFor(M.plugin), M.handle, P2pt(toPagePt(e)), !!D?.moved);
      return;
    }
    if (!D) return;
    if (D.pan) {
      if (D.moved || tool !== "pan") return;
      const p = toPagePt(e);
      const i = linkAt(p);
      if (i >= 0) return void follow(links[i]);
      // a markup under the click is selected; otherwise a plugin may take it
      const m = markAt(marks, p, W, H, 8 / viewRef.current.k);
      setSel(m ? m.id : null);
      if (!m) plugins.some(pl => pl.click?.(ctxFor(pl), P2pt(p)));
      return;
    }
    const d = draft;
    if (!d) return;
    const a = d.p[0],
      b = d.p[d.p.length - 1],
      tiny = dist(a, b) * viewRef.current.k < 6;
    const pt = pluginOfTool(d.kind);
    if (pt?.tool) {
      setDraft(null);
      if (!tiny) pt.tool.done(ctxFor(pt), P2pt(a), P2pt(b));
      return;
    }
    if (ONE_PT.includes(d.kind)) {
      setDraft(null);
      startPending(d.kind as MarkKind, [b]);
      return;
    }
    if (tiny && d.kind !== "pen") return setDraft(null);
    setDraft(null);
    if (d.kind === "cal") {
      setPending({ kind: "cal", p: [a, b] });
      setLabel("");
      return;
    }
    startPending(d.kind as MarkKind, d.kind === "pen" ? d.p : [a, b]);
  };

  const onDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    if (POLY.includes(tool)) return finishPoly();
    if (tool === "pan") {
      const b = boxRef.current!.getBoundingClientRect();
      zoomAt(2, e.clientX - b.left, e.clientY - b.top);
    }
  };

  // wheel (non-passive so the page doesn't scroll)
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = e => {
    if (!dimsRef.current.W) return;
    e.preventDefault();
    const b = boxRef.current!.getBoundingClientRect(),
      v = viewRef.current;
    fitPending.current = false;
    if (e.shiftKey) return applyView(v.k, v.tx - e.deltaY, v.ty);
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - b.left, e.clientY - b.top);
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  /* ---------------- keys ---------------- */

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = e => {
    const t = e.target as HTMLElement | null,
      typing = !!t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable);
    if (e.key === "Escape") {
      e.preventDefault();
      if (typing && t) {
        if (pending && t.id === "sv-label") return setPending(null);
        return t.blur();
      }
      if (pending) return setPending(null);
      if (draft) return setDraft(null);
      if (sel != null) return setSel(null);
      if (tool !== "pan") return setTool("pan");
      if (narrow && side) return setSide(null);
      return onClose();
    }
    if (typing) return;
    if (e.key === " ") {
      spaceRef.current = true;
      e.preventDefault();
      return;
    }
    const v = viewRef.current,
      stepPx = 60;
    const poly = !!draft && POLY.includes(draft.kind);
    if (poly && e.key === "Enter") {
      e.preventDefault();
      return finishPoly();
    }
    if (poly && e.key === "Backspace") {
      e.preventDefault();
      return setDraft(draft.p.length > 1 ? { ...draft, p: draft.p.slice(0, -1) } : null);
    }
    if ((e.altKey && e.key === "ArrowLeft") || (e.key === "Backspace" && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      return void goBack();
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      return void goFwd();
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.getElementById("sv-search")?.focus();
      }
      return;
    }
    const keys: Record<string, () => void> = {
      "+": () => zoomCenter(1.25),
      "=": () => zoomCenter(1.25),
      "-": () => zoomCenter(0.8),
      "0": () => fit(),
      ArrowLeft: () => applyView(v.k, v.tx + stepPx, v.ty),
      ArrowRight: () => applyView(v.k, v.tx - stepPx, v.ty),
      ArrowUp: () => applyView(v.k, v.tx, v.ty + stepPx),
      ArrowDown: () => applyView(v.k, v.tx, v.ty - stepPx),
      PageDown: () => step(1),
      PageUp: () => step(-1),
      Delete: () => {
        if (selM) void delMark(selM);
      },
    };
    const tk = MARK_TOOLS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    } else if (tk && (tk.id === "pan" || canMark)) {
      setTool(tk.id);
      setSel(null);
      setDraft(null);
    }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      spaceRef.current = false;
      const t = e.target as HTMLElement | null;
      // space pans; it must not also press whatever button has focus
      if (!t || !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  /* ---------------- render ---------------- */

  /** on a narrow screen the side panel covers the drawing: it closes once something in it was picked */
  const sideDone = () => {
    if (narrow) setSide(null);
  };
  const pickTool = (t: Tool) => {
    setTool(t);
    setSel(null);
    setDraft(null);
  };
  const v0 = viewRef.current;
  const stageT = `translate(${v0.tx}px,${v0.ty}px) scale(${v0.k})`;
  const sw = 1.6 / k;
  const showHandles = selM && mayEditSel && tool === "pan" && marks.some(m => m.id === selM.id);
  const draftShown = draft ? { ...draft, p: draft.kind === "area" && cursor ? [...draft.p, cursor] : draft.p } : null;
  const tabs: { id: string; label: string; n?: number | null }[] = [
    { id: "sheets", label: "Sheets", n: jobSheets.length },
    { id: "links", label: "Links", n: ready && hasText ? links.length : null },
    { id: "marks", label: "Markups", n: allMarks.length },
    ...plugins.map(p => ({ id: p.id, label: p.label, n: ready && p.count ? p.count(ctxFor(p)) : null })),
    { id: "find", label: "Search all" },
  ];
  const warn = stale || (!!r && !!bare);
  const pluginTool = activePlugin?.tool ?? null;
  const pluginToolOn = !!activePlugin && !!pluginTool && ready && pluginTool.may(ctxFor(activePlugin));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Drawing viewer${sheet ? " · " + sheet.sheetNumber : ""}`}
      className="fixed inset-0 z-[45] flex flex-col bg-[var(--ks-graphite)] text-[var(--ks-solid-ink)]"
    >
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ks-graphite-3)] px-2.5 py-2">
        <TB label="Back (Alt+Left)" onClick={() => void goBack()} disabled={!back.length}>
          <ArrowLeft className="size-4" />
        </TB>
        <TB label="Forward (Alt+Right)" onClick={() => void goFwd()} disabled={!fwd.length}>
          <ArrowRight className="size-4" />
        </TB>
        <TB label={side ? "Hide side panel" : "Show side panel"} onClick={() => setSide(side ? null : "sheets")} pressed={!!side}>
          <PanelLeft className="size-4" />
        </TB>
        {narrow && (
          <TB
            label={toolsOpen ? "Hide markup tools" : "Markup tools"}
            onClick={() => {
              if (toolsOpen) pickTool("pan");
              setToolsOpen(!toolsOpen);
            }}
            pressed={toolsOpen}
          >
            <Pencil className="size-4" />
          </TB>
        )}
        <div className="mx-1.5 flex min-w-0 max-w-[340px] flex-col gap-0.5">
          <span className="num truncate text-[14px] font-semibold leading-tight">
            {sheet ? sheet.sheetNumber : "—"} <span className="font-sans text-[13px] font-normal text-[var(--ks-sidebar-muted)]">{sheet?.title ?? ""}</span>
          </span>
          {r && (
            <span className={cn("text-[11px] font-medium leading-tight", warn || r.state === "superseded" ? "text-[var(--ks-sidebar-amber)]" : "text-[var(--ks-sidebar-muted)]")}>
              Rev {r.number} · {revStateLabel(r.state)}
              {ld.pages > 1 ? ` · page ${cur.page} of ${ld.pages}` : ""}
              {ready && ld.kind === "image" ? " · preview image" : ""}
            </span>
          )}
        </div>
        {revsWithDrawing.length > 1 && (
          <select aria-label="Revision" className={darkSelect} value={cur.rev} onChange={e => void openOther(cur.sheetId, +e.target.value)}>
            {revsWithDrawing.map(x => (
              <option key={x.number} value={x.number}>
                Rev {x.number} · {revStateLabel(x.state).toLowerCase()}
              </option>
            ))}
          </select>
        )}
        <TB label="Previous sheet (Page Up)" onClick={() => step(-1)}>
          <ChevronLeft className="size-4" />
        </TB>
        <TB label="Next sheet (Page Down)" onClick={() => step(1)}>
          <ChevronRight className="size-4" />
        </TB>
        {ld.pages > 1 && (
          <>
            <TB label="Previous page" onClick={() => goPage(cur.page - 1)} disabled={cur.page <= 1}>
              <ChevronUp className="size-4" />
            </TB>
            <TB label="Next page" onClick={() => goPage(cur.page + 1)} disabled={cur.page >= ld.pages}>
              <ChevronDown className="size-4" />
            </TB>
          </>
        )}
        <Sep />
        <TB label="Zoom out (-)" onClick={() => zoomCenter(0.8)}>
          <ZoomOut className="size-4" />
        </TB>
        <span ref={pctRef} className="num min-w-[44px] text-center text-[12px]" aria-live="polite" />
        <TB label="Zoom in (+)" onClick={() => zoomCenter(1.25)}>
          <ZoomIn className="size-4" />
        </TB>
        <TB label="Fit sheet (0)" onClick={() => fit()}>
          <Maximize className="size-4" />
        </TB>
        <Sep />
        <form
          role="search"
          className="flex items-center gap-1"
          onSubmit={e => {
            e.preventDefault();
            searchHere();
          }}
        >
          <Search className="size-3.5 text-[var(--ks-sidebar-muted)]" aria-hidden />
          <input
            id="sv-search"
            type="search"
            aria-label="Search this sheet's text"
            placeholder={hasText ? "Search sheet" : "No text to search"}
            disabled={!hasText}
            value={q}
            onChange={e => setQ(e.target.value)}
            className="h-[30px] w-[150px] rounded-[3px] border border-[var(--ks-graphite-3)] bg-[var(--ks-paper)] px-2 text-[12px] text-[var(--ks-ink)] outline-none disabled:opacity-60"
          />
          {hits.length > 0 && (
            <span className="num text-[11px] text-[var(--ks-sidebar-muted)]">
              {hi + 1}/{hits.length}
            </span>
          )}
        </form>
        <span className="ml-auto flex items-center gap-1.5">
          {revsWithDrawing.length > 1 && (
            <select
              aria-label="Overlay another revision"
              className={darkSelect}
              value={cmp ? cmp.rev : ""}
              disabled={cmpBusy || !ready}
              onChange={e => (e.target.value === "" ? closeOverlay() : void overlay(+e.target.value))}
            >
              <option value="">{cmpBusy ? "Overlaying…" : "Overlay: off"}</option>
              {revsWithDrawing
                .filter(x => x.number !== cur.rev)
                .map(x => (
                  <option key={x.number} value={x.number}>
                    Overlay Rev {x.number}
                  </option>
                ))}
            </select>
          )}
          {r && (
            <TB label="A PDF of this sheet with its markups drawn in, plus a list of them" onClick={() => void exportPdf()} disabled={exporting || !ready}>
              <FileDown className="size-4" />
              <span className="hidden xl:inline">{exporting ? "Making PDF…" : "PDF with markups"}</span>
            </TB>
          )}
          {r?.url && (
            <a
              href={r.url}
              onClick={e => {
                e.preventDefault();
                void downloadOriginal();
              }}
              download={r.fileName ?? undefined}
              target="_blank"
              rel="noreferrer"
              title="Download the original PDF"
              className="inline-flex h-[30px] items-center gap-1 rounded-[3px] border border-[var(--ks-graphite-3)] bg-[var(--ks-graphite-2)] px-2 text-[12px] font-medium hover:bg-[var(--ks-graphite-3)]"
            >
              <Download className="size-4" />
              <span className="hidden xl:inline">Download</span>
            </a>
          )}
          <button
            type="button"
            aria-label="Close viewer (Esc)"
            onClick={onClose}
            className="inline-flex h-[30px] items-center gap-1 rounded-[3px] border border-[var(--ks-graphite-3)] bg-[var(--ks-graphite-2)] px-3 text-[12px] font-semibold hover:bg-[var(--ks-graphite-3)]"
          >
            <X className="size-4" /> Close
          </button>
        </span>
      </div>

      {/* tool bar */}
      {(!narrow || toolsOpen) && (
        <div
          role="toolbar"
          aria-label="Markup tools"
          className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ks-graphite-3)] bg-[var(--ks-graphite-2)] px-2.5 py-1.5"
        >
          {MARK_TOOLS.filter(t => t.id === "pan" || canMark).map(t => {
            const Icon = TOOL_ICONS[t.id];
            return (
              <TB key={t.id} label={`${t.label} (${t.key})`} onClick={() => pickTool(t.id)} pressed={tool === t.id}>
                <Icon className="size-4" />
              </TB>
            );
          })}
          {activePlugin && pluginTool && (
            <TB
              label={pluginTool.label}
              onClick={() => pickTool(("plugin:" + activePlugin.id) as Tool)}
              pressed={tool === "plugin:" + activePlugin.id}
              disabled={!pluginToolOn}
            >
              <Ruler className="size-4" />
              <span>{pluginTool.label}</span>
            </TB>
          )}
          {canMark && (
            <span className="ml-1.5 flex gap-1" role="group" aria-label="Markup colour">
              {MARK_COLORS.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  aria-pressed={color === c.hex}
                  onClick={() => setColor(c.hex)}
                  className={cn("size-[22px] rounded-full border-2", color === c.hex ? "border-[var(--ks-rule-soft)]" : "border-[var(--ks-graphite-3)]")}
                  style={{ background: c.hex }}
                />
              ))}
            </span>
          )}
          {md && !canMark && <span className="text-[12px] text-[var(--ks-sidebar-muted)]">View only. Markups need drawing upload access on this job.</span>}
          <label className="ml-2.5 flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--ks-sidebar-muted)]">
            <input type="checkbox" checked={otherRevs} onChange={e => setOtherRevs(e.target.checked)} />
            Markups from other revisions
          </label>
          <span className="num ml-auto flex flex-wrap items-center gap-1 text-[12px] text-[var(--ks-sidebar-muted)]">
            {fpu ? `Scale ${scaleRow?.label ?? ""}` : "No scale set"}
            {fpu && canMark && (
              <button type="button" onClick={() => void clearScale()} className="ml-1 font-sans text-[12px] font-semibold text-[var(--ks-sidebar-orange)] underline">
                Clear
              </button>
            )}
            {!fpu &&
              canMark &&
              printed.slice(0, 3).map(sc => (
                <button
                  key={sc.label}
                  type="button"
                  onClick={() => void saveScale(sc.fpu, sc.label + " (printed)")}
                  className="ml-1.5 font-sans text-[12px] font-semibold text-[var(--ks-sidebar-orange)] underline"
                >
                  Use {sc.label}
                </button>
              ))}
          </span>
        </div>
      )}

      {/* banner */}
      {ready && (warn || ld.note || cmp) && (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center gap-2.5 px-3 py-1.5 text-[12px] font-medium leading-snug",
            warn ? "bg-[var(--ks-amber-soft)] text-[var(--ks-amber)]" : "bg-[var(--ks-graphite-3)]"
          )}
        >
          {r && bare && (
            <span>{`Rev ${bare.number} is current but has no drawing attached. Showing ${revStateLabel(r.state).toLowerCase()} Rev ${r.number}.`}</span>
          )}
          {stale && r && current && (
            <span>
              Viewing Rev {r.number} ({revStateLabel(r.state).toLowerCase()}). Current is Rev {current.number}.{" "}
              <button type="button" onClick={() => void openOther(cur.sheetId, current.number)} className="font-bold underline">
                Open Rev {current.number}
              </button>
            </span>
          )}
          {cmp && (
            <span>
              Overlay of Rev {cmp.rev} on Rev {cur.rev}: <b><span aria-hidden style={{ color: CMP_OLD }}>■</span> only in Rev {cmp.rev}</b> ·{" "}
              <b><span aria-hidden style={{ color: CMP_NEW }}>■</span> only in Rev {cur.rev}</b> · <b><span aria-hidden style={{ color: CMP_BOTH }}>■</span> both</b>. Aligned by the sheet edges.{" "}
              <button type="button" onClick={closeOverlay} className="underline">
                Turn off
              </button>
            </span>
          )}
          {ld.note && <span>{ld.note}</span>}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* side panel */}
        {side && (
          <aside
            aria-label="Viewer panel"
            className={cn(
              "z-[4] flex w-[300px] max-w-[85vw] flex-none flex-col border-r border-[var(--ks-rule)] bg-[var(--ks-paper)] text-[var(--ks-ink)]",
              narrow && "absolute inset-y-0 left-0 shadow-[0_6px_24px_rgba(0,0,0,0.35)]"
            )}
          >
            <div role="tablist" className="flex flex-wrap border-b border-[var(--ks-rule)]">
              {tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={side === t.id}
                  onClick={() => {
                    setSide(t.id);
                    if (tool.startsWith("plugin:") && tool !== "plugin:" + t.id) setTool("pan");
                  }}
                  className={cn(
                    "flex-auto border-b-2 px-2 py-2 text-[12px] font-semibold",
                    side === t.id ? "border-[var(--ks-accent)] text-[var(--ks-ink)]" : "border-transparent text-[var(--ks-ink-2)] hover:text-[var(--ks-ink)]"
                  )}
                >
                  {t.label}
                  {t.n != null ? <span className="num ml-1 font-normal">{t.n}</span> : null}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {side === "sheets" && (
                <SheetsPanel
                  sheets={jobSheets}
                  currentId={cur.sheetId}
                  onOpen={id => {
                    sideDone();
                    void openOther(id);
                  }}
                />
              )}
              {side === "links" && (
                <LinksPanel
                  loading={!ready}
                  hasText={hasText}
                  links={links}
                  sheetNumber={sheet?.sheetNumber ?? ""}
                  onFollow={l => {
                    sideDone();
                    void follow(l);
                  }}
                  onShow={l => {
                    sideDone();
                    zoomTo(l, 6);
                    flashIt(l);
                  }}
                />
              )}
              {side === "marks" && (
                <MarksPanel
                  marks={allMarks}
                  sel={sel}
                  page={cur.page}
                  pages={ld.pages}
                  who={id => userName(id)}
                  canMark={canMark}
                  onPick={m => {
                    sideDone();
                    pickMark(m);
                  }}
                />
              )}
              {side === "find" && (
                <SearchAllPanel
                  all={all}
                  onQ={qq => setAll(a => ({ ...a, q: qq }))}
                  onRun={() => void searchAll()}
                  onStop={() => {
                    allSeq.current++;
                    setAll(a => ({ ...a, running: false }));
                  }}
                  onOpen={h => {
                    sideDone();
                    void openHit(h);
                  }}
                  at={cur}
                />
              )}
              {plugins.map(p => side === p.id && ready && <Fragment key={p.id}>{p.panel(ctxFor(p))}</Fragment>)}
            </div>
          </aside>
        )}

        {/* drawing */}
        <div
          ref={boxRef}
          tabIndex={0}
          aria-label="Drawing. Drag to pan, wheel or + and - to zoom, arrow keys to move."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={onDouble}
          className="relative min-w-0 flex-1 touch-none overflow-hidden bg-[var(--ks-graphite-3)] outline-none"
          style={{ cursor: tool !== "pan" ? "crosshair" : hover >= 0 ? "pointer" : "grab" }}
        >
          <div
            ref={stageRef}
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: W || 1, height: H || 1, transform: stageT, visibility: ready ? "visible" : "hidden", boxShadow: "0 0 0 1px var(--ks-graphite-3)" }}
          >
            <canvas ref={baseRef} className="absolute inset-0 bg-[var(--ks-drawing-paper)]" style={{ width: W || 1, height: H || 1 }} />
            {cmp && <img alt="" src={cmp.url} className="absolute inset-0 bg-[var(--ks-drawing-paper)]" style={{ width: W, height: H }} />}
          </div>
          <canvas ref={hiRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-full w-full" style={{ display: "none" }} />
          <svg
            ref={svgRef}
            aria-hidden="true"
            width={W || 1}
            height={H || 1}
            viewBox={`0 0 ${W || 1} ${H || 1}`}
            className="pointer-events-none absolute left-0 top-0 origin-top-left overflow-visible"
            style={{ transform: stageT, visibility: ready ? "visible" : "hidden" }}
          >
            {ready && (
              <>
                {links.map((l, i) => (
                  <rect
                    key={"l" + i}
                    x={l.x}
                    y={l.y}
                    width={l.w}
                    height={l.h}
                    rx={2 / k}
                    fill={hover === i ? "rgba(232,89,12,0.22)" : "rgba(28,126,214,0.08)"}
                    stroke={hover === i ? "#E8590C" : "rgba(28,126,214,0.55)"}
                    strokeWidth={(hover === i ? 2 : 1) / k}
                  />
                ))}
                {hits.map((h, i) => (
                  <rect
                    key={"h" + i}
                    x={h.x}
                    y={h.y}
                    width={h.w}
                    height={h.h}
                    fill={i === hi ? "rgba(245,196,0,0.45)" : "rgba(28,126,214,0.12)"}
                    stroke={i === hi ? "#E0A100" : "none"}
                    strokeWidth={2 / k}
                  />
                ))}
                {plugins.map(p => p.overlay && <g key={"o" + p.id}>{p.overlay(ctxFor(p))}</g>)}
                <MarkupLayer marks={marks} W={W} H={H} k={k} fpu={fpu} sel={sel} edit={edit} rev={cur.rev} />
                {showHandles &&
                  handles(selM.kind, edit && edit.id === selM.id ? edit.pts : toPage(selM.points, W, H)).map((h, i) => (
                    <rect
                      key={"hd" + i}
                      x={h[0] - 5 / k}
                      y={h[1] - 5 / k}
                      width={10 / k}
                      height={10 / k}
                      fill="#ffffff"
                      stroke="#E8590C"
                      strokeWidth={1.5 / k}
                    />
                  ))}
                {draftShown && (
                  <Shape
                    kind={draftShown.kind}
                    pts={draftShown.p}
                    color={draftShown.kind.startsWith("plugin:") ? "#E8590C" : color}
                    k={k}
                    W={W}
                    H={H}
                    fpu={fpu}
                    live
                  />
                )}
                {pending && <Shape kind={pending.kind} pts={pending.p} color={color} note={label || "…"} k={k} W={W} H={H} fpu={fpu} live />}
                {flash && (
                  <rect x={flash.x} y={flash.y} width={flash.w} height={flash.h} fill="none" stroke="#E8590C" strokeWidth={4 / k} className="animate-pulse" />
                )}
                {/* a faint frame keeps the sheet edge visible under dark overlays */}
                <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth={sw / 2} />
              </>
            )}
          </svg>
          {ld.status === "loading" && (
            <div role="status" className="absolute inset-0 grid place-items-center text-[13px] font-medium text-[var(--ks-sidebar-muted)]">
              <span className="animate-pulse">Loading {sheet?.sheetNumber ?? "drawing"}…</span>
            </div>
          )}
          {ld.status === "error" && (
            <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] font-medium leading-relaxed">
              {ld.err}
            </div>
          )}
          {hover >= 0 && links[hover] && (
            <div className="pointer-events-none absolute bottom-2.5 left-2.5 border border-[var(--ks-graphite-3)] bg-[var(--ks-graphite)] px-2.5 py-1 text-[12px] font-medium">
              Go to {links[hover].detail ? `detail ${links[hover].detail} on ` : ""}
              {links[hover].sheet}
              {links[hover].same ? " (this sheet)" : ""}
            </div>
          )}
        </div>

        {/* click-by-click hint */}
        {draft && POLY.includes(draft.kind) && !pending && (
          <div role="status" className={cn(card, "left-1/2 top-3 flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 px-3 py-2 text-[12px] leading-snug")}>
            <span>
              {draft.kind === "area"
                ? "Click each corner. Click the first point, double-click or press Enter to close."
                : "Click each item. Double-click or press Enter when done."}{" "}
              Backspace removes the last point.
            </span>
            <button type="button" onClick={finishPoly} className="h-7 shrink-0 rounded-[3px] bg-[var(--ks-solid)] px-2.5 text-[12px] font-semibold text-white">
              Finish ({draft.p.length})
            </button>
          </div>
        )}

        {/* note / measurement / calibration prompt */}
        {pending && (
          <form
            onSubmit={e => {
              e.preventDefault();
              void commitPending();
            }}
            className={cn(card, "left-1/2 top-3 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2 px-3 py-2.5")}
          >
            <label htmlFor="sv-label" className="text-[12px] font-semibold">
              {pending.kind === "cal"
                ? "Real length of the line you drew"
                : pending.kind === "text"
                  ? "Text"
                  : pending.kind === "note"
                    ? "Note"
                    : "Note (optional)"}
            </label>
            <input
              id="sv-label"
              autoFocus
              maxLength={500}
              value={label}
              placeholder={pending.kind === "cal" ? `e.g. 20'-0"` : pending.kind === "length" && !fpu ? "Set a scale to get the length" : ""}
              onChange={e => setLabel(e.target.value)}
              className="h-[30px] w-[260px] max-w-[60vw] rounded-[3px] border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2 text-[13px] outline-none focus:border-[var(--ks-accent)]"
            />
            {pending.kind === "area" && fpu && <span className="num text-[12px] text-[var(--ks-ink-2)]">{sqft(polyArea(pending.p) * fpu * fpu)}</span>}
            <button
              type="submit"
              disabled={saveM.isPending || scaleM.isPending}
              className="h-[30px] rounded-[3px] bg-[var(--ks-solid)] px-3 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              {pending.kind === "cal" ? "Set scale" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="h-[30px] rounded-[3px] border border-[var(--ks-rule)] px-2.5 text-[12px] font-medium"
            >
              Cancel
            </button>
          </form>
        )}

        {/* the selected markup */}
        {selM && !pending && (
          <div className={cn(card, "bottom-3 right-3 flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-1.5 px-3 py-2.5")}>
            <span className="num text-[12px] font-semibold">
              {selM.label ? selM.label + " · " : ""}
              {KIND_NAMES[selM.kind] ?? selM.kind} · Rev {selM.rev}
              {selM.kind === "length" || selM.kind === "area" || selM.kind === "count" ? ` · ${measureText(selM.kind, toPage(selM.points, W, H), fpu)}` : ""}
            </span>
            {mayEditSel ? (
              <input
                key={selM.id + "|" + (selM.note ?? "")}
                aria-label="Note"
                defaultValue={selM.note ?? ""}
                placeholder="Add a note"
                maxLength={500}
                onKeyDown={e => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={e => {
                  const t = e.currentTarget.value.trim();
                  if (t !== (selM.note ?? "") && !(selM.kind === "text" && !t)) void saveFields(selM, { note: t || null }, "note saved");
                }}
                className="h-[30px] rounded-[3px] border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2 text-[13px] outline-none focus:border-[var(--ks-accent)]"
              />
            ) : (
              <span className="text-[13px] leading-snug">{selM.note || "No note."}</span>
            )}
            {mayEditSel && (
              <span role="group" aria-label="Colour" className="flex items-center gap-1.5">
                {MARK_COLORS.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    aria-label={c.label}
                    aria-pressed={selM.color.toUpperCase() === c.hex}
                    onClick={() => void saveFields(selM, { color: c.hex }, "recoloured")}
                    className={cn(
                      "size-[18px] rounded-full border-2",
                      selM.color.toUpperCase() === c.hex ? "border-[var(--ks-ink)]" : "border-[var(--ks-rule)]"
                    )}
                    style={{ background: c.hex }}
                  />
                ))}
                {selM.kind !== "note" && selM.kind !== "text" && (
                  <span className="text-[11px] text-[var(--ks-ink-2)]">Drag to move; drag a square to reshape.</span>
                )}
                {(selM.kind === "note" || selM.kind === "text") && <span className="text-[11px] text-[var(--ks-ink-2)]">Drag to move.</span>}
              </span>
            )}
            <span className="text-[11px] text-[var(--ks-ink-2)]">
              {userName(selM.createdBy)} · {fmtDateTime(selM.createdAt)}
            </span>
            <span className="flex gap-3 text-[12px] font-semibold">
              {mayEditSel && (
                <button type="button" onClick={() => void delMark(selM)} className="text-[var(--ks-red-strong)] hover:underline">
                  Delete
                </button>
              )}
              <button type="button" onClick={() => setSel(null)} className="hover:underline">
                Close
              </button>
            </span>
          </div>
        )}

        {msg && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-[5] max-w-[90vw] -translate-x-1/2 rounded-[3px] bg-[var(--ks-solid)] px-3.5 py-2 text-[13px] font-medium leading-snug text-white shadow-lg"
          >
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

export default SheetViewer;
