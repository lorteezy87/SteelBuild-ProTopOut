/**
 * The job's Model tab (SteelBuild src/modules/model/view.jsx + render.jsx): framing read from the register's drawings.
 * Sheets (what has been read, reading them), Pieces, Lift list, Totals, 3D model and Progress; CSV export, the job's
 * weights and base. Editing (reading, levels, weights) needs project.edit; the server enforces it too.
 *
 * This app has no piece-mark daily-log stages, so pieces are shown by review state and grouped / filtered by the
 * sheet's erection sequence instead of by the furthest logged erection stage.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, Kpi, Loading, TabStrip } from "@/components/brand/Layout";
import { errMsg } from "@/lib/format";
import { csvCell } from "@shared/drawings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MD, REVIEW, plural, type ReadRec } from "./domain";
import { dataOf, readSheet, useModel } from "./data";
import { LevelDrawer, SettingsDrawer } from "./forms";
import { Model3D } from "./Model3D";
import { PieceBulkBar } from "./PieceBulkBar";
import { Filters, Note, PiecesTable, ProgressSection, ReadAllBar, SheetsSection, TotalsSection, filterRows, settingsNote, sheetLines, type Filter, type SheetLine } from "./sections";

type View = "sheets" | "pieces" | "lift" | "totals" | "model" | "progress";
const VIEWS: { key: View; label: string }[] = [
  { key: "sheets", label: "Sheets" },
  { key: "pieces", label: "Pieces" },
  { key: "lift", label: "Lift list" },
  { key: "totals", label: "Totals" },
  { key: "model", label: "3D model" },
  { key: "progress", label: "Progress" },
];

export type ModelTabProps = { projectId: number; openSheet: (sheetId: number, opts?: { rev?: number; tab?: "model" }) => void };

export default function ModelTab({ projectId, openSheet }: ModelTabProps) {
  const api = useModel(projectId);
  const { sheets, recs, cfg, seqName, canEdit } = api;
  const [view, setView] = useState<View>("sheets");
  const [F, setF] = useState<Filter>({ f: "all", q: "", seq: "", kind: "" });
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [all, setAll] = useState<{ done: number; total: number } | null>(null);
  const stop = useRef(false);
  const [again, setAgain] = useState<SheetLine | null>(null);
  const [level, setLevel] = useState<{ l: SheetLine; r: ReadRec } | null>(null);
  const [weights, setWeights] = useState(false);

  const rows = useMemo(() => MD.rows(sheets, recs, cfg), [sheets, recs, cfg]);
  const rowKeys = useMemo(() => rows.map(r => r.key), [rows]);
  const tot = useMemo(() => MD.totals(rows), [rows]);
  const lines = useMemo(() => sheetLines(sheets, recs), [sheets, recs]);
  const seqs = useMemo(() => [...new Set(rows.map(r => r.seq).filter(Boolean))].sort((a, b) => (seqName.get(a) || a).localeCompare(seqName.get(b) || b, undefined, { numeric: true })), [rows, seqName]);
  const shown = useMemo(() => filterRows(rows, F), [rows, F]);
  const heavy = useMemo(() => rows.filter(r => r.lb != null).sort((a, b) => b.lb! - a.lb!)[0] || null, [rows]);
  const unread = lines.filter(l => !l.recs.length && l.pdf);
  const sheetsRead = lines.filter(l => l.recs.length).length,
    withPdf = lines.filter(l => l.pdf).length;

  if (api.error) return <ErrorState error={api.error} />;
  if (api.loading) return <Loading label="Loading framing…" />;

  const mark = (sid: number, on: boolean) =>
    setBusy(b => {
      const n = new Set(b);
      if (on) n.add(sid);
      else n.delete(sid);
      return n;
    });
  const readOne = async (l: SheetLine, quiet = false) => {
    const cur = MD.curRev(l.x);
    if (!cur) return { ok: false, pieces: 0, why: l.x.sheet + " has no drawing attached yet." };
    mark(l.key, true);
    try {
      const res = await readSheet(api, l.x, cur);
      if (!quiet) {
        if (res.ok)
          toast.success(l.x.sheet + " Rev " + cur.n + ": " + plural(res.pieces, "piece") + " read" + (res.scans.length ? " (page " + res.scans.join(", ") + " is a scan, not read)" : "") + ". Each needs review: check them on the drawing.");
        else toast.error(res.why);
      }
      return res;
    } catch (e) {
      if (!quiet) toast.error(errMsg(e));
      return { ok: false, pieces: 0, why: errMsg(e) };
    } finally {
      mark(l.key, false);
    }
  };
  const onRead = (l: SheetLine) => {
    if (l.reviewed) setAgain(l);
    else void readOne(l);
  };
  const readAll = async () => {
    const todo = unread;
    if (!todo.length) return toast.message("Every sheet with a PDF is read already.");
    stop.current = false;
    let done = 0,
      pieces = 0;
    const failed: string[] = [];
    setAll({ done: 0, total: todo.length });
    for (const l of todo) {
      if (stop.current) break;
      const res = await readOne(l, true);
      if (res.ok) pieces += res.pieces;
      else failed.push(l.x.sheet);
      done++;
      setAll({ done, total: todo.length });
    }
    setAll(null);
    const msg =
      (stop.current ? "Stopped after " : "Read ") +
      plural(done - failed.length, "sheet") +
      ": " +
      plural(pieces, "piece") +
      " to review." +
      (failed.length ? " Not read: " + failed.slice(0, 6).join(", ") + (failed.length > 6 ? "…" : "") + "." : "");
    if (failed.length) toast.error(msg);
    else toast.success(msg);
  };
  const exportCsv = () => {
    const lines = MD.csvRows(rows, s => seqName.get(s) || s).map(r => r.map(csvCell).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pieces " + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const saveLevel = async (r: ReadRec, lvl: string, tos: number | null) => {
    const ch = REVIEW.setLevel(dataOf(r), lvl, tos);
    const ok = await api.save(r, ch.data, ch.summary);
    if (ok) toast.success(level?.l.x.sheet + ": level saved.");
    return ok;
  };
  const openRow = (sid: number, rev: number) => openSheet(sid, { rev, tab: "model" });

  return (
    <div className="flex min-w-0 flex-col gap-4 p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Pieces" value={tot.n.toLocaleString("en-US")} sub="not rejected" />
        <Kpi
          label="Tons"
          value={tot.known ? (Math.round(tot.tons * 10) / 10).toLocaleString("en-US") : "—"}
          sub={tot.known < tot.n ? "of " + tot.known + " with a weight" : "bare steel" + (cfg.allow ? " + " + cfg.allow + "%" : "")}
        />
        <Kpi label="Need review" value={tot.review.toLocaleString("en-US")} tone={tot.review ? "amber" : undefined} sub={tot.n && !tot.review ? "all reviewed" : undefined} />
        <Kpi label="Heaviest pick" value={heavy ? MD.lb(heavy.lb) : "—"} sub={heavy ? MD.pieceName(heavy) + " · " + heavy.sheet : undefined} />
        <Kpi label="Sheets read" value={withPdf ? sheetsRead + "/" + withPdf : "—"} sub="with a PDF" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && unread.length > 0 && !all && (
          <Button size="sm" onClick={readAll}>
            Read all unread ({unread.length})
          </Button>
        )}
        <ReadAllBar progress={all} onStop={() => (stop.current = true)} />
        <span className="ml-auto inline-flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download /> CSV
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setWeights(true)}>
              <Scale /> Weights
            </Button>
          )}
        </span>
      </div>
      <TabStrip tabs={VIEWS.map(v => ({ key: v.key, label: v.label, badge: v.key === "pieces" && tot.review ? <span className="num text-[11px] text-[var(--tp-amber)]">{tot.review}</span> : undefined }))} active={view} onSelect={k => setView(k as View)} />
      {view === "sheets" && (
        <SheetsSection
          lines={lines}
          seqName={seqName}
          canEdit={canEdit}
          busy={busy}
          onRead={onRead}
          onOpen={l => openSheet(l.x.id, { rev: l.rev ?? undefined, tab: "model" })}
          onLevel={(l, r) => setLevel({ l, r })}
        />
      )}
      {(view === "pieces" || view === "lift") && (
        <>
          <Filters F={F} set={p => setF(f => ({ ...f, ...p }))} seqs={seqs} seqName={seqName} />
          {!tot.n ? (
            <Note>No pieces yet: read the sheets first.</Note>
          ) : (
            <PiecesTable rows={shown} lift={view === "lift"} seqName={seqName} onOpen={r => openRow(r.sid, r.rev)} bulk={canEdit ? { api, recs, allKeys: rowKeys } : undefined} />
          )}
          <Note>
            {view === "lift"
              ? "Heaviest first, up to 200. Weights are bare steel" +
                (cfg.allow ? " plus the job’s " + cfg.allow + "% allowance" : "") +
                " from the drawings, before rigging — check them before they go into a lift plan." +
                (rows.some(r => r.lb == null) ? " " + plural(rows.filter(r => r.lb == null).length, "piece") + " without a weight (joists without the joist list, or sizes it can’t work out) are not listed." : "")
              : settingsNote(cfg) + " Click a piece to open it on its drawing."}
            {canEdit && " Select pieces with the checkboxes; Shift-click selects a range. Bulk actions include only visible selections."}
          </Note>
        </>
      )}
      {view === "totals" && <TotalsSection sizes={tot.sizes} sheets={tot.sheets} tot={tot} />}
      {view === "model" && <Model3D sheets={sheets} recs={recs} cfg={cfg} seqName={seqName} openSheet={openSheet} renderBulk={canEdit ? (keys, clear) => <PieceBulkBar api={api} recs={recs} keys={keys} onDone={clear} /> : undefined} />}
      {view === "progress" && <ProgressSection rows={rows} recs={recs} sheets={sheets} seqName={seqName} />}

      <AlertDialog open={!!again} onOpenChange={o => !o && setAgain(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Read {again?.x.sheet} Rev {again?.rev} again?</AlertDialogTitle>
            <AlertDialogDescription>
              {again ? plural(again.reviewed, "piece") + " on it " + (again.reviewed === 1 ? "was" : "were") + " already reviewed." : ""} Reading again replaces them all with new suggestions that need
              review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const l = again;
                setAgain(null);
                if (l) void readOne(l);
              }}
            >
              Read again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {level && <LevelDrawer rec={level.r} sheet={level.l.x.sheet} onClose={() => setLevel(null)} onSave={(lvl, tos) => saveLevel(level.r, lvl, tos)} />}
      {weights && (
        <SettingsDrawer
          open
          cfg={cfg}
          version={api.job.data?.settings.version ?? 0}
          onClose={() => setWeights(false)}
          onSave={async (s, expectedVersion) => {
            const ok = await api.saveSettings(s, expectedVersion);
            if (ok) toast.success("Weights saved.");
            return ok;
          }}
        />
      )}
      {canEdit && recs.some(r => r.pcs.some(p => p.st === "auto")) && view === "sheets" && (
        <Note>
          Review each sheet in the viewer (Open in viewer, Framing tab): accept, fix or reject each piece against its line, and draw the ones the reader missed.
        </Note>
      )}
    </div>
  );
}
