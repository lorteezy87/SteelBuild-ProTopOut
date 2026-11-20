/**
 * The Model in the sheet viewer (SteelBuild src/modules/model/viewer.jsx): the Framing tab of the side panel, the read
 * pieces drawn over the drawing (click one to select it; drag a selected piece's end to move it, snapped to the
 * sheet's own lines), Draw missed piece, placing a label the reader couldn't place, and the lift weights in "PDF with
 * markups". Every save goes through model.saveRead with the version the change started from.
 *
 * The viewer calls count / click / grab / drag / drop / tool / pdf as plain functions, so the panel and overlay
 * components (which hold the queries) keep the job's latest data in a small module store those functions read.
 */
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/brand/Controls";
import { useRefData } from "@/lib/ref";
import { errMsg, fmtDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Pt, ViewerCtx, ViewerPlugin } from "../drawings/viewer/plugin";
import { MD, REVIEW, STATES, plural, type Line4, type Piece, type PieceFields, type PieceState, type Placing, type ReadData, type ReadRec } from "./domain";
import { dataOf, oldRead, readPage, reviewedOn, useModel, type ModelApi } from "./data";
import { PieceForm } from "./forms";

type Show = "all" | "auto" | "done" | "no";
type Drag = { pid: string; a: Line4; end: [number, number, string] };
type MState = {
  sel?: string | null;
  show?: Show;
  hide?: boolean;
  left?: boolean;
  place?: Placing | null;
  draft?: { a: Line4; place: Placing | null } | null;
  edit?: string | null;
  drag?: Drag | null;
  count?: number | null;
};
type Handle = { pid: string; i: 0 | 1; a: Line4 };
const S = (v: ViewerCtx) => v.state as MState;

/** colours by review state: needs review amber, accepted or fixed green, added by hand blue, rejected grey */
const COLOR_TOKEN: Record<PieceState, string> = { auto: "--tp-amber", ok: "--tp-green", edit: "--tp-green", add: "--tp-blue", no: "--tp-muted" };
const COLOR: Record<PieceState, string> = { auto: "var(--tp-amber)", ok: "var(--tp-green)", edit: "var(--tp-green)", add: "var(--tp-blue)", no: "var(--tp-muted)" };
// PDF export expects concrete hex colors. These theme tokens are hex in both app themes.
const pdfColor = (st: PieceState) => typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(COLOR_TOKEN[st]).trim();

// ---------- the store the plain functions read ----------
type Live = Pick<ModelApi, "recs" | "cfg" | "canEdit" | "me" | "save" | "sheets">;
const live = new Map<number, Live>();
const lineIdx = new Map<string, Float64Array>();
const keyOf = (v: ViewerCtx) => MD.idOf(v.sheetId, v.rev, v.page);
const recOf = (v: ViewerCtx): ReadRec | null => live.get(v.projectId)?.recs.find(r => r.key === keyOf(v)) ?? null;
const canEditV = (v: ViewerCtx) => !!live.get(v.projectId)?.canEdit;
const who = (v: ViewerCtx) => ({ by: live.get(v.projectId)?.me, at: new Date().toISOString() });
const box = (a: readonly number[]) => ({ x: Math.min(a[0], a[2]), y: Math.min(a[1], a[3]), w: Math.abs(a[2] - a[0]) + 1, h: Math.abs(a[3] - a[1]) + 1 });
const pad = (b: { x: number; y: number; w: number; h: number }, k = 60) => ({ x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k });
const r2 = (n: number) => Math.round(n * 100) / 100;
const shown = (rec: ReadData, show: Show) => rec.pcs.filter(p => (show === "auto" ? p.st === "auto" : show === "done" ? MD.accepted(p) : show === "no" ? p.st === "no" : true));
const weightText = (p: Piece, cfg: Live["cfg"]) => {
  const w = MD.weight(p, cfg);
  return w ? (w.approx ? "≈ " : "") + MD.lb(w.lb) : p.k === "joist" ? "weight: add the joist list" : "weight unknown";
};

