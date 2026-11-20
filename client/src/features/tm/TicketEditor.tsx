import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TM_LINE_KINDS, TM_KIND_KEYS, lineAmount, ticketTotals, type Markup, type TmKind, type TmLine } from "@shared/tm";
import { ErrorState, Field, Panel } from "@/components/brand/Layout";
import { RecordPhotos } from "@/features/photos/RecordPhotos";
import { ConfirmButton, NumberInput, RecordDrawer, SimpleSelect } from "@/components/brand/Controls";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, fmtDate, fmtMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { SignaturePad } from "./SignaturePad";

/** Edit a draft ticket's lines and markup, then the GC super signs on screen; a signed ticket is read-only. */
export function TicketEditor({ id, projectId, onClose }: { id: number; projectId: number; onClose: () => void }) {
  const q = trpc.tm.get.useQuery({ id });
  const cos = trpc.tm.changeOrders.useQuery({ projectId });
  const utils = trpc.useUtils();
  const [lines, setLines] = useState<TmLine[]>([]);
  const [markup, setMarkup] = useState<Markup>({ labor: 0, equipment: 0, material: 0 });
  const [head, setHead] = useState({ ticketDate: "", description: "", coItemId: null as number | null });
  const [signing, setSigning] = useState(false);
  const [signer, setSigner] = useState({ name: "", title: "" });
  const [voidReason, setVoidReason] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setLines(q.data.lines.map(({ kind, description, qty, unit, rate, otQty, otRate }) => ({ kind, description, qty, unit, rate, otQty, otRate })));
    setMarkup(q.data.ticket.markup);
    setHead({ ticketDate: q.data.ticket.ticketDate, description: q.data.ticket.description ?? "", coItemId: q.data.ticket.coItemId });
  }, [q.data]);
  const refresh = () => Promise.all([utils.tm.get.invalidate({ id }), utils.tm.list.invalidate({ projectId })]);
  const onError = (e: unknown) => toast.error(errMsg(e));
  const save = trpc.tm.update.useMutation({ onSuccess: async () => { await refresh(); toast.success("Ticket saved."); }, onError });
  const sign = trpc.tm.sign.useMutation({ onSuccess: async () => { await refresh(); setSigning(false); toast.success("Ticket signed."); }, onError });
  const voidM = trpc.tm.void.useMutation({ onSuccess: async () => { await refresh(); toast.success("Ticket voided."); }, onError });
  if (q.isLoading) return null;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Ticket not found")} />;
  const t = q.data.ticket;
  const draft = t.status === "draft";
  const totals = ticketTotals(lines, markup);
  const setLine = (i: number, patch: Partial<TmLine>) => setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const doSave = () => {
    if (lines.some(l => !l.description.trim())) return toast.error("Every line needs a description.");
    save.mutate({ id, ticketDate: head.ticketDate, description: head.description || null, coItemId: head.coItemId, markup, lines: lines.map(l => ({ ...l, description: l.description.trim() })) });
  };
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      eyebrow="T&M / extra-work ticket"
      title={`${t.label} · ${fmtDate(t.ticketDate)}`}
      width={980}
      actions={<Pill tone={t.status === "signed" ? "green" : t.status === "void" ? "red" : "gray"}>{t.status[0].toUpperCase() + t.status.slice(1)}</Pill>}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <a className="text-sm text-[var(--tp-accent-ink)] hover:underline" href={`/print/tm/${id}`} target="_blank" rel="noreferrer">Print / PDF</a>
          <span className="num ml-auto font-semibold">{fmtMoney(totals.grandTotal, { cents: true })}</span>
          {draft && <Button variant="outline" disabled={save.isPending} onClick={doSave}>Save</Button>}
          {draft && <Button disabled={!lines.length} onClick={() => setSigning(true)}>Sign on screen</Button>}
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {t.status === "signed" && (
          <Panel title="Signed" bodyClassName="flex flex-wrap items-end gap-4 p-3">
            {t.signatureKey && <img alt="GC signature" src={`/files/${t.signatureKey}`} className="h-20 rounded border bg-white" />}
            <div className="text-sm">
              <div className="font-medium">{t.signedName}{t.signedTitle ? `, ${t.signedTitle}` : ""}</div>
              <div className="text-[var(--tp-muted)]">{t.signedAt ? new Date(t.signedAt).toLocaleString("en-US") : ""}</div>
            </div>
          </Panel>
        )}
        {t.status === "void" && <div className="rounded-md border border-[var(--tp-red)] p-2 text-sm">Void: {t.voidReason}</div>}
        <fieldset disabled={!draft} className="grid gap-3 sm:grid-cols-3">
          <Field label="Date of work"><Input type="date" value={head.ticketDate} onChange={e => setHead(h => ({ ...h, ticketDate: e.target.value }))} /></Field>
          <Field label="Change order" className="sm:col-span-2">
            <SimpleSelect allowNone noneLabel="— Not linked —" value={head.coItemId ? String(head.coItemId) : null} options={(cos.data ?? []).map(c => ({ value: String(c.id), label: c.label }))} onChange={v => setHead(h => ({ ...h, coItemId: v ? Number(v) : null }))} disabled={!draft} />
          </Field>
          <Field label="Work performed" className="sm:col-span-3"><Textarea value={head.description} maxLength={5000} onChange={e => setHead(h => ({ ...h, description: e.target.value }))} placeholder="Field-drilled 22 embeds at grid C/4–C/7 per GC direction…" /></Field>
        </fieldset>
        <Panel
          title="Lines"
          actions={draft && (
            <div className="flex gap-1">
              {TM_KIND_KEYS.map(k => (
                <Button key={k} size="sm" variant="outline" onClick={() => setLines(ls => [...ls, { kind: k, description: "", qty: 0, unit: k === "material" ? "ea" : "hr", rate: 0 }])}>
                  <Plus className="size-3.5" /> {TM_LINE_KINDS[k]}
                </Button>
              ))}
            </div>
          )}
          bodyClassName="p-0"
        >
          <fieldset disabled={!draft} className="overflow-x-auto">
            <table className="tp-table min-w-[860px]">
              <thead><tr><th>Kind</th><th>Description</th><th className="right">Qty / ST</th><th>Unit</th><th className="right">Rate</th><th className="right">OT qty</th><th className="right">OT rate</th><th className="right">Amount</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="w-32"><SimpleSelect value={l.kind} options={TM_LINE_KINDS} onChange={v => v && setLine(i, { kind: v as TmKind })} disabled={!draft} /></td>
                    <td><Input value={l.description} maxLength={300} onChange={e => setLine(i, { description: e.target.value })} /></td>
                    <td><NumberInput min={0} step="0.25" value={l.qty} onChange={v => setLine(i, { qty: v ?? 0 })} className="w-20" /></td>
                    <td><Input value={l.unit} maxLength={16} onChange={e => setLine(i, { unit: e.target.value })} className="w-16" /></td>
                    <td><NumberInput min={0} step="0.01" value={l.rate} onChange={v => setLine(i, { rate: v ?? 0 })} className="w-24" /></td>
                    <td>{l.kind === "labor" ? <NumberInput min={0} step="0.25" value={l.otQty ?? null} onChange={v => setLine(i, { otQty: v ?? null })} className="w-20" /> : "—"}</td>
                    <td>{l.kind === "labor" ? <NumberInput min={0} step="0.01" value={l.otRate ?? null} onChange={v => setLine(i, { otRate: v ?? null })} className="w-24" /> : "—"}</td>
                    <td className="right num">{fmtMoney(lineAmount(l), { cents: true })}</td>
                    <td>{draft && <button type="button" aria-label="Remove line" onClick={() => setLines(ls => ls.filter((_, n) => n !== i))} className="text-[var(--tp-muted)] hover:text-[var(--tp-red-strong)]"><Trash2 className="size-3.5" /></button>}</td>
                  </tr>
                ))}
                {!lines.length && <tr><td colSpan={9} className="text-[var(--tp-muted)]">No lines. Add labor, equipment or material — or create the ticket from a finalized daily report.</td></tr>}
              </tbody>
            </table>
          </fieldset>
        </Panel>
        <Panel title="Totals" bodyClassName="p-0">
          <table className="tp-table">
            <thead><tr><th>Kind</th><th className="right">Subtotal</th><th className="right">Markup %</th><th className="right">Markup</th><th className="right">Total</th></tr></thead>
            <tbody>
              {TM_KIND_KEYS.map(k => (
                <tr key={k}>
                  <td>{TM_LINE_KINDS[k]}</td>
                  <td className="right num">{fmtMoney(totals.byKind[k].subtotal, { cents: true })}</td>
                  <td className="right">{draft ? <NumberInput min={0} step="0.5" value={markup[k]} onChange={v => setMarkup(m => ({ ...m, [k]: v ?? 0 }))} className="ml-auto w-20" /> : <span className="num">{markup[k]} %</span>}</td>
                  <td className="right num">{fmtMoney(totals.byKind[k].markup, { cents: true })}</td>
                  <td className="right num">{fmtMoney(totals.byKind[k].total, { cents: true })}</td>
                </tr>
              ))}
              <tr><td colSpan={4} className="font-semibold">Ticket total</td><td className="right num font-semibold">{fmtMoney(totals.grandTotal, { cents: true })}</td></tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Photos" bodyClassName="p-3">
          <RecordPhotos projectId={projectId} entityType="tmTicket" entityId={id} canUpload={t.status !== "void"} />
        </Panel>
        {signing && draft && (
          <Panel title={`GC acknowledgement — ${fmtMoney(totals.grandTotal, { cents: true })}`} bodyClassName="space-y-3 p-3">
            <p className="text-sm">Unsaved changes are saved before signing. The signer acknowledges the labor, equipment and material listed above were used on the described work.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Signer name"><Input value={signer.name} maxLength={120} onChange={e => setSigner(s => ({ ...s, name: e.target.value }))} /></Field>
              <Field label="Title / company"><Input value={signer.title} maxLength={120} onChange={e => setSigner(s => ({ ...s, title: e.target.value }))} placeholder="Superintendent, GC" /></Field>
            </div>
            <SignaturePad
              busy={sign.isPending || save.isPending}
              onCancel={() => setSigning(false)}
              onAccept={async png => {
                if (signer.name.trim().length < 2) return toast.error("Enter the signer's name.");
                if (lines.some(l => !l.description.trim())) return toast.error("Every line needs a description.");
                try {
                  await save.mutateAsync({ id, ticketDate: head.ticketDate, description: head.description || null, coItemId: head.coItemId, markup, lines });
                  sign.mutate({ id, signedName: signer.name.trim(), signedTitle: signer.title.trim() || null, signaturePng: png });
                } catch {
                  /* save's onError toasts */
                }
              }}
            />
          </Panel>
        )}
        {t.status !== "void" && (
          <div className="flex items-center gap-2">
            <Input className="max-w-sm" placeholder="Reason to void (to reissue)" value={voidReason} maxLength={500} onChange={e => setVoidReason(e.target.value)} />
            <ConfirmButton
              title={`Void ${t.label}?`}
              body="A void ticket stays on record and can't be edited. Create a new ticket to reissue."
              disabled={voidReason.trim().length < 3}
              onConfirm={() => voidM.mutate({ id, reason: voidReason.trim() })}
            >
              Void ticket
            </ConfirmButton>
          </div>
        )}
      </div>
    </RecordDrawer>
  );
}
