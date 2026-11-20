/**
 * Import drawings (ported from SteelBuild app/import.jsx): a drawing set — combined PDFs, single sheets or images —
 * becomes one row per page. Mark the title block once (sheet no., title, revision boxes, saved per job); every page is
 * then read from the PDF's own text inside each box, or by AI (scans, photos, or when chosen). Check every row, then
 * add: new sheets, or new revisions of sheets already in the register, each stored as its own one-page PDF plus a
 * page image, as a draft revision that needs sign-off.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minus, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SimpleSelect } from "@/components/ks/Controls";
import { ConfirmDialog } from "./ConfirmDialog";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SET_KINDS } from "@shared/drawings";
import {
  MAX_FILE_MB,
  MAX_PAGES,
  PAGE_EDGE,
  TB_DEFAULT,
  TB_FIELDS,
  UPLOAD_MAX_MB,
  ZOOM_EDGE,
  blobToBase64,
  closeDrawing,
  cropBoxes,
  getPdfLib,
  okDrawingFile,
  openDrawing,
  pagePdf,
  parseTbText,
  renderPage,
  stackCrops,
  tbRevDate,
  type DrawingSource,
  type Rect,
  type TbBoxes,
  type TbField,
} from "./pdf";
import { duplicateKeys, matchOf, nextSetNumber, repeatingRead, rowProblem, sequenceFor, setNameFromFile, type Match, type RowFields } from "./importModel";
import { useDrawingsRefresh, type Register } from "./model";

type Status = "queued" | "reading" | "done" | "error" | "added";
type Item = {
  key: string;
  name: string;
  page: number;
  of: number;
  srcIdx: number | null;
  preview: Blob | null;
  thumb: string;
  crop: string;
  text: string;
  status: Status;
  err: string;
  include: boolean;
  f: RowFields;
  edited: boolean;
  via: "pdf" | "ai" | "hand" | null;
  conf: number | null;
  note: string;
  noteWarn: boolean;
  letter: string;
};
type Queued = { file: File; from: number; pages: number };

let seq = 0;
const uid = () => `im${Date.now().toString(36)}${(seq++).toString(36)}`;
const blankF = (): RowFields => ({ sheet: "", title: "", rev: "", seqId: null, revDate: "", revDesc: "" });
const MATCH_TONE: Record<Match["kind"], string> = {
  new: "text-[var(--ks-blue)]",
  rev: "text-[var(--ks-accent-ink)]",
  skip: "text-muted-foreground",
  none: "text-[var(--ks-red-strong)]",
  norev: "text-[var(--ks-red-strong)]",
  older: "text-[var(--ks-amber)]",
  clash: "text-[var(--ks-amber)]",
};

export function ImportDialog({
  reg,
  defaultSetId,
  open,
  onOpenChange,
  onImported,
}: {
  reg: Register & { projectId: number };
  defaultSetId?: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** called after an import added something: the new sheets' and revisions' sheet ids */
  onImported?: (sheetIds: number[]) => void;
}) {
  const projectId = reg.projectId;
  const utils = trpc.useUtils();
  const refresh = useDrawingsRefresh(projectId);
  const tb = trpc.drawings.titleBlock.useQuery({ projectId }, { enabled: open });
  const saveTb = trpc.drawings.saveTitleBlock.useMutation();
  const readAI = trpc.drawings.readTitleBlockAI.useMutation();
  const saveSheet = trpc.drawings.saveSheet.useMutation();
  const startRev = trpc.drawings.startRevision.useMutation();
  const saveSet = trpc.drawings.saveSet.useMutation();

  const [items, setItems] = useState<Item[]>([]);
  const [step, setStep] = useState<"files" | "box" | "review">("files");
  const [boxes, setBoxes] = useState<TbBoxes>(TB_DEFAULT);
  const [field, setField] = useState<TbField>("sheet");
  const [drawn, setDrawn] = useState<TbField[]>([]);
  const [pi, setPi] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hi, setHi] = useState<Record<string, string | null | false>>({});
  const [aspect, setAspect] = useState(1.5);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState("");
  const [setChoice, setSetChoice] = useState<string>("none");
  const [newSet, setNewSet] = useState({ number: "", name: "", kind: "erection" });
  const [useAI, setUseAI] = useState(false);
  const [more, setMore] = useState<Queued[]>([]);
  const [view, setView] = useState<{ src: string; caption: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  const srcs = useRef<(DrawingSource | null)[]>([]);
  const files = useRef<(File | null)[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const boxEl = useRef<HTMLDivElement | null>(null);
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  const setItem = useCallback((key: string, p: Partial<Item> | ((i: Item) => Partial<Item>)) => {
    setItems(list => list.map(i => (i.key === key ? { ...i, ...(typeof p === "function" ? p(i) : p) } : i)));
  }, []);

  const cleanup = useCallback(() => {
    ctl.current?.abort();
    itemsRef.current.forEach(i => {
      if (i.thumb) URL.revokeObjectURL(i.thumb);
      if (i.crop) URL.revokeObjectURL(i.crop);
    });
    srcs.current.forEach(closeDrawing);
    srcs.current = [];
    files.current = [];
  }, []);

  // A fresh dialog each time it opens.
  useEffect(() => {
    if (!open) return;
    setItems([]);
    setStep("files");
    setField("sheet");
    setDrawn([]);
    setPi(0);
    setZoom(1);
    setHi({});
    setPhase("");
    setRunning(false);
    setSaving(false);
    const firstSet = defaultSetId ? String(defaultSetId) : reg.canEdit ? "new" : "none";
    setSetChoice(firstSet);
    setNewSet({ number: nextSetNumber(reg.sets, "erection"), name: "", kind: "erection" });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // The saved boxes and the AI choice are taken once per opening: a later refetch (after saving the boxes) must not
  // undo what the person drew or switched.
  const tbInit = useRef(false);
  useEffect(() => {
    if (!open) tbInit.current = false;
    else if (tb.data && !tbInit.current) {
      tbInit.current = true;
      setBoxes(tb.data.boxes as TbBoxes);
      setUseAI(tb.data.ai);
    }
  }, [open, tb.data]);

  const close = () => {
    if (running || saving) return;
    cleanup();
    onOpenChange(false);
  };

  /* ------------------------------------------------------------ */
  /* Files → one row per page                                      */
  /* ------------------------------------------------------------ */

  const importFiles = async (list: File[], from?: number[]) => {
    if (!list.length || running) return;
    const c = new AbortController();
    ctl.current = c;
    setRunning(true);
    setPhase("Preparing pages…");
    if (setChoice === "new" && !newSet.name) setNewSet(s => ({ ...s, name: setNameFromFile(list[0].name) }));
    let budget = MAX_PAGES - itemsRef.current.filter(i => i.preview).length;
    let added = 0;
    const firstNew = itemsRef.current.filter(i => i.preview).length;
    const left: Queued[] = [];
    const errItem = (name: string, page: number, msg: string): Item => ({
      key: uid(),
      name,
      page,
      of: 1,
      srcIdx: null,
      preview: null,
      thumb: "",
      crop: "",
      text: "",
      status: "error",
      err: msg,
      include: false,
      f: blankF(),
      edited: false,
      via: null,
      conf: null,
      note: "",
      noteWarn: false,
      letter: "",
    });
    for (const [fi, file] of list.entries()) {
      if (c.signal.aborted) break;
      const start = Math.max(1, from?.[fi] ?? 1);
      if (budget <= 0) {
        left.push({ file, from: start, pages: 0 });
        continue;
      }
      if (!okDrawingFile(file)) {
        setItems(l => [...l, errItem(file.name, 1, "Only PDF, PNG, JPEG or WebP drawings can be imported.")]);
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setItems(l => [...l, errItem(file.name, 1, `This file is over ${MAX_FILE_MB} MB. Split the set into smaller PDFs.`)]);
        continue;
      }
      let src: DrawingSource;
      try {
        src = await openDrawing(file);
      } catch (e) {
        const code = (e as { code?: string }).code;
        const why =
          code === "password"
            ? "This PDF is password-protected. Save an unprotected copy and import that."
            : code === "empty"
              ? "This PDF has no pages."
              : code === "too_big_image"
                ? "This image is too large to import on this device."
                : "This file could not be opened as a drawing.";
        setItems(l => [...l, errItem(file.name, 1, why)]);
        continue;
      }
      const srcIdx = srcs.current.push(src) - 1;
      files.current[srcIdx] = src.isPdf ? file : null;
      let p = Math.min(start, src.pages);
      for (; p <= src.pages && budget > 0; p++) {
        if (c.signal.aborted) break;
        setPhase(`Preparing ${file.name} · page ${p} of ${src.pages}`);
        try {
          const blob = await renderPage(src, p, PAGE_EDGE);
          added++;
          budget--;
          const it: Item = {
            key: uid(),
            name: file.name,
            page: p,
            of: src.pages,
            srcIdx,
            preview: blob,
            thumb: URL.createObjectURL(blob),
            crop: "",
            text: "",
            status: "queued",
            err: "",
            include: true,
            f: blankF(),
            edited: false,
            via: null,
            conf: null,
            note: "",
            noteWarn: false,
            letter: "",
          };
          setItems(l => [...l, it]);
        } catch {
          setItems(l => [...l, errItem(file.name, p, "This page could not be rendered.")]);
        }
      }
      if (p <= src.pages && !c.signal.aborted) left.push({ file, from: p, pages: src.pages });
    }
    setMore(left);
    if (left.length)
      toast.message(`Over the ${MAX_PAGES}-page limit for one import. Add these pages, then use Continue for the rest.`, { duration: 8000 });
    setRunning(false);
    setPhase("");
    if (added) {
      setPi(firstNew);
      setStep("box");
    }
  };

  /* ------------------------------------------------------------ */
  /* Title-block boxes                                             */
  /* ------------------------------------------------------------ */

  const pages = items.filter(i => i.thumb && i.srcIdx != null);
  const pIdx = Math.max(0, Math.min(pi, pages.length - 1));
  const pv = pages[pIdx] ?? null;

  const ensureHiRes = async (it: Item | null) => {
    if (!it || it.srcIdx == null || hi[it.key] !== undefined) return;
    setHi(h => ({ ...h, [it.key]: null }));
    try {
      const blob = await renderPage(srcs.current[it.srcIdx]!, it.page, ZOOM_EDGE);
      setHi(h => ({ ...h, [it.key]: URL.createObjectURL(blob) }));
    } catch {
      setHi(h => ({ ...h, [it.key]: false }));
    }
  };

  const setZoomAt = (z: number, cx?: number, cy?: number) => {
    const sc = scrollEl.current;
    const zz = Math.min(8, Math.max(1, Math.round(z * 100) / 100));
    if (!sc || zz === zoom) return;
    const r = sc.getBoundingClientRect();
    const ox = cx == null ? r.width / 2 : cx - r.left,
      oy = cy == null ? r.height / 2 : cy - r.top;
    const fx = (sc.scrollLeft + ox) / sc.scrollWidth,
      fy = (sc.scrollTop + oy) / sc.scrollHeight;
    setZoom(zz);
    requestAnimationFrame(() => {
      sc.scrollLeft = fx * sc.scrollWidth - ox;
      sc.scrollTop = fy * sc.scrollHeight - oy;
    });
    if (zz >= 1.6) void ensureHiRes(pv);
  };

  // Ctrl/⌘ + wheel zooms the page (a non-passive listener so the browser doesn't zoom instead).
  useEffect(() => {
    const sc = scrollEl.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoomAt(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  });

  const space = useRef(false);
  useEffect(() => {
    const d = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = e.type === "keydown";
    };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", d);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", d);
    };
  }, []);

  const boxDown = (e: RPointerEvent<HTMLDivElement>) => {
    const el = boxEl.current,
      sc = scrollEl.current;
    if (!el || !sc) return;
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      const sx = e.clientX,
        sy = e.clientY,
        l0 = sc.scrollLeft,
        t0 = sc.scrollTop;
      const mv = (ev: PointerEvent) => {
        sc.scrollLeft = l0 - (ev.clientX - sx);
        sc.scrollTop = t0 - (ev.clientY - sy);
      };
      const end = () => {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", end);
      return;
    }
    if (e.button > 0) return;
    e.preventDefault();
    const b = el.getBoundingClientRect();
    const fx = (v: number) => Math.min(1, Math.max(0, (v - b.left) / b.width)),
      fy = (v: number) => Math.min(1, Math.max(0, (v - b.top) / b.height));
    const x0 = fx(e.clientX),
      y0 = fy(e.clientY),
      prev = boxes[field],
      f = field;
    let last: Rect = prev;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x1 = fx(ev.clientX),
        y1 = fy(ev.clientY);
      last = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      setBoxes(bx => ({ ...bx, [f]: last }));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (last.w < 0.004 || last.h < 0.003) {
        setBoxes(bx => ({ ...bx, [f]: prev }));
        return;
      }
      setDrawn(d => {
        const nd = Array.from(new Set([...d, f]));
        const next = TB_FIELDS.find(x => !nd.includes(x.k));
        if (next) setField(next.k);
        return nd;
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  /* ------------------------------------------------------------ */
  /* Reading                                                       */
  /* ------------------------------------------------------------ */

  const aiAvailable = !!tb.data?.ai;
  const canRead = aiAvailable || srcs.current.some(s => s?.isPdf);

  const readTitleBlocks = async () => {
    if (running) return;
    const ai = useAI && aiAvailable;
    if (JSON.stringify(boxes) !== JSON.stringify(tb.data?.boxes) && reg.canUpload) {
      saveTb.mutate({ projectId, boxes }, { onSuccess: () => void utils.drawings.titleBlock.invalidate({ projectId }) });
    }
    // Rows typed or corrected by hand are never read again.
    const cur = itemsRef.current;
    const queued = cur.filter(i => i.srcIdx != null && i.preview && !i.edited && (i.status === "queued" || i.status === "error"));
    const todo = queued.length ? queued : cur.filter(i => i.srcIdx != null && i.preview && !i.edited && i.status !== "added");
    const c = new AbortController();
    ctl.current = c;
    setRunning(true);
    setStep("review");
    todo.forEach(i => setItem(i.key, { status: "queued" }));
    let k = 0;
    for (const it0 of todo) {
      if (c.signal.aborted) break;
      const it = itemsRef.current.find(i => i.key === it0.key);
      if (!it || it.edited) continue;
      k++;
      setPhase(`${ai ? "AI is reading title blocks" : "Reading title blocks from the PDF text"} · ${k} of ${todo.length}`);
      setItem(it.key, { status: "reading", err: "", note: "", noteWarn: false });
      let pre = { sheet: "", title: "", rev: "", letter: "" };
      let cropped = false;
      try {
        const src = srcs.current[it.srcIdx!]!;
        const parts = await cropBoxes(src, it.page, TB_FIELDS.map(f => boxes[f.k]));
        const stacked = await stackCrops(parts.map(q => q.blob));
        const texts = parts.map(q => q.text);
        cropped = true;
        if (it.crop) URL.revokeObjectURL(it.crop);
        pre = parseTbText(texts);
        const seqId = sequenceFor(pre.title, reg.sequences);
        const preF: RowFields = { ...it.f, sheet: pre.sheet, title: pre.title, rev: pre.rev, revDate: tbRevDate(texts[2], pre.letter || pre.rev), seqId: seqId ?? it.f.seqId };
        setItem(it.key, { crop: URL.createObjectURL(stacked), text: texts.join("\n"), letter: pre.letter, f: preF });
        if (!ai) {
          const got = !!(pre.sheet || pre.title);
          setItem(it.key, {
            status: got ? "done" : "error",
            via: "pdf",
            conf: null,
            note: got ? "Read from the PDF text" : "",
            err: got ? "" : "No text in the boxes on this page (scans have none). Type the sheet no. and title, turn on AI reading, or adjust the boxes and read again.",
          });
          continue;
        }
        const crops = await Promise.all(parts.map(q => blobToBase64(q.blob)));
        const res = await readAI.mutateAsync({ projectId, crops, texts });
        if (c.signal.aborted) break;
        const latest = itemsRef.current.find(i => i.key === it.key);
        if (!latest || latest.edited) continue;
        const f: RowFields = {
          ...preF,
          sheet: res.sheet || pre.sheet,
          title: res.title || pre.title,
          rev: res.rev != null ? String(res.rev) : pre.rev,
          revDate: res.revDate || preF.revDate,
          revDesc: res.revDesc || "",
          seqId: sequenceFor(res.title || pre.title, reg.sequences) ?? preF.seqId,
        };
        const empty = !f.sheet && !f.title;
        setItem(it.key, {
          status: empty ? "error" : "done",
          via: "ai",
          conf: res.confidence,
          f,
          letter: res.rev != null && String(res.rev) !== pre.rev ? "" : pre.letter,
          err: empty ? "Nothing readable in the boxes on this page. Open the crop; if it misses the title block, adjust the boxes and read again." : "",
        });
      } catch (e) {
        const hasPre = cropped && (pre.sheet || pre.title);
        if (hasPre) setItem(it.key, { status: "done", via: "pdf", conf: null, noteWarn: true, note: `From PDF text only — ${errMsg(e)}` });
        else setItem(it.key, { status: "error", err: !cropped ? "This page could not be cropped. Check the boxes sit on the page." : errMsg(e) });
        // A missing AI setup or rate limit won't fix itself page by page: stop and fall back to PDF text.
        if (/set up|rate|PRECONDITION/i.test(errMsg(e))) {
          setUseAI(false);
          break;
        }
      }
    }
    setItems(l => l.map(i => (i.status === "reading" ? { ...i, status: "queued" } : i)));
    setRunning(false);
    setPhase("");
  };

  /* ------------------------------------------------------------ */
  /* Review                                                        */
  /* ------------------------------------------------------------ */

  const regSheets = useMemo(() => reg.sheets.map(x => ({ id: x.id, sheetNumber: x.sheetNumber, setId: x.setId, revs: x.revs.map(r => ({ number: r.number, state: r.state })) })), [reg.sheets]);
  const dupes = duplicateKeys(items.filter(i => i.preview && i.status !== "added"));
  const rows = items.map(i => {
    const m = matchOf(regSheets, i.f);
    const problem = i.status === "error" ? i.err : dupes.has(i.key) ? "Same sheet no. as another row — untick one" : rowProblem(i.f, m);
    return { i, m, problem };
  });
  const live = rows.filter(r => r.i.include && r.i.preview && r.i.status !== "added");
  const ready = running ? [] : live.filter(r => r.i.status === "done" && !r.problem);
  const notReady = running ? [] : live.filter(r => r.i.status !== "queued" && r.problem);
  const repeating = repeatingRead(items.filter(i => i.status === "done").map(i => i.f));
  const setF = (key: string, k: keyof RowFields, v: string | number | null) =>
    setItem(key, i => ({ edited: true, via: "hand", f: { ...i.f, [k]: v }, ...(i.status === "error" && i.preview ? { status: "done" as const, err: "" } : {}), ...(i.status === "queued" ? { status: "done" as const } : {}) }));

  const needSet = ready.some(r => r.m.kind === "new");
  const setProblem =
    needSet && setChoice === "new"
      ? !reg.canEdit
        ? "Only editors can create drawing sets — pick one"
        : !newSet.number.trim() || !newSet.name.trim()
          ? "Give the new set a number and a name"
          : reg.sets.some(t => t.number.trim().toLowerCase() === newSet.number.trim().toLowerCase())
            ? `Set ${newSet.number.trim()} already exists — pick it or use another number`
            : ""
      : "";

  /* ------------------------------------------------------------ */
  /* Apply                                                         */
  /* ------------------------------------------------------------ */

  const apply = async (jumpOk = false) => {
    if (saving || !ready.length || setProblem) return;
    const jumps = ready.filter(r => r.m.kind === "rev" && r.m.jump);
    if (jumps.length && !jumpOk) {
      setConfirm({
        title: "Check these revision numbers",
        body: `${jumps
          .slice(0, 6)
          .map(r => `${r.i.f.sheet}: ${r.m.label.replace(" — check this jump", "")}`)
          .join(" · ")}${jumps.length > 6 ? ` and ${jumps.length - 6} more` : ""}. Revisions usually go up one at a time; a big jump is often a misread revision block.`,
        label: "Add them anyway",
        run: () => void apply(true),
      });
      return;
    }
    setSaving(true);
    const added: number[] = [];
    let failed = 0,
      changed = 0;
    try {
      // The register may have changed since the rows were read: match each row again against it as it is now.
      const fresh = await utils.drawings.register.fetch({ projectId });
      const freshSheets = fresh.sheets.map(x => ({ id: x.id, sheetNumber: x.sheetNumber, setId: x.setId, revs: x.revs.map(r => ({ number: r.number, state: r.state })) }));
      let setId: number | null = setChoice === "none" || setChoice === "new" ? null : Number(setChoice);
      if (setId != null && !fresh.sets.some(t => t.id === setId)) throw new Error("That drawing set was deleted. Pick another set and try again.");
      if (needSet && setChoice === "new") {
        setPhase("Creating the drawing set…");
        const r = await saveSet.mutateAsync({ projectId, number: newSet.number.trim(), name: newSet.name.trim(), kind: newSet.kind });
        setId = r.id;
        setSetChoice(String(r.id));
      }
      let lib: Awaited<ReturnType<typeof getPdfLib>> | null = null;
      const docs = new Map<number, import("pdf-lib").PDFDocument>();
      let k = 0;
      for (const r of ready) {
        k++;
        setPhase(`Saving drawing ${k} of ${ready.length} · ${r.i.f.sheet}`);
        const m = matchOf(freshSheets, r.i.f);
        if (m.kind !== r.m.kind || (m.kind !== "new" && m.kind !== "rev")) {
          changed++;
          setItem(r.i.key, { status: "error", err: `Changed in the register meanwhile: ${m.label}` });
          continue;
        }
        try {
          // Each sheet keeps its own one-page PDF (the viewer needs its text for links, search and framing).
          let file: { fileName: string; mimeType: string; base64: string } | undefined;
          let note = "";
          const src = r.i.srcIdx != null ? srcs.current[r.i.srcIdx] : null;
          if (src?.isPdf) {
            try {
              lib = lib ?? (await getPdfLib());
              let doc = docs.get(r.i.srcIdx!);
              if (!doc) {
                doc = await lib.PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false });
                docs.set(r.i.srcIdx!, doc);
              }
              const one = r.i.of > 1 ? await pagePdf(lib, doc, r.i.page) : files.current[r.i.srcIdx!]!;
              if (one.size > UPLOAD_MAX_MB * 1024 * 1024) note = ` (sheet PDF over ${UPLOAD_MAX_MB} MB — page image only)`;
              else file = { fileName: `${r.i.f.sheet.trim()} R${r.i.f.rev || 0}.pdf`.replace(/[\\/:*?"<>|]+/g, "_"), mimeType: "application/pdf", base64: await blobToBase64(one) };
            } catch {
              note = " (not split from the set — page image only)";
            }
          }
          const preview = { fileName: `${r.i.f.sheet.trim()}-p${r.i.page}.jpg`, mimeType: "image/jpeg", base64: await blobToBase64(r.i.preview!) };
          const meta = {
            preview,
            file,
            revDescription: r.i.f.revDesc.trim() || (Number(r.i.f.rev || 0) === 0 ? "Initial issue" : `Revision ${r.i.f.rev}`),
            revDate: r.i.f.revDate || null,
            source: `Read from ${r.i.name}${r.i.of > 1 ? ` p${r.i.page}` : ""}${note}`,
            readVia: (r.i.edited ? "hand" : r.i.via ?? "hand") as "pdf" | "ai" | "hand",
          };
          if (m.kind === "new") {
            const res = await saveSheet.mutateAsync({
              projectId,
              sheetNumber: r.i.f.sheet.trim(),
              title: r.i.f.title.trim(),
              setId,
              sequenceTaskId: r.i.f.seqId,
              startRev: Number(r.i.f.rev || 0),
              ...meta,
            });
            added.push(res.id);
          } else {
            await startRev.mutateAsync({ sheetId: m.x.id, number: Number(r.i.f.rev), ...meta });
            added.push(m.x.id);
          }
          setItem(r.i.key, { status: "added", err: "", note: m.kind === "new" ? "Added" : `Rev ${r.i.f.rev} added` });
        } catch (e) {
          failed++;
          setItem(r.i.key, { status: "error", err: errMsg(e) });
        }
      }
      await refresh();
      const nNew = ready.filter(r => r.m.kind === "new").length;
      const msg = `Added ${added.length} drawing${added.length === 1 ? "" : "s"} as draft revisions. Each needs a sign-off before it can be issued.`;
      if (failed || changed) toast.error(`${msg} ${failed ? `${failed} failed` : ""}${failed && changed ? ", " : ""}${changed ? `${changed} changed in the register meanwhile` : ""} — see the rows marked in red.`);
      else toast.success(msg);
      if (added.length) onImported?.(added);
      if (!failed && !changed) {
        cleanup();
        onOpenChange(false);
      }
      void nNew;
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
      setPhase("");
    }
  };

  if (!open) return null;

  const isBox = step === "box" && !!pv;
  const queuedN = items.filter(i => (i.status === "queued" || i.status === "error") && i.srcIdx != null && i.preview && !i.edited).length;
  const doneN = items.filter(i => i.status === "done").length;
  const fieldOf = TB_FIELDS.find(f => f.k === field) ?? TB_FIELDS[0];
  const hiSrc = pv ? hi[pv.key] : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Import drawings" className="flex max-h-[calc(100vh-32px)] w-[min(1180px,100%)] flex-col border border-[var(--ks-rule)] bg-[var(--ks-paper)] shadow-xl">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 border-b border-[var(--ks-rule)] px-5 py-4">
          <div className="min-w-[260px] flex-1">
            <div className="text-[17px] font-semibold">Import drawings</div>
            <div className="mt-1 text-[12.5px] text-muted-foreground">
              Each page of a set is one sheet. Mark the title block once; every page's sheet no., title and revision are then read{" "}
              {useAI && aiAvailable ? "by AI (with the PDF's own text)" : "from the PDF's own text"}. Check every row, then add them. New revisions arrive as drafts that need sign-off.
            </div>
          </div>
          <label className="block">
            <div className="label-caps mb-1">New sheets go in</div>
            <div className="w-[240px]">
              <SimpleSelect
                value={setChoice}
                onChange={v => setSetChoice(v ?? "none")}
                options={[
                  ...(reg.canEdit ? [{ value: "new", label: "New set…" }] : []),
                  ...reg.sets.map(t => ({ value: String(t.id), label: `${t.number} · ${t.name}` })),
                  { value: "none", label: "Not in a set" },
                ]}
              />
            </div>
          </label>
          {aiAvailable && (
            <label className="flex items-center gap-2 self-end pb-2 text-[12.5px]">
              <Switch checked={useAI} onCheckedChange={setUseAI} disabled={running} /> Read with AI
            </label>
          )}
          <button type="button" aria-label="Close" className="p-1 text-muted-foreground hover:text-foreground" onClick={close}>
            <X className="size-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-auto px-5 py-4">
          {setChoice === "new" && !isBox && (
            <div className="flex flex-wrap items-end gap-3 border border-[var(--ks-rule)] bg-[var(--ks-bone)] px-3 py-2.5">
              <label className="w-[130px]">
                <div className="label-caps mb-1">Set no.</div>
                <Input value={newSet.number} maxLength={32} onChange={e => setNewSet(s => ({ ...s, number: e.target.value }))} className="num h-8 bg-[var(--ks-paper)]" />
              </label>
              <label className="min-w-[220px] flex-1">
                <div className="label-caps mb-1">New set name</div>
                <Input value={newSet.name} maxLength={120} placeholder="Seq 4 framing · package S-007" onChange={e => setNewSet(s => ({ ...s, name: e.target.value }))} className="h-8 bg-[var(--ks-paper)]" />
              </label>
              <label className="w-[170px]">
                <div className="label-caps mb-1">Kind</div>
                <SimpleSelect value={newSet.kind} onChange={k => setNewSet(s => ({ ...s, kind: k ?? "erection", number: nextSetNumber(reg.sets, k ?? "erection") }))} options={SET_KINDS} size="sm" />
              </label>
            </div>
          )}

          {isBox && pv && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[14px] font-semibold">Mark the title block fields</div>
                <div className="max-w-[820px] text-[12.5px] text-muted-foreground">
                  Draw three boxes: one around the sheet number, one around the sheet title, one around the revision number or revision block. Pick a field, then drag on the drawing.
                  Each field is read only from its own box on every page. The boxes are saved for this job.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="Title block field" className="flex flex-wrap gap-1.5">
                  {TB_FIELDS.map(f => {
                    const on = field === f.k,
                      done = drawn.includes(f.k);
                    return (
                      <button
                        key={f.k}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => setField(f.k)}
                        className={cn("flex items-center gap-2 border px-2.5 py-1.5 text-[12px]", on ? "border-[var(--ks-graphite)] bg-[var(--ks-graphite)] font-semibold text-white" : "border-[var(--ks-rule)] bg-[var(--ks-paper)]")}
                      >
                        <span className="size-2.5 border-2" style={{ borderColor: f.color, background: done ? f.color : "transparent" }} />
                        {f.label}
                        {done ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
                <div className="ml-2 flex items-center gap-1">
                  <Button type="button" size="icon" variant="outline" className="size-7" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoomAt(zoom / 1.4)}>
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="num w-12 text-center text-[12px]">{Math.round(zoom * 100)}%</span>
                  <Button type="button" size="icon" variant="outline" className="size-7" aria-label="Zoom in" disabled={zoom >= 8} onClick={() => setZoomAt(zoom * 1.4)}>
                    <Plus className="size-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="outline" className="size-7" aria-label="Fit page" disabled={zoom === 1} onClick={() => setZoomAt(1)}>
                    <Maximize2 className="size-3.5" />
                  </Button>
                </div>
                <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Button type="button" size="icon" variant="outline" className="size-7" aria-label="Previous page" disabled={pIdx === 0} onClick={() => setPi(pIdx - 1)}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  Page {pIdx + 1} of {pages.length}
                  <Button type="button" size="icon" variant="outline" className="size-7" aria-label="Next page" disabled={pIdx >= pages.length - 1} onClick={() => setPi(pIdx + 1)}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
              <div ref={scrollEl} className="relative max-h-[58vh] overflow-auto overscroll-contain border border-[var(--ks-rule)] bg-[var(--ks-gray-soft)] p-3">
                <div
                  ref={boxEl}
                  onPointerDown={boxDown}
                  onAuxClick={e => e.preventDefault()}
                  className="relative mx-auto cursor-crosshair touch-none select-none leading-[0]"
                  style={{ width: `min(${zoom * 100}%, ${(54 * aspect * zoom).toFixed(2)}vh)` }}
                >
                  <img
                    src={(hiSrc as string) || pv.thumb}
                    alt={`${pv.name} page ${pv.page}`}
                    draggable={false}
                    onLoad={e => {
                      const im = e.currentTarget;
                      const a = im.naturalWidth / im.naturalHeight;
                      if (a && Math.abs(a - aspect) > 0.01) setAspect(a);
                    }}
                    className="pointer-events-none block h-auto w-full bg-[var(--ks-drawing-paper)]"
                  />
                  {TB_FIELDS.map(f => {
                    const r = boxes[f.k],
                      on = field === f.k;
                    return (
                      <div
                        key={f.k}
                        className="pointer-events-none absolute"
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.w * 100}%`,
                          height: `${r.h * 100}%`,
                          border: `${on ? 2 : 1.5}px ${on ? "solid" : "dashed"} ${f.color}`,
                          background: `${f.color}1f`,
                        }}
                      >
                        <span className="absolute bottom-full left-[-1px] whitespace-nowrap bg-[var(--ks-drawing-ink)] px-1 py-0.5 text-[10px] font-semibold leading-none text-[var(--ks-drawing-paper)]" style={{ borderBottom: `2px solid ${f.color}` }}>
                          {f.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="text-[12px] text-muted-foreground">
                Drawing the{" "}
                <span className="font-semibold text-[var(--ks-accent-ink)]">
                  {fieldOf.label}
                </span>{" "}
                box. Zoom with the buttons or Ctrl + scroll; when zoomed, scroll to move around, or hold Space and drag. Check a few pages with the arrows so the boxes land on every sheet. {pv.name} · page {pv.page}
                {zoom >= 1.6 && hiSrc === null ? " · sharpening…" : ""}
              </div>
            </div>
          )}

          {!isBox && (
            <label
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                if (!saving && !running) void importFiles(Array.from(e.dataTransfer.files));
              }}
              className={cn(
                "relative flex cursor-pointer items-center justify-center gap-3 border border-dashed border-input bg-[var(--ks-paper)] px-4 text-center text-[13px]",
                items.length ? "py-3" : "py-10"
              )}
            >
              <input
                type="file"
                multiple
                accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                disabled={running || saving}
                onChange={e => {
                  void importFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
                className="absolute h-px w-px opacity-0"
              />
              <Upload className="size-4 text-muted-foreground" />
              <span>
                {items.length ? "Add more PDFs or images" : "Drop a drawing set here, or choose PDFs or images"}
                <span className="block text-[12px] text-muted-foreground">Up to {MAX_PAGES} pages per import · each PDF page is one sheet</span>
              </span>
            </label>
          )}

          {!isBox && !running && !saving && more.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border border-[var(--ks-rule)] bg-[var(--ks-bone)] px-3 py-2 text-[12.5px]">
              <span className="min-w-[240px] flex-1">
                {more[0].from > 1 ? `${more[0].file.name} has more pages (from page ${more[0].from})` : `${more[0].file.name} was not added`}
                {more.length > 1 ? `, and ${more.length - 1} more file${more.length === 2 ? "" : "s"}` : ""} — over the {MAX_PAGES}-page limit for one import. Add these first, then continue.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={items.some(i => i.status !== "added" && i.preview)}
                onClick={() => {
                  const q = more;
                  setMore([]);
                  void importFiles(
                    q.map(x => x.file),
                    q.map(x => x.from)
                  );
                }}
              >
                {more[0].from > 1 ? `Continue from page ${more[0].from}` : "Continue"}
              </Button>
            </div>
          )}

          {phase && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {phase}
            </div>
          )}

          {!isBox && repeating && !running && (
            <div className="flex flex-wrap items-center gap-3 border border-[color-mix(in_srgb,var(--ks-amber)_35%,var(--ks-rule))] bg-[var(--ks-amber-soft)] px-3 py-2 text-[12.5px]">
              <span className="min-w-[240px] flex-1">
                <span className="font-semibold">Many pages came back with the same {repeating === "sheet" ? "sheet number" : "title"}.</span> A box is probably catching text every sheet shares. Check the crops, tighten the boxes, and read again.
              </span>
              <Button size="sm" variant="outline" onClick={() => setStep("box")}>
                Adjust the boxes
              </Button>
            </div>
          )}

          {!isBox && items.length > 0 && (
            <div className="overflow-x-auto border border-[var(--ks-rule)] bg-[var(--ks-paper)]">
              <table className="ks-table min-w-[1100px]">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th style={{ width: 110 }}>Title block</th>
                    <th style={{ width: 110 }}>Sheet</th>
                    <th>Title</th>
                    <th style={{ width: 62 }}>Rev</th>
                    <th style={{ width: 150 }}>Sequence</th>
                    <th style={{ width: 132 }}>Rev date</th>
                    <th>Revision note</th>
                    <th style={{ width: 180 }}>Register</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ i, m, problem }) => {
                    const lock = i.status === "added" || saving;
                    return (
                      <tr key={i.key} className={i.include ? "" : "opacity-55"}>
                        <td>
                          <Checkbox checked={i.include} disabled={!i.preview || lock} onCheckedChange={v => setItem(i.key, { include: v === true })} aria-label={`Include ${i.f.sheet || i.name}`} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="block h-[52px] w-[100px] cursor-zoom-in overflow-hidden border border-[var(--ks-rule)] bg-[var(--ks-drawing-paper)]"
                            onClick={() => (i.crop || i.thumb) && setView({ src: i.crop || i.thumb, caption: `${i.crop ? "Title block · " : ""}${i.name} · page ${i.page}` })}
                            title={`${i.name} · page ${i.page}`}
                          >
                            {i.crop || i.thumb ? <img src={i.crop || i.thumb} alt={`Page ${i.page}`} className={cn("h-full w-full", i.crop ? "object-contain" : "object-cover")} /> : <span className="text-[10px] text-muted-foreground">—</span>}
                          </button>
                        </td>
                        {i.status === "reading" || (i.status === "queued" && running) ? (
                          <td colSpan={6} className="text-[12px] text-muted-foreground">
                            {i.status === "reading" ? "Reading title block…" : "Waiting…"} <span className="num text-[11px]">{i.name}{i.of > 1 ? ` · p${i.page}` : ""}</span>
                          </td>
                        ) : (
                          <>
                            <td>
                              <Input value={i.f.sheet} maxLength={64} disabled={lock} onChange={e => setF(i.key, "sheet", e.target.value)} placeholder="E-204" className="num h-7 bg-[var(--ks-paper)]" aria-label="Sheet no." />
                            </td>
                            <td>
                              <Input value={i.f.title} maxLength={255} disabled={lock} onChange={e => setF(i.key, "title", e.target.value)} placeholder="Sheet title" className="h-7 bg-[var(--ks-paper)]" aria-label="Title" />
                            </td>
                            <td>
                              <Input value={i.f.rev} inputMode="numeric" disabled={lock} onChange={e => setF(i.key, "rev", e.target.value.replace(/[^\d]/g, "").slice(0, 3))} className="num h-7 bg-[var(--ks-paper)]" aria-label="Revision" />
                            </td>
                            <td>
                              <SimpleSelect
                                value={i.f.seqId == null ? null : String(i.f.seqId)}
                                onChange={v => setF(i.key, "seqId", v ? Number(v) : null)}
                                options={reg.sequences.map(s => ({ value: String(s.id), label: s.name }))}
                                allowNone
                                size="sm"
                                disabled={lock}
                              />
                            </td>
                            <td>
                              <Input type="date" value={i.f.revDate} max={reg.today} disabled={lock} onChange={e => setF(i.key, "revDate", e.target.value)} className="h-7 bg-[var(--ks-paper)]" aria-label="Revision date" />
                            </td>
                            <td>
                              <Input value={i.f.revDesc} maxLength={600} disabled={lock} onChange={e => setF(i.key, "revDesc", e.target.value)} placeholder="What changed" className="h-7 bg-[var(--ks-paper)]" aria-label="Revision note" />
                            </td>
                          </>
                        )}
                        <td className="text-[12px]">
                          {i.status === "added" ? (
                            <span className="font-semibold text-[var(--ks-green)]">{i.note || "Added"}</span>
                          ) : problem && i.status !== "queued" && i.status !== "reading" ? (
                            <span className={cn("font-semibold", i.status === "error" || dupes.has(i.key) ? "text-[var(--ks-red-strong)]" : MATCH_TONE[m.kind])}>{problem}</span>
                          ) : i.status === "done" ? (
                            <span className={cn("font-semibold", MATCH_TONE[m.kind])}>{m.label}</span>
                          ) : null}
                          {m.kind === "clash" && i.status !== "error" && i.status !== "added" && (
                            <button type="button" className="block text-[var(--ks-accent-ink)] underline" onClick={() => setF(i.key, "sheet", m.x.sheetNumber)}>
                              Use {m.x.sheetNumber}
                            </button>
                          )}
                          {m.kind === "new" && m.assumed && i.status === "done" && <div className="text-[11px] text-[var(--ks-amber)]">Rev 0 assumed (none read)</div>}
                          {m.kind === "older" && i.status === "done" && (
                            <div className="text-[11px] text-muted-foreground">A new issue after lettered review rounds? Type the next number: R{m.top + 1}.</div>
                          )}
                          {i.letter && i.status === "done" && !i.edited && <div className="text-[11px] text-muted-foreground">Rev {i.letter} read as R{i.f.rev} (A=1, B=2)</div>}
                          {i.note && i.status === "done" && !i.edited && <div className={cn("text-[11px]", i.noteWarn ? "text-[var(--ks-amber)]" : "text-muted-foreground")}>{i.note}</div>}
                          {i.conf != null && i.status === "done" && (
                            <div className={cn("text-[11px]", i.conf < 0.6 ? "text-[var(--ks-red-strong)]" : "text-muted-foreground")}>
                              {i.conf < 0.6 ? "Low confidence — check it" : `Read by AI · ${Math.round(i.conf * 100)}%`}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ks-rule)] px-5 py-3">
          <span className="mr-auto text-[12px] text-muted-foreground">
            {isBox
              ? `${pages.length} page${pages.length === 1 ? "" : "s"} ready to read`
              : items.length
                ? `${ready.length} of ${items.filter(i => i.status !== "added").length} ready to add${notReady.length ? ` · ${notReady.length} need attention (left out)` : ""}${setProblem ? ` · ${setProblem}` : ""}`
                : ""}
          </span>
          {running ? (
            <Button variant="outline" onClick={() => ctl.current?.abort()}>
              Stop
            </Button>
          ) : isBox && doneN ? (
            <Button variant="outline" onClick={() => setStep("review")}>
              Back to results
            </Button>
          ) : (
            <Button variant="outline" disabled={saving} onClick={close}>
              {items.some(i => i.status === "added") ? "Close" : "Cancel"}
            </Button>
          )}
          {isBox ? (
            <Button disabled={running || !canRead} onClick={() => void readTitleBlocks()}>
              {queuedN ? `Read ${queuedN} title block${queuedN === 1 ? "" : "s"}` : "Read again (keeps hand corrections)"}
            </Button>
          ) : (
            <>
              {canRead && pages.length > 0 && !saving && (
                <Button variant="outline" disabled={running} onClick={() => setStep("box")}>
                  Adjust title block boxes
                </Button>
              )}
              <Button disabled={!ready.length || running || saving || !!setProblem} onClick={() => void apply()}>
                {saving ? "Adding…" : `Add ${ready.length} to register`}
              </Button>
            </>
          )}
        </div>
      </div>

      {view && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-6" onClick={() => setView(null)} role="presentation">
          <figure className="max-h-full max-w-full" onClick={e => e.stopPropagation()}>
            <img src={view.src} alt={view.caption} className="max-h-[85vh] max-w-[90vw] bg-[var(--ks-drawing-paper)] object-contain" />
            <figcaption className="mt-2 flex items-center justify-between gap-4 text-[12.5px] text-white">
              {view.caption}
              <Button size="sm" variant="outline" onClick={() => setView(null)}>
                Close
              </Button>
            </figcaption>
          </figure>
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.label ?? "OK"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          c?.run();
        }}
      />
    </div>
  );
}
