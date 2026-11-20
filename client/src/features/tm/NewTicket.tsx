import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/brand/Layout";
import { RecordDrawer, SimpleSelect } from "@/components/brand/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMsg } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";

export function NewTicket({ projectId, fromDailyReportId, defaultDate, onClose, onCreated }: { projectId: number; fromDailyReportId?: number; defaultDate?: string; onClose: () => void; onCreated: (id: number) => void }) {
  const cos = trpc.tm.changeOrders.useQuery({ projectId });
  const { today } = useRefData();
  const utils = trpc.useUtils();
  const [f, setF] = useState({ ticketDate: defaultDate ?? today, description: "", coItemId: null as number | null });
  const create = trpc.tm.create.useMutation({ onSuccess: async r => { await utils.tm.list.invalidate({ projectId }); onCreated(r.id); }, onError: e => toast.error(errMsg(e)) });
  return (
    <RecordDrawer open onOpenChange={o => !o && onClose()} eyebrow="T&M ticket" title={fromDailyReportId ? "New ticket from daily report" : "New ticket"} width={560}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending} onClick={() => create.mutate({ projectId, ...f, description: f.description || null, fromDailyReportId: fromDailyReportId ?? null })}>Create ticket</Button></div>}>
      <div className="grid gap-3 p-4">
        <Field label="Date of work"><Input type="date" value={f.ticketDate} onChange={e => setF(x => ({ ...x, ticketDate: e.target.value }))} /></Field>
        <Field label="Change order"><SimpleSelect allowNone noneLabel="— Not linked —" value={f.coItemId ? String(f.coItemId) : null} options={(cos.data ?? []).map(c => ({ value: String(c.id), label: c.label }))} onChange={v => setF(x => ({ ...x, coItemId: v ? Number(v) : null }))} /></Field>
        <Field label="Work performed"><Input value={f.description} maxLength={5000} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></Field>
        {fromDailyReportId && <p className="text-xs text-[var(--tp-muted)]">Crew hours (ST/OT at bill rates) and equipment operating/standby hours are copied from the report. Edit lines before signing.</p>}
      </div>
    </RecordDrawer>
  );
}
