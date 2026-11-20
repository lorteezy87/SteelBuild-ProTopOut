/**
 * Model tab sections (SteelBuild src/modules/model/render.jsx and view.jsx): Sheets (what has been read, reading it),
 * Pieces (every piece of the current reads with its review), Lift list (heaviest first), Totals (by size and by sheet)
 * and Progress (by level and sequence).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenCheck, ExternalLink, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState, Panel } from "@/components/ks/Layout";
import { SimpleSelect } from "@/components/ks/Controls";
import { Pill } from "@/components/ks/Status";
import { cn } from "@/lib/utils";
import { fmtDateShort } from "@/lib/format";
import { MD, STATES, elevText, plural, type PieceState, type ReadRec, type Row, type Settings, type SheetLite, type SheetTotal, type SizeTotal } from "./domain";
import { MS } from "./space";
import { PieceBulkBar } from "./PieceBulkBar";
import { pieceSelection, togglePieceSelection, type PieceBulkApi } from "./bulk";

const num = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const tons = (lb: number) => (lb ? num(lb / 2000, 1) : "—");
export const Note = ({ children }: { children: ReactNode }) => <p className="max-w-[760px] text-[12px] leading-relaxed text-muted-foreground">{children}</p>;

const ST_TONE: Record<PieceState, "amber" | "green" | "blue" | "gray"> = { auto: "amber", ok: "green", edit: "green", add: "blue", no: "gray" };
export const ReviewPill = ({ st }: { st: PieceState }) => (
  <Pill tone={ST_TONE[st]} dot>
    {STATES[st]}
  </Pill>
);

// ---------- Sheets ----------
export type SheetLine = {
  key: number;
  x: SheetLite;
  rev: number | null;
  recs: ReadRec[];
  state: string;
  tone: "amber" | "green" | "gray" | "blue";
  pdf: boolean;
  old: number | null;
  reviewed: number;
};
export function sheetLines(sheets: SheetLite[], recs: ReadRec[]): SheetLine[] {
  const { reads, unread } = MD.reads(sheets, recs);
  const by = new Map<number, SheetLine>();
  reads.forEach(({ x, r }) => {
    const o = by.get(x.id) || { key: x.id, x, rev: r.rev, recs: [], state: "", tone: "green", pdf: !!MD.curRev(x)?.pdf, old: null, reviewed: 0 };
    o.recs.push(r);
    by.set(x.id, o);
  });
  const out: SheetLine[] = [...by.values()].map(o => {
    const pcs = o.recs.flatMap(r => r.pcs),
      todo = pcs.filter(p => p.st === "auto").length;
    return { ...o, state: plural(pcs.filter(MD.live).length, "piece") + (todo ? " · " + todo + " to review" : " · reviewed"), tone: todo ? ("amber" as const) : ("green" as const), reviewed: pcs.filter(p => p.st !== "auto").length };
  });
  unread.forEach(u =>
    out.push({
      key: u.x.id,
      x: u.x,
      rev: u.cur.n,
      recs: [],
      state: !u.pdf ? "Preview image only — attach the PDF to read it" : u.old != null ? "Rev " + u.old + " was read; Rev " + u.cur.n + " is current" : "Not read",
      tone: !u.pdf ? "gray" : u.old != null ? "amber" : "blue",
      pdf: u.pdf,
      old: u.old,
      reviewed: 0,
    })
  );
  return out.sort((a, b) => a.x.sheet.localeCompare(b.x.sheet, undefined, { numeric: true }));
}

export function SheetsSection({
  lines,
  seqName,
  canEdit,
  busy,
  onRead,
  onOpen,
  onLevel,
}: {
  lines: SheetLine[];
  seqName: Map<string, string>;
  canEdit: boolean;
  busy: Set<number>;
  onRead: (l: SheetLine) => void;
  onOpen: (l: SheetLine) => void;
  onLevel: (l: SheetLine, r: ReadRec) => void;
}) {
  if (!lines.length) return <EmptyState icon={<BookOpenCheck className="size-6" />} title="No sheets with a drawing on this job yet" body="Add the erection and joist drawings to the register, then read their framing here." />;
  return (
    <>
      <Note>
        Read a sheet to get its pieces: mark, size and length from the drawing’s own lines and text, each needing review in the viewer. Joist placement plans and fabricators’ erection plans read
        well; design sheets, stair plans and scans don’t, and their pieces can be drawn by hand in the viewer. Reading happens in this browser — the drawing doesn’t leave it.
      </Note>
      <div className="ks-panel overflow-x-auto">
        <table className="ks-table min-w-[820px]">
          <thead>
            <tr>
              <th>Sheet</th>
              <th>Title</th>
              <th>Sequence</th>
              <th className="right">Rev</th>
              <th>Framing</th>
              <th>Level · top of steel</th>
              <th>Read</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const r0 = l.recs[0];
              return (
                <tr key={l.key} className={cn(l.tone === "gray" && "text-muted-foreground")}>
                  <td>
                    <button type="button" className="num font-semibold hover:underline" onClick={() => onOpen(l)}>
                      {l.x.sheet}
                    </button>
                  </td>
                  <td className="max-w-[260px] truncate">{l.x.title}</td>
                  <td className="text-[12px]">{l.x.seq ? seqName.get(l.x.seq) || "—" : "—"}</td>
                  <td className="right num">{l.rev ?? "—"}</td>
                  <td>
                    <Pill tone={l.tone}>{l.state}</Pill>
                  </td>
                  <td className="whitespace-nowrap text-[12px]">
                    {r0 ? (
                      <span className="inline-flex items-baseline gap-2">
                        <span className={cn(!r0.lvl && r0.tos == null && "text-muted-foreground")}>{[r0.lvl, r0.tos != null ? "T.O.S. " + elevText(r0.tos) : ""].filter(Boolean).join(" · ") || "Not set"}</span>
                        {canEdit && (
                          <button type="button" className="text-[var(--ks-accent-ink)] hover:underline" onClick={() => onLevel(l, r0)}>
                            Set
                          </button>
                        )}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="num whitespace-nowrap text-[12px] text-muted-foreground">{r0 && r0.at ? fmtDateShort(r0.at.slice(0, 10)) : ""}</td>
                  <td className="whitespace-nowrap text-right">
                    <span className="inline-flex items-center gap-3">
                      {canEdit && l.pdf && (busy.has(l.key) ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          Reading…
                        </span>
                      ) : (
                        <button type="button" className="text-[12px] font-medium text-[var(--ks-accent-ink)] hover:underline" onClick={() => onRead(l)}>
                          {l.recs.length ? "Read again" : "Read framing"}
                        </button>
                      ))}
                      <button type="button" className="inline-flex items-center gap-1 text-[12px] hover:underline" onClick={() => onOpen(l)}>
                        Open in viewer <ExternalLink className="size-3" />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Pieces and Lift list ----------
export type Filter = { f: "all" | "auto" | "done"; q: string; seq: string; kind: "" | "beam" | "joist" };
export const filterRows = (rows: Row[], F: Filter) => {
  const q = F.q.trim().toUpperCase();
  return rows.filter(
    r =>
      (F.f === "auto" ? r.st === "auto" : F.f === "done" ? MD.accepted(r) : true) &&
      (!F.seq || (F.seq === "none" ? !r.seq : r.seq === F.seq)) &&
      (!F.kind || r.k === F.kind) &&
      (!q || (r.mark + " " + r.size + " " + r.sheet).toUpperCase().includes(q))
  );
};
export function Filters({ F, set, seqs, seqName }: { F: Filter; set: (p: Partial<Filter>) => void; seqs: string[]; seqName: Map<string, string> }) {
  const chip = (k: Filter["f"], l: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={F.f === k}
      onClick={() => set({ f: k })}
      className={cn("rounded-[3px] border px-2.5 py-1 text-[12px] font-medium", F.f === k ? "border-[var(--ks-accent)] bg-[var(--ks-accent-soft)]" : "border-[var(--ks-rule)] bg-[var(--ks-paper)]")}
    >
      {l}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip("all", "All")}
      {chip("auto", "Needs review")}
      {chip("done", "Accepted")}
      <div className="w-44">
        <SimpleSelect
          size="sm"
          value={F.kind || "any"}
          onChange={v => set({ kind: v === "any" || !v ? "" : (v as Filter["kind"]) })}
          options={[
            { value: "any", label: "Beams and joists" },
            { value: "beam", label: "Beams" },
            { value: "joist", label: "Joists" },
          ]}
        />
      </div>
      {seqs.length > 0 && (
        <div className="w-52">
          <SimpleSelect
            size="sm"
            value={F.seq || "any"}
            onChange={v => set({ seq: v === "any" || !v ? "" : v })}
            options={[{ value: "any", label: "All sequences" }, ...seqs.map(s => ({ value: s, label: seqName.get(s) || "Sequence " + s })), { value: "none", label: "No sequence" }]}
          />
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search pieces" className="h-8 w-52 bg-[var(--ks-paper)] pl-7" placeholder="Mark, size or sheet" value={F.q} onChange={e => set({ q: e.target.value })} />
      </div>
    </div>
  );
}

const byMark = (a: Row, b: Row) =>
  String(a.mark || a.size).localeCompare(String(b.mark || b.size), undefined, { numeric: true }) || a.sheet.localeCompare(b.sheet, undefined, { numeric: true });

export function PiecesTable({ rows, lift, seqName, onOpen, bulk }: {
  rows: Row[]; lift?: boolean; seqName: Map<string, string>; onOpen: (r: Row) => void;
  bulk?: { api: PieceBulkApi; recs: ReadRec[]; allKeys: string[] };
}) {
  const list = useMemo(() => (lift ? rows.filter(r => r.lb != null).sort((a, b) => b.lb! - a.lb!).slice(0, 200) : rows.slice().sort(byMark)), [rows, lift]);
  const [limit, setLimit] = useState(400);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const anchor = useRef<string | null>(null);
  const visible = list.slice(0, limit);
  const visibleKeys = visible.map(r => r.key);
  const selection = pieceSelection(selected, bulk?.allKeys ?? visibleKeys, visibleKeys);
  const allSelected = visible.length > 0 && selection.keys.length === visible.length;
  useEffect(() => {
    const live = new Set(bulk?.allKeys ?? []);
    setSelected(prev => {
      const next = new Set([...prev].filter(k => live.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [bulk?.allKeys]);
  const clear = () => { setSelected(new Set()); anchor.current = null; };
  return (
    <>
    {!list.length ? <EmptyState title={lift ? "No pieces with a known weight yet" : "No pieces match"} body={lift ? "Beams get a weight from their size; joists need the joist list (Weights)." : undefined} /> : (
    <div className="ks-panel overflow-x-auto">
      <table className="ks-table min-w-[900px]">
        <thead>
          <tr>
            {bulk && <th className="w-10"><Checkbox aria-label="Select all visible pieces" checked={allSelected ? true : selection.keys.length ? "indeterminate" : false} disabled={saving} onCheckedChange={v => {
              const on = v === true;
              setSelected(prev => { const next = new Set(prev); for (const key of visibleKeys) { if (on) next.add(key); else next.delete(key); } return next; });
              anchor.current = null;
            }} /></th>}
            {lift && <th className="right">Weight (lb)</th>}
            <th>Mark</th>
            <th>Size</th>
            <th>Kind</th>
            <th className="right">Length</th>
            {!lift && <th className="right">Weight (lb)</th>}
            <th>Sheet</th>
            <th>Sequence</th>
            <th>Ends</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => {
            const w = r.lb == null ? "—" : (r.approx ? "≈ " : "") + num(r.lb);
            return (
              <tr key={r.key} className={cn("cursor-pointer", selected.has(r.key) && "is-selected")} onClick={() => onOpen(r)} title="Open on the drawing">
                {bulk && <td onClick={e => e.stopPropagation()}><Checkbox aria-label={"Select " + MD.pieceName(r) + " on " + r.sheet + " Rev " + r.rev + " page " + r.pg} checked={selected.has(r.key)} disabled={saving} onClick={e => {
                  e.stopPropagation();
                  if (saving) return;
                  const on = !selected.has(r.key);
                  const from = e.shiftKey ? anchor.current : null;
                  setSelected(prev => togglePieceSelection(prev, visibleKeys, r.key, on, from));
                  anchor.current = r.key;
                }} onCheckedChange={() => undefined} /></td>}
                {lift && <td className="right num font-semibold">{w}</td>}
                <td className="num font-semibold">{r.mark || "—"}</td>
                <td className="num">{r.size || "—"}</td>
                <td>{r.k === "joist" ? "Joist" : "Beam"}</td>
                <td className="right num">{MD.feet(r.len)}</td>
                {!lift && <td className="right num">{w}</td>}
                <td className="num">{r.sheet + (r.pg > 1 ? " p" + r.pg : "")}</td>
                <td className="text-[12px]">{r.seq ? seqName.get(r.seq) || "—" : "—"}</td>
                <td className="num max-w-[200px] truncate text-[12px] text-muted-foreground">{(r.ends || []).map(e => e.filter(Boolean).join(", ") || "—").join(" – ")}</td>
                <td>
                  <ReviewPill st={r.st} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length > limit && (
        <div className="border-t border-[var(--ks-rule)] px-3 py-2 text-[12px]">
          {num(list.length - limit)} more.{" "}
          <button type="button" className="text-[var(--ks-accent-ink)] hover:underline" onClick={() => setLimit(l => l + 400)}>
            Show more
          </button>
        </div>
      )}
    </div>
    )}
    {bulk && <PieceBulkBar api={bulk.api} recs={bulk.recs} keys={selection.keys} hiddenCount={selection.hidden} onDone={clear} onBusyChange={setSaving} />}
    </>
  );
}

// ---------- Totals ----------
export function TotalsSection({ sizes, sheets, tot }: { sizes: SizeTotal[]; sheets: SheetTotal[]; tot: { tons: number; n: number } }) {
  if (!tot.n) return <EmptyState title="No pieces yet" body="Read the sheets first." />;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="By size">
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>Size</th>
                <th className="right">Pieces</th>
                <th className="right">Total length (ft)</th>
                <th className="right">Weight (lb)</th>
                <th className="right">Tons</th>
                <th className="right">Without a weight</th>
              </tr>
            </thead>
            <tbody>
              {sizes.map(t => (
                <tr key={t.size}>
                  <td className="num font-semibold">{t.size}</td>
                  <td className="right num">{t.n}</td>
                  <td className="right num">{num(t.ft, 1)}</td>
                  <td className="right num">{t.lb ? num(t.lb) : "—"}</td>
                  <td className="right num">{tons(t.lb)}</td>
                  <td className="right num">{t.unknown || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="By sheet">
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>Sheet</th>
                <th className="right">Pieces</th>
                <th className="right">Need review</th>
                <th className="right">Total length (ft)</th>
                <th className="right">Weight (lb)</th>
                <th className="right">Tons</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map(t => (
                <tr key={t.sid}>
                  <td className="num font-semibold">{t.sheet}</td>
                  <td className="right num">{t.n}</td>
                  <td className="right num">{t.review || ""}</td>
                  <td className="right num">{num(t.ft, 1)}</td>
                  <td className="right num">{t.lb ? num(t.lb) : "—"}</td>
                  <td className="right num">{tons(t.lb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="xl:col-span-2">
        <Note>Totals over the pieces not rejected, reviewed or not. {num(tot.tons, 1)} tons where the weight is known.</Note>
      </div>
    </div>
  );
}

// ---------- Progress ----------
export function ProgressSection({ rows, recs, sheets, seqName }: { rows: Row[]; recs: ReadRec[]; sheets: SheetLite[]; seqName: Map<string, string> }) {
  const P = useMemo(() => {
    const lv = new Map(recs.map(r => [r.key, r.lvl])),
      sq = new Map(sheets.map(x => [x.id, x.seq]));
    return MS.progress(
      rows,
      rid => lv.get(rid),
      sid => sq.get(sid),
      q => seqName.get(q) || "Sequence " + q
    );
  }, [rows, recs, sheets, seqName]);
  if (!rows.length) return <EmptyState title="No pieces yet" body="Read the sheets first." />;
  const table = (list: typeof P.byLevel, first: string) => (
    <Panel title={"By " + first.toLowerCase()}>
      <div className="overflow-x-auto">
        <table className="ks-table min-w-[640px]">
          <thead>
            <tr>
              <th>{first}</th>
              <th className="right">Pieces</th>
              <th className="right">Tons</th>
              <th className="right">Accepted</th>
              <th className="right">Accepted tons</th>
              <th className="right">Need review</th>
              <th className="right">Added by hand</th>
              <th className="right">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              <tr key={r.key} className={cn(r.key === "—" && "text-muted-foreground")}>
                <td>{r.label}</td>
                <td className="right num">{r.n}</td>
                <td className="right num">{tons(r.lb)}</td>
                <td className="right num">{r.accepted[0]}</td>
                <td className="right num">{tons(r.accepted[1])}</td>
                <td className="right num">{r.review || ""}</td>
                <td className="right num">{r.added || ""}</td>
                <td className="right num">{r.n ? Math.round((r.accepted[0] / r.n) * 100) + "%" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
  return (
    <div className="flex flex-col gap-4">
      {table(P.byLevel, "Level")}
      {table(P.bySeq, "Sequence")}
      <Note>
        Review progress: pieces accepted, fixed or added by hand against those still needing review, with tons where the weight is known. Levels are set per sheet on the Sheets list; sequences come
        from the register’s erection sequences. (Piece-mark daily logs aren't tracked in this app, so erected / connected / bolted counts are not shown.)
      </Note>
    </div>
  );
}

export const settingsNote = (cfg: Settings) =>
  "Weights: bare steel from the nominal lb/ft in each size" +
  (cfg.allow ? " plus the job’s " + cfg.allow + "% allowance" : "") +
  "; ≈ marks HSS and angles worked out from their dimensions; joists need the joist list (Weights).";

export function ReadAllBar({ progress, onStop }: { progress: { done: number; total: number } | null; onStop: () => void }) {
  if (!progress) return null;
  return (
    <div role="status" className="flex items-center gap-3 border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-3 py-2 text-[13px]">
      <Loader2 className="size-4 animate-spin" />
      Reading {progress.done + 1 > progress.total ? progress.total : progress.done + 1} of {progress.total} sheets…
      <div className="h-1.5 w-40 overflow-hidden bg-[var(--ks-rule)]">
        <div className="h-full bg-[var(--ks-accent)]" style={{ width: (progress.done / Math.max(1, progress.total)) * 100 + "%" }} />
      </div>
      <Button variant="outline" size="sm" onClick={onStop}>
        Stop
      </Button>
    </div>
  );
}
