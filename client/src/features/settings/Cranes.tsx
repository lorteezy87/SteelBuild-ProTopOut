import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { parseChart, type ChartRow } from "@shared/lift";
import { EmptyState, ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { NumberInput, RecordDrawer } from "@/components/brand/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, fmtNum } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/ref";

type Model = RouterOutputs["cranes"]["models"]["list"][number];
const chartText = (rows: ChartRow[]) => rows.map(r => `${r.radiusFt} ${r.capacityLb}`).join("\n");
const lbs = (n: number | null | undefined) => (n == null ? "—" : `${fmtNum(n, 0)} lb`);

/** Settings → Cranes: the crane library with each configuration's radius → capacity load chart. */
export default function Cranes() {
  const q = trpc.cranes.models.list.useQuery();
  const [editing, setEditing] = useState<Model | "new" | null>(null);
  return (
    <Panel
      title="Cranes"
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Crane
        </Button>
      }
      bodyClassName="p-0"
    >
      <p className="px-3 pt-3 text-[13px] text-[var(--tp-muted)]">
        One entry per crane configuration (boom, counterweight, outriggers). Paste the manufacturer's load chart; lift checks read the capacity at the next
        longer radius and never extrapolate.
      </p>
      {q.isLoading ? (
        <Loading label="Loading cranes…" />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <EmptyState title="No cranes yet" body="Add a crane and paste its load chart to plan lifts." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Crane</th>
                <th className="right">Max capacity</th>
                <th className="right">Chart rows</th>
                <th>Radius range</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map(m => (
                <tr key={m.id} className="cursor-pointer" onClick={() => setEditing(m)}>
                  <td className="font-medium">{m.name}</td>
                  <td className="right num">{lbs(m.maxCapacityLb)}</td>
                  <td className="right num">{m.chart.length}</td>
                  <td className="num">{m.chart.length ? `${m.chart[0].radiusFt}–${m.chart[m.chart.length - 1].radiusFt} ft` : "—"}</td>
                  <td>{m.isActive ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CraneForm model={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function CraneForm({ model, onClose }: { model: Model | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(model?.name ?? "");
  const [max, setMax] = useState<number | null>(model?.maxCapacityLb ?? null);
  const [text, setText] = useState(model ? chartText(model.chart) : "");
  const [note, setNote] = useState(model?.chartNote ?? "");
  const [active, setActive] = useState(model?.isActive ?? true);
  const parsed = useMemo(() => parseChart(text), [text]);
  const done = { onSuccess: async () => { await utils.cranes.models.list.invalidate(); toast.success("Crane saved."); onClose(); }, onError: (e: unknown) => toast.error(errMsg(e)) };
  const create = trpc.cranes.models.create.useMutation(done);
  const update = trpc.cranes.models.update.useMutation(done);
  const busy = create.isPending || update.isPending;
  const save = () => {
    if (!name.trim()) return toast.error("Name the crane.");
    if (parsed.errors.length || !parsed.rows.length) return toast.error("Fix the load chart first.");
    const body = { name: name.trim(), maxCapacityLb: max, chartText: text, chartNote: note.trim() || null };
    if (model) update.mutate({ id: model.id, ...body, isActive: active });
    else create.mutate(body);
  };
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      eyebrow="Crane library"
      title={model ? model.name : "New crane"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>Save crane</Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Crane / configuration">
            <Input value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="e.g. Grove GMK5250L · 50 ft boom · full CW" />
          </Field>
          <Field label="Max rated capacity (lb)">
            <NumberInput min={0} step={1} value={max} onChange={v => setMax(v ?? null)} />
          </Field>
          <Field label="Chart note" className="sm:col-span-2">
            <Input value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Chart #, boom length, counterweight, outriggers, 360°" />
          </Field>
          {model && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
            </label>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Load chart — radius (ft) and capacity (lb) per line">
            <Textarea rows={14} className="num" value={text} onChange={e => setText(e.target.value)} placeholder={"# radius  capacity\n20 100000\n30 72k\n40 51000"} />
          </Field>
          <div>
            <div className="label-caps mb-1">Preview</div>
            {parsed.errors.length > 0 && (
              <ul className="mb-2 space-y-0.5 text-xs text-[var(--tp-red-strong)]">
                {parsed.errors.map(e => <li key={e}>{e}</li>)}
              </ul>
            )}
            {parsed.rows.length ? (
              <table className="tp-table">
                <thead><tr><th className="right">Radius</th><th className="right">Capacity</th></tr></thead>
                <tbody>
                  {parsed.rows.map(r => (
                    <tr key={r.radiusFt}><td className="right num">{r.radiusFt} ft</td><td className="right num">{lbs(r.capacityLb)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-[var(--tp-muted)]">Paste rows to preview.</div>
            )}
          </div>
        </div>
      </div>
    </RecordDrawer>
  );
}
