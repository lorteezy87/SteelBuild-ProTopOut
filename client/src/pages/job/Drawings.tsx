import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronDown, ChevronRight, Download, FileStack, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/brand/Controls";
import { EmptyState, ErrorState, Kpi, Loading, PageHeader, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { ImportDialog } from "@/features/drawings/ImportDialog";
import { BulkBar } from "@/features/drawings/BulkBar";
import { SetForm, SheetForm } from "@/features/drawings/Forms";
import { SetDrawer } from "@/features/drawings/SetDrawer";
import { SheetDrawer } from "@/features/drawings/SheetDrawer";
import { SheetViewer } from "@/features/drawings/viewer/SheetViewer";
import { VIEWER_PLUGINS } from "@/features/drawings/viewerPlugins";
import { MATRIX_TONE, STATUS_TONE, revLabel, revsOf, statusLabel, type Sheet } from "@/features/drawings/model";
import { fmtDateShort } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { MATRIX_LABELS, SHEET_STATUSES, csvCell, matrixCell, pendingRev, reviewFacts, setIssueLabel, setIssueState, type SheetStatus } from "@shared/drawings";
import { useJob, useSearchParam } from "./JobContext";

const NO_SET = "none";

export default function Drawings() {
  const { projectId, data } = useJob();
  const q = trpc.drawings.register.useQuery({ projectId });
  const [, navigate] = useLocation();
  const sheetParam = useSearchParam("sheet");
  const setParam = useSearchParam("set");

  const [status, setStatus] = useState<SheetStatus | null>(null);
  const [seq, setSeq] = useState<string | null>(null);
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const lastPicked = useRef<number | null>(null);
  // The full-screen sheet viewer. The sheet drawer is a modal (it traps focus), so it closes while the viewer is open
  // and the sheet the viewer ended on opens again when it closes.
  const [viewer, setViewer] = useState<{ sheetId: number; rev?: number; tab?: string } | null>(null);
  const viewerAt = useRef<number | null>(null);
  // ?view=<sheet id>[&rev=][&tab=] opens the viewer directly (the Model tab's "Open in viewer").
  const viewParam = useSearchParam("view");
  const revParam = useSearchParam("rev");
  const tabParam = useSearchParam("tab");
  useEffect(() => {
    if (!viewParam || !/^\d+$/.test(viewParam)) return;
    viewerAt.current = null;
    setViewer({ sheetId: Number(viewParam), rev: revParam && /^\d+$/.test(revParam) ? Number(revParam) : undefined, tab: tabParam ?? undefined });
    navigate(`/jobs/${projectId}/drawings`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam]);
  const [newSet, setNewSet] = useState(false);
  const [newSheet, setNewSheet] = useState(false);
  const [importing, setImporting] = useState(false);

  const reg = useMemo(() => (q.data ? { ...q.data, projectId } : null), [q.data, projectId]);
  const open = (kind: "sheet" | "set" | null, id?: number) => navigate(kind ? `/jobs/${projectId}/drawings?${kind}=${id}` : `/jobs/${projectId}/drawings`);

  const view = useMemo(() => {
    if (!reg) return null;
    const { sheets, sets, today } = reg;
    const s = search.trim().toLowerCase();
    const setById = new Map(sets.map(t => [t.id, t]));
    const filtering = !!status || !!seq || !!setFilter || pendingOnly || lateOnly || !!s;
    const F = sheets.filter(x => {
      if (status && x.status !== status) return false;
      if (seq && (seq === NO_SET ? x.sequenceTaskId != null : String(x.sequenceTaskId) !== seq)) return false;
      if (setFilter && (setFilter === NO_SET ? x.setId != null : String(x.setId) !== setFilter)) return false;
      if (pendingOnly && !pendingRev(x.revs)) return false;
      if (lateOnly && !reviewFacts(x, today).late) return false;
      if (s) {
        const t = x.setId ? setById.get(x.setId) : null;
        if (!`${x.sheetNumber} ${x.title} ${x.description ?? ""} ${t?.number ?? ""} ${t?.name ?? ""}`.toLowerCase().includes(s)) return false;
      }
      return true;
    });
    const groups = [
      ...sets.map(t => ({ key: String(t.id), set: t, kids: F.filter(x => x.setId === t.id), all: sheets.filter(x => x.setId === t.id) })),
      { key: NO_SET, set: null, kids: F.filter(x => x.setId == null || !setById.has(x.setId)), all: sheets.filter(x => x.setId == null || !setById.has(x.setId)) },
    ].filter(g => (g.set ? g.kids.length || (!filtering) || (!!s && `${g.set.number} ${g.set.name}`.toLowerCase().includes(s)) : g.kids.length));
    const cnt = (k: SheetStatus) => sheets.filter(x => x.status === k).length;
    const late = sheets.filter(x => reviewFacts(x, today).late).length;
    const pend = sheets.filter(x => pendingRev(x.revs)).length;
    const matrix = reg.sequences.map(sq => ({ ...sq, cell: matrixCell(sheets.filter(x => x.sequenceTaskId === sq.id), today), n: sheets.filter(x => x.sequenceTaskId === sq.id).length }));
    return { F, groups, cnt, late, pend, matrix, filtering };
  }, [reg, status, seq, setFilter, pendingOnly, lateOnly, search]);

  if (q.isLoading) return <Loading label="Loading drawing register…" />;
  if (q.error || !reg || !view) return <ErrorState error={q.error ?? { message: "Drawing register unavailable" }} />;

  const sheet = sheetParam ? reg.sheets.find(x => String(x.id) === sheetParam) ?? null : null;
  const set = !sheet && setParam ? reg.sets.find(t => String(t.id) === setParam) ?? null : null;
  const total = reg.sheets.length;

  // Only rows actually rendered (filtered in and inside an expanded set) can be selected in bulk or acted on.
  const rendered = view.groups.filter(g => !collapsed[g.key]).flatMap(g => g.kids);
  const pickedShown = rendered.filter(x => picked.has(x.id));
  const hiddenPicks = picked.size - pickedShown.length;
  const visibleIds = rendered.map(x => x.id);
  const allVisiblePicked = visibleIds.length > 0 && visibleIds.every(id => picked.has(id));
  const someVisiblePicked = visibleIds.some(id => picked.has(id));
  const toggle = (ids: number[], on?: boolean) =>
    setPicked(p => {
      const n = new Set(p);
      const all = ids.every(i => n.has(i));
      ids.forEach(i => ((on ?? !all) ? n.add(i) : n.delete(i)));
      return n;
    });
  const clearPicked = () => { setPicked(new Set()); lastPicked.current = null; };
  const pickRow = (id: number, shift: boolean) => {
    const order = view.groups.filter(g => !collapsed[g.key]).flatMap(g => g.kids.map(x => x.id));
    const anchor = lastPicked.current == null ? -1 : order.indexOf(lastPicked.current);
    const target = order.indexOf(id);
    const range = shift && anchor >= 0 && target >= 0 ? order.slice(Math.min(anchor, target), Math.max(anchor, target) + 1) : [id];
    toggle(range, !picked.has(id));
    lastPicked.current = id;
  };

  const exportCsv = () => {
    const head = ["Set", "Sheet", "Title", "Sequence", "Rev", "Pending rev", "Status", "Ball in court", "Sent", "Returned", "Days out", "Hold reason"];
    const lines = reg.sheets.map(x => {
      const t = reg.sets.find(s => s.id === x.setId);
      const p = pendingRev(x.revs);
      const f = reviewFacts(x, reg.today);
      return [
        t?.number ?? "",
        x.sheetNumber,
        x.title,
        reg.sequences.find(s => s.id === x.sequenceTaskId)?.name ?? "",
        x.currentRev ?? "",
        p ? `${p.number} (${p.state === "checked" ? "signed off" : "draft"})` : "",
        statusLabel(x.status),
        x.ballInCourt,
        x.sentDate ?? "",
        x.returnedDate ?? "",
        x.sentDate ? f.out : "",
        x.status === "HOLD" ? [x.holdRfi?.label, x.holdReason].filter(Boolean).join(" · ") : "",
      ].map(csvCell).join(",");
    });
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.project.code || "job"}-drawing-log-${reg.today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const KPI: [SheetStatus, string, "green" | "amber" | "red" | "orange" | "gray" | undefined][] = [
    ["REL", `Released of ${total}`, "green"],
    ["REV", "In review", undefined],
    ["RR", "Revise & resubmit", view.cnt("RR") ? "amber" : undefined],
    ["HOLD", "On hold", view.cnt("HOLD") ? "red" : undefined],
    ["DET", "Detailing", undefined],
  ];
  const showCheck = reg.canUpload;

  return (
    <>
      <PageHeader
        title="Drawing register"
        subtitle={
          total
            ? `${view.cnt("REL")} of ${total} sheet${total === 1 ? "" : "s"} released${view.cnt("HOLD") ? ` · ${view.cnt("HOLD")} on hold` : ""}${view.cnt("RR") ? ` · ${view.cnt("RR")} to revise & resubmit` : ""}${view.late ? ` · ${view.late} review${view.late === 1 ? "" : "s"} late` : ""}${view.pend ? ` · ${view.pend} revision${view.pend === 1 ? "" : "s"} waiting to be signed off or issued` : ""}.`
            : "Erection drawing sets and sheets, revisions, holds and issues."
        }
        actions={
          <>
            {total > 0 && (
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="size-4" /> Export log
              </Button>
            )}
            {reg.canEdit && (
              <Button size="sm" variant="outline" onClick={() => setNewSet(true)}>
                <Plus className="size-4" /> New set
              </Button>
            )}
            {reg.canUpload && (
              <>
                <Button size="sm" variant="outline" onClick={() => setNewSheet(true)}>
                  <Plus className="size-4" /> Add sheet
                </Button>
                <Button size="sm" onClick={() => setImporting(true)}>
                  <Upload className="size-4" /> Import drawings
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="space-y-4 p-5">
        <p className="text-[12px] text-muted-foreground">
          Document control only: record returned GC/EOR approvals before release. Fabrication and detailing are by others.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {KPI.map(([k, l, tone]) => (
            <button key={k} type="button" className="text-left" onClick={() => setStatus(status === k ? null : k)} aria-pressed={status === k}>
              <Kpi
                label={l}
                value={view.cnt(k)}
                tone={tone}
                sub={k === "REV" && view.late ? <span className="text-[var(--tp-red-strong)]">{view.late} late</span> : undefined}
                className={status && status !== k ? "opacity-50" : status === k ? "outline outline-2 outline-[var(--tp-accent)]" : ""}
              />
            </button>
          ))}
        </div>

        {view.matrix.length > 0 && total > 0 && (
          <Panel title="Release by erection sequence">
            <div className="flex flex-wrap gap-2 p-3">
              {view.matrix.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSeq(seq === String(m.id) ? null : String(m.id))}
                  className={"flex min-w-[150px] flex-col items-start gap-1 border px-3 py-2 text-left " + (seq === String(m.id) ? "border-[var(--tp-accent)]" : "border-[var(--tp-rule)]") + " bg-[var(--tp-paper)] text-[var(--tp-ink)]"}
                  title={`${m.n} sheet${m.n === 1 ? "" : "s"}`}
                >
                  <span className="truncate text-[12.5px] font-medium">{m.name}</span>
                  <Pill tone={MATRIX_TONE[m.cell]} hazard={m.cell === "HOLD" || m.cell === "LATE"}>
                    {MATRIX_LABELS[m.cell]}
                    {m.n ? ` · ${m.n}` : ""}
                  </Pill>
                </button>
              ))}
            </div>
          </Panel>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sheet, title, set…" className="h-8 w-[240px] border-[var(--tp-rule)] bg-[var(--tp-paper)] text-[var(--tp-ink)]" />
          <div className="w-[170px]">
            <SimpleSelect value={status} onChange={v => setStatus(v as SheetStatus | null)} options={SHEET_STATUSES} allowNone noneLabel="All statuses" placeholder="All statuses" size="sm" />
          </div>
          <div className="w-[190px]">
            <SimpleSelect
              value={seq}
              onChange={setSeq}
              options={[...reg.sequences.map(s => ({ value: String(s.id), label: s.name })), { value: NO_SET, label: "No sequence" }]}
              allowNone
              noneLabel="All sequences"
              placeholder="All sequences"
              size="sm"
            />
          </div>
          <div className="w-[190px]">
            <SimpleSelect
              value={setFilter}
              onChange={setSetFilter}
              options={[...reg.sets.map(t => ({ value: String(t.id), label: `${t.number} · ${t.name}` })), { value: NO_SET, label: "Not in a set" }]}
              allowNone
              noneLabel="All sets"
              placeholder="All sets"
              size="sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <Checkbox checked={pendingOnly} onCheckedChange={v => setPendingOnly(v === true)} /> Pending revisions · {view.pend}
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <Checkbox checked={lateOnly} onCheckedChange={v => setLateOnly(v === true)} /> Review late · {view.late}
          </label>
          {view.filtering && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatus(null);
                setSeq(null);
                setSetFilter(null);
                setPendingOnly(false);
                setLateOnly(false);
                setSearch("");
              }}
            >
              Clear filters
            </Button>
          )}
          <div className="ml-auto text-[12px] text-muted-foreground">
            {reg.sets.length} set{reg.sets.length === 1 ? "" : "s"} · {view.filtering ? `${view.F.length} of ` : ""}
            {total} sheet{total === 1 ? "" : "s"}
          </div>
        </div>

        {showCheck && (picked.size > 0) && (
          <BulkBar reg={reg} sheets={pickedShown} hiddenCount={hiddenPicks} onClear={clearPicked} />
        )}

        <Panel bodyClassName="overflow-x-auto">
          {!view.groups.length ? (
            total ? (
              <EmptyState title="No sheets match these filters." />
            ) : (
              <EmptyState
                icon={<FileStack className="size-8" />}
                title="No drawings in this job's register yet"
                body={reg.canEdit ? "Create a drawing set, then import its drawings or add sheets one at a time." : reg.canUpload ? "Import drawings or add the first sheet." : "Drawings appear here once the detailer or PM logs them."}
                action={
                  reg.canUpload && (
                    <div className="flex gap-2">
                      {reg.canEdit && (
                        <Button size="sm" variant="outline" onClick={() => setNewSet(true)}>
                          New set
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setImporting(true)}>
                        Import drawings
                      </Button>
                    </div>
                  )
                }
              />
            )
          ) : (
            <table className="tp-table min-w-[900px]">
              <thead>
                <tr>
                  {showCheck && <th style={{ width: 28 }}><Checkbox checked={allVisiblePicked ? true : someVisiblePicked ? "indeterminate" : false} disabled={!visibleIds.length} onCheckedChange={() => { toggle(visibleIds, !allVisiblePicked); lastPicked.current = null; }} aria-label="Select all visible sheets" /></th>}
                  <th style={{ width: 110 }}>Sheet</th>
                  <th>Title</th>
                  <th>Sequence</th>
                  <th style={{ width: 64 }}>Rev</th>
                  <th style={{ width: 150 }}>Status</th>
                  <th style={{ width: 70 }}>Sent</th>
                  <th style={{ width: 70 }}>Back</th>
                  <th style={{ width: 100 }}>Ball in court</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map(g => {
                  const isOpen = !collapsed[g.key];
                  const si = g.set ? setIssueState(reg.issues.filter(i => i.setId === g.set!.id), g.all.map(x => ({ ...x, revs: revsOf(x) }))) : null;
                  const kidIds = g.kids.map(x => x.id);
                  const allPicked = kidIds.length > 0 && kidIds.every(i => picked.has(i));
                  const somePicked = kidIds.some(i => picked.has(i));
                  return (
                    <Fragment key={g.key}>
                      <tr className="bg-[var(--tp-bone)]">
                        {showCheck && (
                          <td>
                            {kidIds.length > 0 && (
                              <Checkbox
                                checked={allPicked ? true : somePicked ? "indeterminate" : false}
                                onCheckedChange={() => toggle(kidIds, !allPicked)}
                                aria-label={`Select all sheets in ${g.set?.number ?? "unassigned sheets"}`}
                              />
                            )}
                          </td>
                        )}
                        <td colSpan={8}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={(isOpen ? "Collapse " : "Expand ") + (g.set?.number ?? "unassigned sheets")}
                              aria-expanded={isOpen}
                              onClick={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}
                              className="text-muted-foreground"
                            >
                              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                            {g.set ? (
                              <button type="button" className="flex min-w-0 items-center gap-2 hover:underline" onClick={() => open("set", g.set!.id)}>
                                <span className="num font-semibold">{g.set.number}</span>
                                <span className="truncate font-medium">{g.set.name}</span>
                              </button>
                            ) : (
                              <span className="font-medium text-muted-foreground">Sheets not in a set</span>
                            )}
                            <span className="text-[12px] text-muted-foreground">
                              {view.filtering && g.kids.length !== g.all.length ? `${g.kids.length} of ` : ""}
                              {g.all.length} sheet{g.all.length === 1 ? "" : "s"}
                            </span>
                            {si && <span className="ml-auto text-[12px] text-muted-foreground">{setIssueLabel(si, fmtDateShort)}</span>}
                          </div>
                        </td>
                      </tr>
                      {isOpen && g.kids.map(x => <SheetRow key={x.id} x={x} reg={reg} showCheck={showCheck} picked={picked.has(x.id)} onPick={shift => pickRow(x.id, shift)} onOpen={() => open("sheet", x.id)} selected={sheet?.id === x.id} />)}
                      {isOpen && g.set && !g.kids.length && (
                        <tr>
                          <td colSpan={showCheck ? 9 : 8} className="text-[12.5px] text-muted-foreground">
                            No sheets in this set yet.
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {sheet && !viewer && (
        <SheetDrawer
          key={`sheet-${sheet.id}`}
          reg={reg}
          sheet={sheet}
          onClose={() => open(null)}
          onOpenSet={id => open("set", id)}
          onOpenViewer={rev => {
            viewerAt.current = sheet.id;
            setViewer({ sheetId: sheet.id, rev });
            open(null);
          }}
        />
      )}
      {viewer && (
        <SheetViewer
          projectId={projectId}
          sheets={reg.sheets}
          sheetId={viewer.sheetId}
          rev={viewer.rev}
          initialTab={viewer.tab}
          plugins={VIEWER_PLUGINS}
          onOpenSheet={id => {
            viewerAt.current = id;
          }}
          onClose={() => {
            const back = viewerAt.current;
            setViewer(null);
            if (back != null) open("sheet", back);
          }}
        />
      )}
      {set && <SetDrawer key={`set-${set.id}`} reg={reg} set={set} onClose={() => open(null)} onOpenSheet={id => open("sheet", id)} />}
      <SetForm projectId={projectId} set={null} sets={reg.sets} open={newSet} onOpenChange={setNewSet} onSaved={id => open("set", id)} />
      <SheetForm reg={reg} sheet={null} defaultSetId={setFilter && setFilter !== NO_SET ? Number(setFilter) : null} open={newSheet} onOpenChange={setNewSheet} onSaved={id => open("sheet", id)} />
      <ImportDialog reg={reg} defaultSetId={setFilter && setFilter !== NO_SET ? Number(setFilter) : null} open={importing} onOpenChange={setImporting} />
    </>
  );
}

function SheetRow({
  x,
  reg,
  showCheck,
  picked,
  onPick,
  onOpen,
  selected,
}: {
  x: Sheet;
  reg: { today: string; sequences: { id: number; name: string }[] };
  showCheck: boolean;
  picked: boolean;
  onPick: (shift: boolean) => void;
  onOpen: () => void;
  selected: boolean;
}) {
  const p = pendingRev(x.revs);
  const f = reviewFacts(x, reg.today);
  return (
    <tr className={"cursor-pointer" + (selected || picked ? " is-selected" : "")} onClick={e => { if (showCheck && e.shiftKey) { e.preventDefault(); onPick(true); } else onOpen(); }}>
      {showCheck && (
        <td onClick={e => e.stopPropagation()}>
          <Checkbox checked={picked} onClick={e => onPick(e.shiftKey)} aria-label={`Select ${x.sheetNumber}`} />
        </td>
      )}
      <td className="num font-medium">{x.sheetNumber}</td>
      <td className="max-w-[340px] truncate">{x.title}</td>
      <td className="max-w-[160px] truncate text-[12.5px]">{reg.sequences.find(s => s.id === x.sequenceTaskId)?.name ?? "—"}</td>
      <td className="num">
        {revLabel(x)}
        {p && (
          <span className={"ml-1 " + (p.state === "checked" ? "text-[var(--tp-blue)]" : "text-[var(--tp-accent-ink)]")} title={p.state === "checked" ? `Rev ${p.number} signed off, not issued` : `Rev ${p.number} draft`}>
            →{p.number}
          </span>
        )}
      </td>
      <td>
        <span className="flex items-center gap-1">
          <Pill tone={STATUS_TONE[x.status as SheetStatus] ?? "gray"} dot hazard={x.status === "HOLD"}>
            {statusLabel(x.status)}
          </Pill>
          {f.late && <Pill tone="red">Late</Pill>}
        </span>
      </td>
      <td className="num text-[12.5px]">{fmtDateShort(x.sentDate)}</td>
      <td className="num text-[12.5px]">{fmtDateShort(x.returnedDate)}</td>
      <td className="text-[12.5px]">{x.ballInCourt}</td>
    </tr>
  );
}
