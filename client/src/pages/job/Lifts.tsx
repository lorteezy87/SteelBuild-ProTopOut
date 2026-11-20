import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { gridPoint, pieceRadiusFt } from "@shared/lift";
import { EmptyState, ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { NumberInput, RecordDrawer, SimpleSelect } from "@/components/brand/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PickTable } from "@/features/lifts/PickTable";
import { SetupForm, type Setup } from "@/features/lifts/SetupForm";
import { useModel } from "@/features/model/data";
import { MD, type ReadRec, type Row } from "@/features/model/domain";
import { errMsg, fmtNum } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useJob } from "./JobContext";

/** Job tab: crane setups, the picks they make, and each pick checked against the crane's load chart. */
export default function Lifts() {
  const { projectId, can } = useJob();
  const editable = can("task.edit");
  const setups = trpc.cranes.setups.list.useQuery({ projectId });
  const picks = trpc.cranes.picks.list.useQuery({ projectId });
  const tasks = trpc.tasks.list.useQuery({ projectId });
  const model = useModel(projectId);
  const [editing, setEditing] = useState<Setup | "new" | null>(null);
  const [adding, setAdding] = useState<"manual" | "model" | null>(null);
  const seqs = useMemo(() => (tasks.data?.tasks ?? []).filter(t => t.kind === "sequence" && !t.isSummary), [tasks.data]);
  const seqName = (id: number | null) => (id ? seqs.find(s => s.id === id)?.name ?? "—" : "—");
  if (setups.isLoading || picks.isLoading) return <Loading label="Loading cranes & lifts…" />;
  if (setups.error || picks.error) return <ErrorState error={(setups.error || picks.error)!} />;
  const S = setups.data ?? [];
  const P = picks.data ?? [];
  const counts = { critical: P.filter(p => p.check.status === "critical").length, blocked: P.filter(p => p.check.status === "blocked").length, unknown: P.filter(p => p.check.status === "unknown").length };
  return (
    <div className="space-y-4">
      <Panel
        title="Crane setups"
        actions={editable && <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-3.5" /> Setup</Button>}
        bodyClassName="p-0"
      >
        {!S.length ? (
          <EmptyState title="No crane setups" body="Add where each crane sits (grid intersection on a framing sheet), its boom and counterweight. Cranes come from Settings → Cranes & load charts." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead><tr><th>Setup</th><th>Location</th><th className="right">Boom</th><th>Counterweight</th><th className="right">Picks</th></tr></thead>
              <tbody>
                {S.map(s => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => editable && setEditing(s)}>
                    <td className="font-medium">{s.name}</td>
                    <td className="num">{s.grid1 && s.grid2 ? `${s.grid1}/${s.grid2}` : "—"}{s.offsetXFt || s.offsetYFt ? ` (+${fmtNum(s.offsetXFt, 1)}′, +${fmtNum(s.offsetYFt, 1)}′)` : ""}</td>
                    <td className="right num">{s.boomFt == null ? "Not entered" : `${fmtNum(s.boomFt, 1)} ft`}</td>
                    <td>{s.counterweight ?? "Not entered"}</td>
                    <td className="right num">{P.filter(p => p.setupId === s.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title={`Picks${P.length ? ` · ${counts.critical} critical · ${counts.blocked} blocked · ${counts.unknown} unknown` : ""}`}
        actions={
          editable && S.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAdding("model")}>Add from lift list</Button>
              <Button size="sm" onClick={() => setAdding("manual")}><Plus className="size-3.5" /> Pick</Button>
            </div>
          )
        }
        bodyClassName="p-0"
      >
        {!P.length ? (
          <EmptyState title="No picks yet" body={S.length ? "Add picks by hand or from the model's lift list (heaviest first)." : "Add a crane setup first."} />
        ) : (
          <PickTable projectId={projectId} picks={P} setups={S} seqName={seqName} editable={editable} />
        )}
        <p className="px-3 py-2 text-xs text-[var(--tp-muted)]">
          Capacity is read at the next longer chart radius. ≥ 75 % of chart is a critical lift; over 100 % is blocked. A radius off the chart is blocked; a pick without a weight or radius stays unknown.
        </p>
      </Panel>
      {editing && <SetupForm projectId={projectId} setup={editing === "new" ? null : editing} sheets={model.sheets} recs={model.recs} onClose={() => setEditing(null)} />}
      {adding === "manual" && <ManualPick projectId={projectId} setups={S} seqs={seqs} onClose={() => setAdding(null)} />}
      {adding === "model" && <FromLiftList projectId={projectId} setups={S} model={model} seqs={seqs} onClose={() => setAdding(null)} />}
    </div>
  );
}

type Seq = { id: number; name: string };

function ManualPick({ projectId, setups, seqs, onClose }: { projectId: number; setups: Setup[]; seqs: Seq[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ setupId: setups[0]?.id ?? 0, mark: "", sequenceTaskId: null as number | null, pieceLb: null as number | null, riggingLb: null as number | null, radiusFt: null as number | null });
  const create = trpc.cranes.picks.create.useMutation({ onSuccess: async () => { await utils.cranes.picks.list.invalidate({ projectId }); toast.success("Pick added."); onClose(); }, onError: e => toast.error(errMsg(e)) });
  return (
    <RecordDrawer open onOpenChange={o => !o && onClose()} eyebrow="Lift pick" title="New pick" width={520}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending} onClick={() => (f.mark.trim() ? create.mutate({ ...f, mark: f.mark.trim() }) : toast.error("Enter the piece mark."))}>Add pick</Button></div>}>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Setup"><SimpleSelect value={String(f.setupId)} options={setups.map(s => ({ value: String(s.id), label: s.name }))} onChange={v => v && setF(x => ({ ...x, setupId: Number(v) }))} /></Field>
        <Field label="Piece mark"><Input value={f.mark} maxLength={32} onChange={e => setF(x => ({ ...x, mark: e.target.value }))} /></Field>
        <Field label="Sequence" className="sm:col-span-2"><SimpleSelect allowNone value={f.sequenceTaskId ? String(f.sequenceTaskId) : null} options={seqs.map(s => ({ value: String(s.id), label: s.name }))} onChange={v => setF(x => ({ ...x, sequenceTaskId: v ? Number(v) : null }))} /></Field>
        <Field label="Piece weight (lb)"><NumberInput min={0} step={1} value={f.pieceLb} onChange={v => setF(x => ({ ...x, pieceLb: v ?? null }))} /></Field>
        <Field label="Rigging weight (lb)"><NumberInput min={0} step={1} value={f.riggingLb} onChange={v => setF(x => ({ ...x, riggingLb: v ?? null }))} /></Field>
        <Field label="Radius (ft)"><NumberInput min={0} step="0.5" value={f.radiusFt} onChange={v => setF(x => ({ ...x, radiusFt: v ?? null }))} /></Field>
      </div>
    </RecordDrawer>
  );
}

/** Heaviest pieces from the model; the radius is measured only where the setup's sheet page matches and the read has a scale. */
function FromLiftList({ projectId, setups, model, seqs, onClose }: { projectId: number; setups: Setup[]; model: ReturnType<typeof useModel>; seqs: Seq[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [setupId, setSetupId] = useState(setups[0]?.id ?? 0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const setup = setups.find(s => s.id === setupId) ?? null;
  const rows = useMemo(() => MD.rows(model.sheets, model.recs, model.cfg).filter(r => r.lb != null).sort((a, b) => b.lb! - a.lb!).slice(0, 200), [model.sheets, model.recs, model.cfg]);
  const recOf = (r: Row): ReadRec | undefined => model.recs.find(x => x.sid === r.sid && x.rev === r.rev && x.pg === r.pg);
  const radius = (r: Row): number | null => {
    if (!setup || setup.sheetId !== r.sid || setup.page !== r.pg || !setup.grid1 || !setup.grid2) return null;
    const rec = recOf(r);
    if (!rec || !(rec.ppf > 0)) return null;
    const pt = gridPoint(rec.grids, setup.grid1, setup.grid2);
    return pt ? pieceRadiusFt(pt, { x: setup.offsetXFt, y: setup.offsetYFt }, r, rec.ppf) : null;
  };
  const seqId = (r: Row) => (r.seq && seqs.some(s => String(s.id) === r.seq) ? Number(r.seq) : null);
  const add = trpc.cranes.picks.bulkFromModel.useMutation({
    onSuccess: async res => { await utils.cranes.picks.list.invalidate({ projectId }); toast.success(`Added ${res.added} pick(s)${res.skipped ? `; ${res.skipped} already on this setup` : ""}.`); onClose(); },
    onError: e => toast.error(errMsg(e)),
  });
  const submit = () => {
    const list = rows.filter(r => chosen.has(r.key)).map(r => ({ mark: (r.mark || r.size || "?").slice(0, 32), pieceLb: r.lb, sequenceTaskId: seqId(r), sheetId: r.sid, page: r.pg, pieceKey: r.key.slice(0, 64), radiusFt: radius(r) }));
    if (!list.length) return toast.error("Tick the pieces to add.");
    add.mutate({ projectId, setupId, picks: list });
  };
  return (
    <RecordDrawer open onOpenChange={o => !o && onClose()} eyebrow="Lift list" title="Add picks from the model" width={820}
      footer={<div className="flex items-center justify-end gap-2"><span className="mr-auto text-xs text-[var(--tp-muted)]">{chosen.size} selected</span><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={add.isPending} onClick={submit}>Add picks</Button></div>}>
      <div className="space-y-3 p-4">
        <Field label="Setup"><SimpleSelect value={String(setupId)} options={setups.map(s => ({ value: String(s.id), label: s.name }))} onChange={v => v && setSetupId(Number(v))} /></Field>
        {model.loading ? <Loading label="Loading the model…" /> : !rows.length ? (
          <EmptyState title="No weighed pieces in the model" body="Read framing sheets in the Model tab first; pieces need a size or the joist list to have a weight." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead><tr><th /><th>Mark</th><th>Size</th><th>Sheet</th><th className="right">Weight (lb)</th><th className="right">Radius (ft)</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const rad = radius(r);
                  return (
                    <tr key={r.key}>
                      <td><input type="checkbox" aria-label={`Add ${r.mark || r.size}`} checked={chosen.has(r.key)} onChange={e => setChosen(c => { const n = new Set(c); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} /></td>
                      <td className="num">{r.mark || "—"}</td>
                      <td>{r.size}</td>
                      <td className="num">{r.sheet}{r.pg > 1 ? ` p${r.pg}` : ""}</td>
                      <td className="right num">{fmtNum(r.lb, 0)}{r.approx ? " ≈" : ""}</td>
                      <td className="right num">{rad == null ? <span className="text-[var(--tp-muted)]">Enter on the pick</span> : fmtNum(rad, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RecordDrawer>
  );
}
