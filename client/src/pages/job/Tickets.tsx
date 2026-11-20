import { useState } from "react";
import { Plus } from "lucide-react";
import { TM_STATUSES, type TmStatus } from "@shared/tm";
import { EmptyState, ErrorState, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { TicketEditor } from "@/features/tm/TicketEditor";
import { NewTicket } from "@/features/tm/NewTicket";
import { fmtDate, fmtMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useJob, useSearchParam } from "./JobContext";

const TONE: Record<TmStatus, "gray" | "green" | "red"> = { draft: "gray", signed: "green", void: "red" };

/** Job tab: T&M / extra-work tickets. */
export default function Tickets() {
  const { projectId, can } = useJob();
  const q = trpc.tm.list.useQuery({ projectId });
  const linked = useSearchParam("ticket");
  const [openId, setOpenId] = useState<string | null>(linked);
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <Loading label="Loading tickets…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = q.data ?? [];
  return (
    <Panel
      title="T&M / extra-work tickets"
      actions={can("dailyreport.create") && <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-3.5" /> Ticket</Button>}
      bodyClassName="p-0"
    >
      {!rows.length ? (
        <EmptyState title="No tickets yet" body="Write up extra work as it happens — or open a finalized daily report and choose Create T&M ticket to price its crew and equipment." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead><tr><th>Ticket</th><th>Date</th><th>Work</th><th>Status</th><th className="right">Total</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(String(r.id))}>
                  <td className="num font-medium">{r.label}</td>
                  <td className="num">{fmtDate(r.ticketDate)}</td>
                  <td className="max-w-md truncate">{r.description || "—"}</td>
                  <td><Pill tone={TONE[r.status as TmStatus] ?? "gray"}>{TM_STATUSES[r.status as TmStatus] ?? r.status}</Pill></td>
                  <td className="right num">{fmtMoney(r.total, { cents: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewTicket projectId={projectId} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(String(id)); }} />}
      {openId && <TicketEditor id={Number(openId)} projectId={projectId} onClose={() => setOpenId(null)} />}
    </Panel>
  );
}
