import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/brand/Layout";
import { NumberInput, RecordDrawer, SimpleSelect } from "@/components/brand/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReadRec, SheetLite } from "@/features/model/domain";
import { errMsg } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";

export type Setup = RouterOutputs["cranes"]["setups"]["list"][number];

/** Where the crane sits: a grid intersection on a framing sheet page (plus offsets), boom and counterweight. */
export function SetupForm({ projectId, setup, sheets, recs, onClose }: { projectId: number; setup: Setup | null; sheets: SheetLite[]; recs: ReadRec[]; onClose: () => void }) {
  const { ref } = useRefData();
  const models = trpc.cranes.models.list.useQuery();
  const utils = trpc.useUtils();
  const [f, setF] = useState({
    name: setup?.name ?? "",
    craneModelId: setup?.craneModelId ?? null,
    equipmentId: setup?.equipmentId ?? null,
    sheetId: setup?.sheetId ?? null,
    page: setup?.page ?? 1,
    grid1: setup?.grid1 ?? "",
    grid2: setup?.grid2 ?? "",
    offsetXFt: setup?.offsetXFt ?? 0,
    offsetYFt: setup?.offsetYFt ?? 0,
    boomFt: setup?.boomFt ?? null,
    counterweight: setup?.counterweight ?? "",
    notes: setup?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  // Grid names read on the chosen sheet page (latest revision read), offered as choices.
  const grids = useMemo(() => {
    const r = recs.filter(x => x.sid === f.sheetId && x.pg === f.page).sort((a, b) => b.rev - a.rev)[0];
    return r ? Array.from(new Set(r.grids.map(g => g.n))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  }, [recs, f.sheetId, f.page]);
  const done = { onSuccess: async () => { await Promise.all([utils.cranes.setups.list.invalidate({ projectId }), utils.cranes.picks.list.invalidate({ projectId })]); toast.success("Setup saved."); onClose(); }, onError: (e: unknown) => toast.error(errMsg(e)) };
  const create = trpc.cranes.setups.create.useMutation(done);
  const update = trpc.cranes.setups.update.useMutation(done);
  const save = () => {
    if (!f.name.trim()) return toast.error("Name the setup (e.g. Setup 1 — east laydown).");
    if (!f.craneModelId) return toast.error("Pick a crane from the library (Settings → Cranes & load charts).");
    const body = {
      ...f,
      craneModelId: f.craneModelId,
      name: f.name.trim(),
      grid1: f.grid1.trim() || null,
      grid2: f.grid2.trim() || null,
      counterweight: f.counterweight.trim() || null,
      notes: f.notes.trim() || null,
    };
    if (setup) update.mutate({ id: setup.id, ...body });
    else create.mutate({ projectId, ...body });
  };
  const cranes = (ref?.equipment ?? []).filter(e => e.type === "crane");
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      eyebrow="Crane setup"
      title={setup ? setup.name : "New crane setup"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={create.isPending || update.isPending} onClick={save}>Save setup</Button>
        </div>
      }
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Setup name" className="sm:col-span-2">
          <Input value={f.name} maxLength={120} onChange={e => set("name", e.target.value)} placeholder="Setup 1 — east laydown" />
        </Field>
        <Field label="Crane (library)">
          <SimpleSelect value={f.craneModelId ? String(f.craneModelId) : null} options={(models.data ?? []).filter(m => m.isActive || m.id === f.craneModelId).map(m => ({ value: String(m.id), label: m.name }))} onChange={v => set("craneModelId", v ? Number(v) : null)} placeholder={models.data?.length ? "Select…" : "Add a crane in Settings first"} />
        </Field>
        <Field label="Equipment record (optional)">
          <SimpleSelect allowNone value={f.equipmentId ? String(f.equipmentId) : null} options={cranes.map(e => ({ value: String(e.id), label: e.name }))} onChange={v => set("equipmentId", v ? Number(v) : null)} />
        </Field>
        <Field label="Framing sheet">
          <SimpleSelect allowNone noneLabel="— Not on a sheet —" value={f.sheetId ? String(f.sheetId) : null} options={sheets.map(s => ({ value: String(s.id), label: `${s.sheet} · ${s.title}` }))} onChange={v => set("sheetId", v ? Number(v) : null)} />
        </Field>
        <Field label="Page">
          <NumberInput min={1} step={1} value={f.page} onChange={v => set("page", v ?? 1)} />
        </Field>
        <Field label="Grid line 1">
          <Input value={f.grid1} maxLength={16} list="tp-grids" onChange={e => set("grid1", e.target.value)} placeholder="C" />
        </Field>
        <Field label="Grid line 2">
          <Input value={f.grid2} maxLength={16} list="tp-grids" onChange={e => set("grid2", e.target.value)} placeholder="4" />
        </Field>
        <datalist id="tp-grids">{grids.map(g => <option key={g} value={g} />)}</datalist>
        <Field label="Offset east (+) / west (−), ft">
          <NumberInput step="0.5" value={f.offsetXFt} onChange={v => set("offsetXFt", v ?? 0)} />
        </Field>
        <Field label="Offset south (+) / north (−), ft">
          <NumberInput step="0.5" value={f.offsetYFt} onChange={v => set("offsetYFt", v ?? 0)} />
        </Field>
        <Field label="Boom length (ft)">
          <NumberInput min={0} step="0.5" value={f.boomFt} onChange={v => set("boomFt", v ?? null)} />
        </Field>
        <Field label="Counterweight">
          <Input value={f.counterweight} maxLength={120} onChange={e => set("counterweight", e.target.value)} placeholder="e.g. 88,200 lb full" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes} maxLength={5000} onChange={e => set("notes", e.target.value)} placeholder="Ground bearing / mats, swing restrictions, power lines…" />
        </Field>
        <p className="text-xs text-[var(--tp-muted)] sm:col-span-2">
          Radii are measured from this point only when a pick's piece is on the same sheet page and that page has a scale. Every radius stays editable.
        </p>
      </div>
    </RecordDrawer>
  );
}
