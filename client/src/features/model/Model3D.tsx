/** Model filters, lazy 3D / Plan view, selection details, legends and placement notes. */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { SimpleSelect } from "@/components/ks/Controls";
import { cn } from "@/lib/utils";
import {
  MD,
  STATES,
  elevText,
  plural,
  type ReadRec,
  type Settings,
  type SheetLite,
} from "./domain";
import { Note } from "./sections";
import { MS, SEL_COLOR, TONES } from "./space";
import {
  PlanView,
  View3D,
  webglOk,
  type CamView,
  type ColorBy,
} from "./View3D";
import { sequenceColor } from "./three/types";

export function Model3D({
  sheets,
  recs,
  cfg,
  seqName,
  openSheet,
  renderBulk,
}: {
  sheets: SheetLite[];
  recs: ReadRec[];
  cfg: Settings;
  seqName: Map<string, string>;
  openSheet: (sheetId: number, opts?: { rev?: number; tab?: "model" }) => void;
  renderBulk?: (keys: string[], clear: () => void) => ReactNode;
}) {
  const [lvl, setLvl] = useState(""),
    [seq, setSeq] = useState(""),
    [done, setDone] = useState(false);
  const [selection, setSelection] = useState<{
    keys: string[];
    multi: boolean;
  }>({ keys: [], multi: false });
  const [cam, setCam] = useState<CamView | null>(null);
  const [noGL, setNoGL] = useState(
    () => typeof document === "undefined" || !webglOk()
  );
  const [mode, setMode] = useState<"3d" | "plan">("3d");
  const [colorBy, setColorBy] = useState<ColorBy>("steel");
  const all = useMemo(() => MS.build(sheets, recs, cfg), [sheets, recs, cfg]);
  const m = useMemo(
    () =>
      lvl || seq || done
        ? MS.build(sheets, recs, cfg, { lvl, seq, done })
        : all,
    [all, sheets, recs, cfg, lvl, seq, done]
  );
  const available = useMemo(
    () => new Set([...m.pieces.map(q => q.key), ...m.cols.map(c => c.key)]),
    [m]
  );
  const selected = useMemo(
    () => selection.keys.filter(key => available.has(key)),
    [selection.keys, available]
  );
  const sel = selected.length === 1 ? selected[0] : null;
  const pieceKeys = useMemo(() => {
    const pieces = new Set(m.pieces.map(q => q.key));
    return selected.filter(key => pieces.has(key));
  }, [m, selected]);
  const view = noGL ? "plan" : mode;
  const q = sel ? m.pieces.find(x => x.key === sel) || null : null;
  const c = sel && !q ? m.cols.find(x => x.key === sel) || null : null;
  const empty = !m.pieces.length && !m.cols.length;
  const clear = useCallback(() => setSelection({ keys: [], multi: false }), []);
  const pick = useCallback(
    (key: string | null, additive = false) => {
      if (!key) return clear();
      setSelection(previous => {
        if (!additive) return { keys: [key], multi: false };
        const keys = previous.keys.filter(k => available.has(k));
        return {
          keys: keys.includes(key)
            ? keys.filter(k => k !== key)
            : [...keys, key],
          multi: true,
        };
      });
    },
    [available, clear]
  );
  const failGL = useCallback(() => setNoGL(true), []);
  const chip = (
    on: boolean,
    label: string,
    run: () => void,
    disabled?: boolean
  ) => (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={run}
      className={cn(
        "rounded-md border px-2.5 py-1 text-[12px] font-medium text-[var(--ks-ink)] transition-colors hover:border-[var(--ks-accent)] focus-visible:outline-2 focus-visible:outline-[var(--ks-accent)] disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "border-[var(--ks-accent)] bg-[var(--ks-accent-soft)]"
          : "border-[var(--ks-rule)] bg-[var(--ks-paper)]"
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-3 text-[var(--ks-ink)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <SimpleSelect
            size="sm"
            value={lvl || "any"}
            onChange={v => {
              setLvl(v === "any" || !v ? "" : v);
              clear();
            }}
            options={[
              { value: "any", label: "All levels" },
              ...all.levels
                .filter(l => l.name)
                .map(l => ({
                  value: l.name,
                  label:
                    l.name + (l.tos != null ? " · " + elevText(l.tos) : ""),
                })),
            ]}
          />
        </div>
        {all.seqs.length > 0 && (
          <div className="w-52">
            <SimpleSelect
              size="sm"
              value={seq || "any"}
              onChange={v => {
                setSeq(v === "any" || !v ? "" : v);
                clear();
              }}
              options={[
                { value: "any", label: "All sequences" },
                ...all.seqs.map(s => ({
                  value: s,
                  label: seqName.get(s) || "Sequence " + s,
                })),
              ]}
            />
          </div>
        )}
        {chip(!done, "All pieces", () => {
          setDone(false);
          clear();
        })}
        {chip(done, "Accepted only", () => {
          setDone(true);
          clear();
        })}
        <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
          Color by
          <select
            aria-label="Color by"
            value={colorBy}
            onChange={e => setColorBy(e.target.value as ColorBy)}
            className="rounded-md border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2 py-1 text-[12px] text-[var(--ks-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ks-accent)]"
          >
            <option value="steel">Steel</option>
            <option value="review">Review state</option>
            <option value="sequence">Sequence</option>
          </select>
        </label>
        <span className="ml-auto inline-flex flex-wrap gap-1.5">
          {chip(view === "3d", "3D", () => setMode("3d"), noGL)}
          {chip(view === "plan", "Plan", () => setMode("plan"))}
          {view === "3d" && (
            <>
              {chip(false, "Fit", () => setCam({ v: "fit", n: Date.now() }))}
              {chip(false, "From above", () =>
                setCam({ v: "top", n: Date.now() })
              )}
              {chip(false, "Angled", () => setCam({ v: "3d", n: Date.now() }))}
            </>
          )}
        </span>
      </div>
      <div className="relative h-[min(560px,68vh)] min-h-[320px] overflow-hidden rounded-lg border border-[var(--ks-rule)] bg-[var(--ks-paper)]">
        {empty ? (
          <div className="grid h-full place-items-center p-6 text-center text-[13px] text-muted-foreground">
            {m.unplaced.length
              ? "No sheet could be placed yet: each needs a scale and grid lines the reader found."
              : "Nothing to show yet: read the sheets first."}
          </div>
        ) : view === "3d" ? (
          <View3D
            model={m}
            sel={sel}
            selected={selected}
            colorBy={colorBy}
            view={cam}
            onPick={pick}
            onNoGL={failGL}
            label={
              "3D model: " +
              plural(m.pieces.length, "piece") +
              ", " +
              plural(m.cols.length, "column")
            }
          />
        ) : (
          <PlanView
            model={m}
            sel={sel}
            selected={selected}
            colorBy={colorBy}
            onPick={pick}
          />
        )}
        {noGL && !empty && (
          <span
            role="status"
            className="pointer-events-none absolute left-2.5 top-2.5 rounded-md border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2 py-1 text-[11px] text-muted-foreground"
          >
            3D unavailable on this device · Plan view shown
          </span>
        )}
        {(q || c) && (
          <div
            role="status"
            className="absolute right-2.5 top-2.5 flex max-h-[calc(100%-80px)] w-[min(300px,calc(100%-20px))] flex-col gap-1.5 overflow-auto rounded-lg border border-[var(--ks-rule)] bg-[var(--ks-paper)] p-3 text-[12px] shadow-md"
          >
            <div className="flex items-baseline justify-between gap-2">
              <b className="num text-[14px]">
                {q
                  ? MD.pieceName(q)
                  : [c!.mark, c!.size].filter(Boolean).join(" ") || "Column"}
              </b>
              <button
                type="button"
                aria-label="Clear selection"
                onClick={clear}
                className="rounded p-1 text-muted-foreground hover:text-[var(--ks-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ks-accent)]"
              >
                <X className="size-4" />
              </button>
            </div>
            {q ? (
              <>
                <span>
                  {(q.k === "joist" ? "Joist" : "Beam") +
                    " · " +
                    MD.feet(q.len) +
                    (q.lb != null ? " · " + MD.lb(q.lb) : "")}
                </span>
                <span>
                  {(q.lvl || "No level") +
                    " · top of steel " +
                    (q.noElev ? "not set" : elevText(q.z)) +
                    " · " +
                    q.sheet +
                    " Rev " +
                    q.rev}
                </span>
                {q.seq && (
                  <span>{seqName.get(q.seq) || "Sequence " + q.seq}</span>
                )}
                <span className="font-semibold">{STATES[q.st]}</span>
                <button
                  type="button"
                  className="self-start text-[var(--ks-accent-ink)] hover:underline"
                  onClick={() => openSheet(q.sid, { rev: q.rev, tab: "model" })}
                >
                  Open in viewer
                </button>
              </>
            ) : (
              <>
                <span>
                  {"Column · " +
                    elevText(c!.z0) +
                    " to " +
                    elevText(c!.z1) +
                    (c!.stub ? " (base not set: 12 ft shown)" : "")}
                </span>
                <span>{(c!.lvl || "No level") + " · " + c!.sheet}</span>
                <button
                  type="button"
                  className="self-start text-[var(--ks-accent-ink)] hover:underline"
                  onClick={() => openSheet(c!.sid, { tab: "model" })}
                >
                  Open in viewer
                </button>
              </>
            )}
          </div>
        )}
        {selection.multi && pieceKeys.length >= 1 && renderBulk ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20">
            <div className="pointer-events-auto">
              {renderBulk(pieceKeys, clear)}
            </div>
          </div>
        ) : (
          selected.length > 1 && (
            <div
              role="status"
              className="absolute bottom-3 left-3 flex items-center gap-3 rounded-md border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-3 py-2 text-[12px] shadow-sm"
            >
              <span>{plural(selected.length, "member")} selected</span>
              <button
                type="button"
                onClick={clear}
                className="text-[var(--ks-accent-ink)] hover:underline"
              >
                Clear
              </button>
            </div>
          )
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {view === "3d"
            ? "Drag to orbit · Right-drag to pan · Scroll to zoom · Double-click to focus"
            : "Click a member to select"}
        </span>
        <span>
          Shift / Ctrl / Cmd-click to multi-select
          {view === "3d"
            ? " · F fit · T top · A angled · Esc clear"
            : " · Esc clear"}
        </span>
      </div>
      <div
        className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]"
        aria-label="Model color legend"
      >
        {colorBy === "review" ? (
          TONES.map(([key, label, token, hex]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <i
                className="inline-block size-3 rounded-sm"
                style={{ background: `var(${token}, ${hex})` }}
              />
              {label}
            </span>
          ))
        ) : colorBy === "sequence" ? (
          <>
            {all.seqs.map(s => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <i
                  className="inline-block size-3 rounded-sm"
                  style={{ background: sequenceColor(s, all.seqs) }}
                />
                {seqName.get(s) || "Sequence " + s}
              </span>
            ))}
            {(m.pieces.some(p => !p.seq) || m.cols.some(c => !c.seq)) && (
              <span className="inline-flex items-center gap-1.5">
                <i
                  className="inline-block size-3 rounded-sm"
                  style={{ background: sequenceColor("", all.seqs) }}
                />
                No sequence
              </span>
            )}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block size-3 rounded-sm"
              style={{ background: "#76818b" }}
            />
            Mill-scale steel
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <i
            className="inline-block size-3 rounded-sm"
            style={{ background: SEL_COLOR[1] }}
          />
          Selected
        </span>
      </div>
      <Note>
        Pieces sit at their sheet’s top-of-steel elevation (set it on the Sheets
        list where the reader didn’t find one); sheets are placed together by
        the grid lines they share. Sections use nominal dimensions, not exact
        AISC profiles. Joist webs, plates, anchors and foundations are
        illustrative, not fabrication or foundation details.
        {m.groups > 1
          ? " Sheets that share no grid lines with the rest are placed apart, to the east."
          : ""}
      </Note>
      {m.noElev.length > 0 && (
        <Note>
          No top-of-steel elevation (shown at 0): {m.noElev.join(", ")}.
        </Note>
      )}
      {m.unplaced.length > 0 && (
        <Note>
          Not placed:{" "}
          {m.unplaced.map(u => u.sheet + " (" + u.why + ")").join(", ")}.
        </Note>
      )}
    </div>
  );
}