/** Snapping: a point goes onto the sheet's own lines (a line end first, else the nearest point on a line) within 10 screen pixels. */
function snapTo(v: ViewerCtx, p: Pt, from: readonly number[] | null): [number, number, string] {
  const L = lineIdx.get(keyOf(v));
  if (!L) return [p.x, p.y, ""];
  const q = MD.snap(L, [p.x, p.y], 10 / (v.scale || 1), from);
  return [r2(q[0]), r2(q[1]), q[2]];
}

/** Save a change to this page's read (or start one). */
async function apply(v: ViewerCtx, rec: ReadRec | null, data: ReadData, summary: string) {
  const L = live.get(v.projectId);
  if (!L) return false;
  return L.save(rec ? rec : { sid: v.sheetId, rev: v.rev, pg: v.page, version: 0, v: 0 }, data, summary);
}

/** The panel's and overlay's shared hook: the job's data, kept in the store, the count kept in the viewer, the lines loaded. */
function useLive(v: ViewerCtx) {
  const api = useModel(v.projectId);
  const key = keyOf(v);
  useEffect(() => {
    live.set(v.projectId, api);
  });
  const rec = api.recs.find(r => r.key === key) ?? null;
  const n = rec ? rec.pcs.filter(p => p.st === "auto").length || null : null;
  useEffect(() => {
    if (S(v).count !== n) v.setState({ count: n });
  }, [n, v]);
  useEffect(() => {
    if (!api.canEdit || !v.pdfPage || lineIdx.has(key)) return;
    let gone = false;
    v.segs()
      .then(s => {
        if (!gone) lineIdx.set(key, MD.lineIndex(s));
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [api.canEdit, v.pdfPage, key, v]);
  return { api, rec };
}

// ---------- the side panel ----------
const P = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("px-3 text-[12px] leading-relaxed text-muted-foreground", className)}>{children}</p>;

function FramingPanel({ v }: { v: ViewerCtx }) {
  const { api, rec } = useLive(v);
  const { userName } = useRefData();
  const M = S(v),
    can = api.canEdit;
  const [reading, setReading] = useState(false);
  const [again, setAgain] = useState(false);
  const x = api.sheets.find(s => s.id === v.sheetId);

  const readThis = async () => {
    if (!v.pdfPage) return;
    setAgain(false);
    setReading(true);
    try {
      const r = await readPage(v.pdfPage, v.page, x?.title || "", oldRead(api.recs, v.sheetId, v.page));
      if (!r) return void toast.error(v.sheetNumber + ": no text in the drawing (a scan or an image), so its framing can’t be read. Draw its pieces by hand.");
      const ok = await api.save(rec ?? { sid: v.sheetId, rev: v.rev, pg: v.page, version: 0 }, r.data, "read framing of " + v.sheetNumber + ": " + plural(r.pieces, "piece"), { fresh: true });
      if (ok) {
        v.setState({ sel: null, draft: null, edit: null });
        toast.success(v.sheetNumber + " Rev " + v.rev + ": " + plural(r.pieces, "piece") + " read. Each needs review: check them on the drawing.");
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setReading(false);
    }
  };
  const addDrawn = async (f: PieceFields) => {
    const d = M.draft;
    if (!d) return;
    const ch = REVIEW.add(rec ? dataOf(rec) : null, { a: d.a, w: v.w, h: v.h, ppf: 0, place: d.place }, f, "h" + Math.random().toString(36).slice(2, 10), who(v));
    if ("error" in ch) return void toast.error(ch.error);
    if (await apply(v, rec, ch.data, ch.summary)) {
      v.setState({ draft: null, sel: ch.piece.id });
      toast.success(MD.pieceName(ch.piece) + " added" + (ch.piece.len ? "." : " — this page has no scale, so its length is unknown."));
    }
  };
  const drawHint = (
    <P>
      Choose <b>Draw missed piece</b> in the toolbar, press at one end of the piece and drag to the other; it snaps to the drawing’s lines.
    </P>
  );
  const draftForm = M.draft && (
    <PieceForm
      title={M.draft.place ? "Place " + ([M.draft.place.mark, M.draft.place.label].filter(Boolean).join(" ") || "label") : "Add missed piece"}
      sub={"Drawn on the sheet · " + (rec?.ppf ? MD.feet(MD.lenOf(M.draft.a, rec.ppf)) : "no scale: length unknown")}
      init={{ k: M.draft.place?.k ?? "beam", mark: M.draft.place?.mark ?? "", size: M.draft.place?.label ?? "" }}
      saveLabel="Add piece"
      onSave={addDrawn}
      onCancel={() => v.setState({ draft: null })}
    />
  );

  if (api.loading) return <P className="py-3">Loading framing…</P>;
  if (!rec)
    return (
      <div className="flex flex-col gap-2.5 py-3">
        <P>{reading ? "Reading the framing on " + v.sheetNumber + "…" : "The framing on " + v.sheetNumber + " Rev " + v.rev + (v.page > 1 ? " page " + v.page : "") + " hasn’t been read."}</P>
        <P>
          The reader suggests joists and beams — mark, size, length — from the drawing’s own lines and text, in this browser. Every piece needs review before it counts. It reads joist placement plans and
          fabricators’ erection plans; design sheets, stair plans and scans need pieces drawn by hand.
        </P>
        {!v.pdfPage && <P>This revision has only a preview image: attach its PDF to read it.</P>}
        {can && v.pdfPage && (
          <div className="px-3">
            <Button size="sm" onClick={readThis} disabled={reading}>
              {reading ? "Reading…" : "Read framing"}
            </Button>
          </div>
        )}
        {can && drawHint}
        {draftForm}
        {!can && <P>Only editors can read and review framing.</P>}
      </div>
    );

  const n = (k: Show) => (k === "all" ? rec.pcs.length : shown(rec, k).length);
  const show = M.show || "all",
    list = shown(rec, show),
    sel = rec.pcs.find(p => p.id === M.sel) || null,
    left = rec.left.filter(u => !/by others/.test(u.note));
  const pick = (p: Piece) => {
    v.setState({ sel: p.id, edit: null });
    v.zoomTo(pad(box(p.a)));
  };
  const review = async (ids: string[], st: "ok" | "no" | "auto") => {
    const ch = REVIEW.setState(dataOf(rec), ids, st, who(v));
    if (ch && (await apply(v, rec, ch.data, ch.summary))) toast.success(ch.n === 1 ? ch.summary + "." : ch.summary.replace(":", "") + ".");
  };
  const fix = async (f: PieceFields) => {
    if (!sel) return;
    const ch = REVIEW.fix(dataOf(rec), sel.id, f, who(v));
    if (ch && (await apply(v, rec, ch.data, ch.summary))) {
      v.setState({ edit: null });
      toast.success(MD.pieceName({ mark: f.mark.toUpperCase(), size: f.size.toUpperCase() }) + " saved.");
    }
  };
  const chip = (k: Show, l: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={show === k}
      onClick={() => v.setState({ show: k })}
      className={cn("rounded-[3px] border px-2 py-0.5 text-[11px] font-medium", show === k ? "border-[var(--tp-accent)] bg-[var(--tp-accent-soft)]" : "border-[var(--tp-rule)] bg-[var(--tp-paper)]")}
    >
      {l}
      {k === "all" ? "" : " · " + n(k)}
    </button>
  );
  const reviewed = reviewedOn(api.recs, v.sheetId, v.rev);
  return (
    <div className="flex flex-col gap-2 py-3">
      <P>
        {plural(rec.pcs.length, "piece")} · {n("auto")} need review · {n("done")} accepted{n("no") ? " · " + n("no") + " rejected" : ""}. {rec.v ? "Read " : "Started "}
        {rec.at ? fmtDateShort(rec.at.slice(0, 10)) : ""}
        {rec.by ? " by " + userName(rec.by) : ""}. {rec.ppf ? "Scale " + MD.scaleName(rec.ppf) + (rec.sl ? ", " + rec.sl : "") + "." : "No scale found: lengths unknown."}
      </P>
      {rec.aside.length > 0 && <P>{plural(rec.aside.length, "piece")} in a detail or section on this sheet were left out of the plan.</P>}
      <div className="flex flex-wrap gap-1.5 px-3">
        {can && n("auto") > 0 && (
          <ConfirmButton
            variant="default"
            title={"Accept " + plural(n("auto"), "piece") + " on " + v.sheetNumber + " Rev " + v.rev + "?"}
            body="Only accept what you have checked on the drawing: about one piece in twenty the reader suggests is wrong. Accepted pieces go into the piece lists and lift weights with your name."
            confirmLabel="Accept all"
            onConfirm={() => void review(rec.pcs.filter(p => p.st === "auto").map(p => p.id), "ok")}
          >
            Accept all {n("auto")}
          </ConfirmButton>
        )}
        {can && rec.v > 0 && v.pdfPage && (
          <Button variant="outline" size="sm" disabled={reading} onClick={() => (reviewed ? setAgain(true) : void readThis())}>
            {reading ? "Reading…" : "Read again"}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => v.setState({ hide: !M.hide })}>
          {M.hide ? "Show on drawing" : "Hide on drawing"}
        </Button>
      </div>
      {again && (
        <div className="mx-3 flex flex-col gap-2 border border-[var(--tp-amber)] bg-[var(--tp-amber-soft)] p-2.5 text-[12px]">
          <span>
            {plural(reviewed, "piece")} on this revision {reviewed === 1 ? "was" : "were"} already reviewed. Reading again replaces them all with new suggestions that need review.
          </span>
          <span className="flex gap-2">
            <Button size="sm" onClick={readThis}>
              Read again
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAgain(false)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
      {can && (M.place ? <P>Place {[M.place.mark, M.place.label].filter(Boolean).join(" ") || "the label"}: choose <b>Draw missed piece</b> in the toolbar and draw it on its line.</P> : drawHint)}
      {draftForm}
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1 px-3">
        {chip("all", "All")}
        {chip("auto", "Needs review")}
        {chip("done", "Accepted")}
        {chip("no", "Rejected")}
      </div>
      {sel &&
        (M.edit === sel.id ? (
          <PieceForm title="Fix piece" sub={v.sheetNumber + " Rev " + v.rev + " · " + MD.feet(sel.len)} init={{ k: sel.k, mark: sel.mark, size: sel.size, note: sel.note }} saveLabel="Save piece" onSave={fix} onCancel={() => v.setState({ edit: null })} />
        ) : (
          <div className="mx-3 flex flex-col gap-1.5 border border-[var(--tp-rule)] bg-[var(--tp-paper)] p-2.5 text-[12px]">
            <span className="num text-[13px] font-semibold">{MD.pieceName(sel)}</span>
            <span>{(sel.k === "joist" ? "Joist" : "Beam") + " · " + MD.feet(sel.len) + " · " + weightText(sel, api.cfg)}</span>
            {sel.ends.some(e => e.length) && <span className="text-muted-foreground">Ends at {sel.ends.map(e => (e.length ? e.filter(Boolean).join(", ") : "—")).join(" and ")}</span>}
            <span className="font-semibold" style={{ color: COLOR[sel.st] }}>
              {STATES[sel.st]}
              {sel.by && sel.st !== "auto" ? " · " + userName(sel.by) : ""}
              {sel.via === "leader" ? " · found through a leader line" : ""}
            </span>
            {sel.note && <span>{sel.note}</span>}
            {can && !M.hide && <span className="text-muted-foreground">Drag an end on the drawing to move it.</span>}
            {can && (
              <span className="flex flex-wrap gap-3">
                {!MD.accepted(sel) && (
                  <button type="button" className="font-medium text-[var(--tp-green)] hover:underline" onClick={() => void review([sel.id], "ok")}>
                    Accept
                  </button>
                )}
                {sel.st !== "no" && (
                  <button type="button" className="font-medium text-[var(--tp-red-strong)] hover:underline" onClick={() => void review([sel.id], "no")}>
                    Reject
                  </button>
                )}
                {sel.st !== "auto" && sel.via !== "hand" && (
                  <button type="button" className="hover:underline" onClick={() => void review([sel.id], "auto")}>
                    Needs review
                  </button>
                )}
                <button type="button" className="hover:underline" onClick={() => v.setState({ edit: sel.id })}>
                  Fix
                </button>
              </span>
            )}
          </div>
        ))}
      <div role="listbox" aria-label="Pieces" className="flex flex-col">
        {list.length ? (
          list.map(p => {
            const w = MD.weight(p, api.cfg),
              on = p.id === M.sel;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => pick(p)}
                className={cn("flex w-full items-baseline justify-between gap-2 border-l-[3px] px-3 py-1.5 text-left", on ? "bg-[var(--tp-accent-soft)]" : "hover:bg-[var(--tp-bone)]")}
                style={{ borderLeftColor: on ? "var(--tp-accent)" : COLOR[p.st] }}
              >
                <span className={cn("num text-[12px] font-semibold", p.st === "no" && "text-muted-foreground line-through")}>{MD.pieceName(p)}</span>
                <span className="num whitespace-nowrap text-[11px] text-muted-foreground">
                  {MD.feet(p.len)}
                  {w ? " · " + (w.approx ? "≈" : "") + Math.round(w.lb).toLocaleString("en-US") + " lb" : ""}
                </span>
              </button>
            );
          })
        ) : (
          <P>{show === "all" ? "No pieces on this page." : "None."}</P>
        )}
      </div>
      {left.length > 0 && (
        <div>
          <button type="button" aria-expanded={!!M.left} onClick={() => v.setState({ left: !M.left })} className="px-3 py-1.5 text-[12px] font-semibold">
            {(M.left ? "▾ " : "▸ ") + plural(left.length, "label") + " not placed"}
          </button>
          {M.left && (
            <>
              <P>Sizes and marks the reader found without a line it could match. Look at each; if it is a real piece, Place draws it on its line.</P>
              {left.map((u, i) => {
                const at = u.x || u.y,
                  b = { x: u.x - 30, y: u.y - 30, w: 60, h: 40 };
                return (
                  <div key={i} className="flex items-baseline gap-2.5 px-3 py-1">
                    <button type="button" disabled={!at} onClick={() => v.zoomTo(pad(b, 120))} className="num min-w-0 flex-1 text-left text-[12px]">
                      {[u.mark, u.label].filter(Boolean).join(" ")}
                      {u.note ? " · " + u.note : ""}
                    </button>
                    {can && at ? (
                      <button
                        type="button"
                        className="text-[12px] text-[var(--tp-accent-ink)] hover:underline"
                        onClick={() => {
                          v.setState({ place: { label: u.label, mark: u.mark, k: u.k, x: u.x, y: u.y }, sel: null });
                          v.zoomTo(pad(b, 120));
                        }}
                      >
                        Place
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {!can && <P>Only editors can review framing.</P>}
    </div>
  );
}

// ---------- over the drawing ----------
function FramingOverlay({ v }: { v: ViewerCtx }) {
  const { api, rec } = useLive(v);
  const M = S(v);
  if (!rec || M.hide) return null;
  const k = v.scale || 1,
    sw = 2.4 / k,
    fs = 11 / k,
    hs = 7 / k,
    can = api.canEdit;
  const lineOf = (p: Piece) => (M.drag && M.drag.pid === p.id ? M.drag.a : p.a);
  const sel = rec.pcs.find(p => p.id === M.sel);
  const snapMark = (q: [number, number, string] | null | undefined) =>
    q && q[2] ? (
      q[2] === "end" ? (
        <rect x={q[0] - hs} y={q[1] - hs} width={hs * 2} height={hs * 2} fill="none" stroke="var(--tp-accent)" strokeWidth={1.6 / k} />
      ) : (
        <circle cx={q[0]} cy={q[1]} r={hs} fill="none" stroke="var(--tp-accent)" strokeWidth={1.6 / k} />
      )
    ) : null;
  return (
    <g>
      {rec.pcs.map(p => {
        const on = p.id === M.sel,
          c = COLOR[p.st],
          a = lineOf(p);
        return (
          <g key={p.id}>
            <line x1={a[0]} y1={a[1]} x2={a[2]} y2={a[3]} stroke={c} strokeOpacity={on ? 1 : 0.75} strokeWidth={on ? sw * 2.2 : sw} strokeLinecap="round" strokeDasharray={p.st === "no" ? 6 / k + " " + 4 / k : undefined} />
            {(on || k > 0.9) && (
              <text x={(a[0] + a[2]) / 2} y={(a[1] + a[3]) / 2 - 5 / k} fontSize={fs} fill={c} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" stroke="var(--tp-paper)" strokeWidth={3 / k} paintOrder="stroke">
                {MD.pieceName(p)}
              </text>
            )}
          </g>
        );
      })}
      {sel &&
        can &&
        (() => {
          const a = lineOf(sel);
          return [
            [a[0], a[1]],
            [a[2], a[3]],
          ].map((q, i) => <rect key={"h" + i} x={q[0] - hs / 1.4} y={q[1] - hs / 1.4} width={hs * 1.43} height={hs * 1.43} fill="var(--tp-paper)" stroke="var(--tp-accent)" strokeWidth={1.6 / k} />);
        })()}
      {M.drag && snapMark(M.drag.end)}
      {M.draft && <line x1={M.draft.a[0]} y1={M.draft.a[1]} x2={M.draft.a[2]} y2={M.draft.a[3]} stroke={COLOR.add} strokeWidth={sw} strokeDasharray={4 / k + " " + 3 / k} />}
      {M.left &&
        rec.left
          .filter(u => (u.x || u.y) && !/by others/.test(u.note))
          .map((u, i) => <circle key={"u" + i} cx={u.x} cy={u.y} r={8 / k} fill="none" stroke="var(--tp-red-strong)" strokeWidth={1.6 / k} />)}
    </g>
  );
}

// ---------- the plugin ----------
export const modelViewerPlugin: ViewerPlugin = {
  id: "model",
  label: "Framing",
  count: v => {
    const c = S(v).count;
    if (c !== undefined) return c;
    const rec = recOf(v);
    return rec ? rec.pcs.filter(p => p.st === "auto").length || null : null;
  },
  panel: v => <FramingPanel v={v} />,
  overlay: v => <FramingOverlay v={v} />,
  tool: {
    label: "Draw missed piece",
    may: v => canEditV(v) && v.w > 0,
    snap: (v, p, from) => {
      const q = snapTo(v, p, from ? [from.x, from.y] : null);
      return { x: q[0], y: q[1] };
    },
    // the press and the release are the piece's ends; the panel asks what it is
    done: (v, a, b) => {
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
      v.setState({ draft: { a: [r2(a.x), r2(a.y), r2(b.x), r2(b.y)], place: S(v).place ?? null }, place: null, sel: null, edit: null });
    },
  },
  // a click on the drawing: the piece under it is selected and shown on the Framing tab
  click: (v, p) => {
    const rec = recOf(v),
      M = S(v);
    if (!rec || M.hide) return false;
    const q = MD.pieceAt(rec.pcs, [p.x, p.y], 8 / (v.scale || 1));
    if (!q) {
      if (M.sel) v.setState({ sel: null, edit: null });
      return false;
    }
    v.setState({ sel: q.id, edit: null });
    return true;
  },
  // moving an end of the selected piece: pressed on one of its handles, dragged (snapped), released
  grab: (v, p): Handle | null => {
    const rec = recOf(v),
      M = S(v);
    if (!rec || M.hide || !M.sel || !canEditV(v)) return null;
    const pc = rec.pcs.find(q => q.id === M.sel);
    if (!pc) return null;
    const tol = 10 / (v.scale || 1),
      a = pc.a,
      i = [
        [a[0], a[1]],
        [a[2], a[3]],
      ].findIndex(q => Math.hypot(q[0] - p.x, q[1] - p.y) < tol);
    return i < 0 ? null : { pid: pc.id, i: i as 0 | 1, a: [...a] as Line4 };
  },
  drag: (v, handle, p) => {
    const h = handle as Handle,
      other = h.i ? [h.a[0], h.a[1]] : [h.a[2], h.a[3]],
      q = snapTo(v, p, other),
      a = [...h.a] as Line4;
    a[h.i * 2] = q[0];
    a[h.i * 2 + 1] = q[1];
    v.setState({ drag: { pid: h.pid, a, end: q } });
  },
  drop: (v, handle, _p, moved) => {
    const h = handle as Handle,
      d = S(v).drag;
    v.setState({ drag: null });
    if (!moved || !d || d.pid !== h.pid || Math.hypot(d.a[0] - h.a[0], d.a[1] - h.a[1]) + Math.hypot(d.a[2] - h.a[2], d.a[3] - h.a[3]) <= 0.01) return;
    const rec = recOf(v);
    if (!rec) return;
    const ch = REVIEW.moveEnd(dataOf(rec), h.pid, d.a, who(v));
    if (!ch) return void toast.error("That piece was removed by someone else.");
    const name = MD.pieceName(rec.pcs.find(q => q.id === h.pid) || {});
    void apply(v, rec, ch.data, ch.summary).then(ok => ok && toast.success(name + (rec.ppf ? " is now " + MD.feet(ch.len) + "." : " moved.")));
  },
  // "PDF with markups": each live piece drawn in with its mark, size and weight, and a list of them heaviest first
  pdf: v => {
    const rec = recOf(v),
      L = live.get(v.projectId);
    if (!rec || !L) return null;
    const cfg = L.cfg,
      pcs = rec.pcs.filter(MD.live).map(p => ({ p, w: MD.weight(p, cfg) }));
    if (!pcs.length) return null;
    const lab = ({ p, w }: (typeof pcs)[number]) => MD.pieceName(p) + (w ? "  " + (w.approx ? "~" : "") + Math.round(w.lb).toLocaleString("en-US") + " lb" : "");
    return {
      lines: pcs.map(o => ({ a: { x: o.p.a[0], y: o.p.a[1] }, b: { x: o.p.a[2], y: o.p.a[3] }, color: pdfColor(o.p.st), width: 2 })),
      labels: pcs.map(o => ({ at: { x: (o.p.a[0] + o.p.a[2]) / 2, y: (o.p.a[1] + o.p.a[3]) / 2 }, text: lab(o), color: pdfColor(o.p.st) })),
      listTitle: "Pieces and lift weights - " + v.sheetNumber + " Rev " + v.rev,
      list: [
        "Bare steel weights from nominal lb/ft" + (cfg.allow ? " plus " + cfg.allow + "% allowance" : "") + "; joists from the joist list. Not a lift plan. ~ = approximate (HSS, angles).",
        ...[...pcs].sort((q, r) => ((r.w && r.w.lb) || 0) - ((q.w && q.w.lb) || 0)).map(o => lab(o) + "  " + MD.feet(o.p.len) + (o.p.st === "auto" ? "  (needs review)" : "")),
      ],
    };
  },
};
