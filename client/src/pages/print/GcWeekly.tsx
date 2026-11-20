import { ErrorState, Loading } from "@/components/brand/Layout";
import { DELIVERY_STATUSES } from "@shared/domain";
import { fmtDate, fmtMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { LookaheadGrid } from "./LookaheadGrid";
import { PrintShell } from "./PrintShell";

const t2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Log = { id: number; label: string; title: string; state: string; ballInCourt: string; dueDate: string | null; costImpact: number; scheduleImpactDays: number };

function LogTable({ title, rows, money }: { title: string; rows: Log[]; money?: boolean }) {
  return (
    <div className="avoid-break">
      <h2>{title} ({rows.length})</h2>
      {!rows.length ? (
        <p className="italic text-neutral-600">None open.</p>
      ) : (
        <table>
          <thead><tr><th className="w-20">No.</th><th>Title</th><th className="w-28">Status</th><th className="w-24">Ball in court</th><th className="w-20">Due</th>{money && <th className="right w-24">Amount</th>}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}><td>{r.label}</td><td>{r.title}</td><td>{r.state}</td><td>{r.ballInCourt}</td><td>{r.dueDate ? fmtDate(r.dueDate) : "—"}</td>{money && <td className="right">{r.costImpact ? fmtMoney(r.costImpact) : "—"}</td>}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Weekly report to the GC: tons by sequence vs plan, look-ahead, open RFIs/COs/delays, deliveries and photos. */
export default function GcWeekly({ params }: { params: { projectId: string; weekStart: string } }) {
  const projectId = Number(params.projectId);
  const q = trpc.gcReport.weekly.useQuery({ projectId, weekStart: params.weekStart });
  if (q.isLoading) return <Loading label="Loading weekly report…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Not found")} />;
  const r = q.data;
  const none = r.tons.finalReportsThisWeek === 0;
  const tot = r.tons.rows.reduce((a, x) => ({ planned: a.planned + x.plannedTons, toDate: a.toDate + x.toDate, week: a.week + (x.thisWeek ?? 0) }), { planned: 0, toDate: 0, week: 0 });
  const status = (s: string) => DELIVERY_STATUSES[s as keyof typeof DELIVERY_STATUSES] ?? s;
  return (
    <PrintShell title="Weekly erection report" subtitle={`Week of ${fmtDate(r.weekStart)} – ${fmtDate(r.weekEnd)}`} projectId={projectId}>
      <h2>Steel erected (set / hung) by sequence</h2>
      {none && <p className="mb-1 font-semibold">No final daily reports this week.</p>}
      <table className="avoid-break">
        <thead><tr><th>Sequence</th><th className="right">Planned t</th><th className="right">Erected to date t</th><th className="right">This week t</th><th className="right">% complete</th></tr></thead>
        <tbody>
          {r.tons.rows.map(x => (
            <tr key={x.id}>
              <td>{x.name}</td>
              <td className="right">{t2(x.plannedTons)}</td>
              <td className="right">{t2(x.toDate)}</td>
              <td className="right">{x.thisWeek == null ? "—" : t2(x.thisWeek)}</td>
              <td className="right">{x.pct == null ? "—" : `${x.pct.toFixed(1)} %`}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td>Total</td>
            <td className="right">{t2(tot.planned)}</td>
            <td className="right">{t2(tot.toDate)}</td>
            <td className="right">{none ? "—" : t2(tot.week)}</td>
            <td className="right">{tot.planned > 0 ? `${((tot.toDate / tot.planned) * 100).toFixed(1)} %` : "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-neutral-600">{none ? "This week's column is blank because no daily report was finalized for the week." : `From ${r.tons.finalReportsThisWeek} finalized daily report(s).`}</p>
      <h2>3-week look-ahead (from {fmtDate(r.lookahead.from)})</h2>
      <LookaheadGrid la={r.lookahead} />
      <LogTable title="Open RFIs" rows={r.rfis} />
      <LogTable title="Open change orders" rows={r.cos} money />
      <LogTable title="Open delay notices" rows={r.delays} />
      {(["thisWeek", "nextWeek"] as const).map(k => (
        <div key={k} className="avoid-break">
          <h2>Deliveries {k === "thisWeek" ? "this week" : "next week"}</h2>
          {!r.deliveries[k].length ? (
            <p className="italic text-neutral-600">None scheduled.</p>
          ) : (
            <table>
              <thead><tr><th className="w-20">Load</th><th>Description</th><th className="w-24">Date</th><th className="w-24">Status</th><th className="right w-20">Tons</th><th className="right w-16">Pcs</th></tr></thead>
              <tbody>
                {r.deliveries[k].map(l => (
                  <tr key={l.id}><td>{l.loadNumber}</td><td>{l.description ?? "—"}</td><td>{l.date ? fmtDate(l.date) : "—"}</td><td>{status(l.status)}</td><td className="right">{t2(l.tons)}</td><td className="right">{l.pieces}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <h2>Photos</h2>
      {!r.photos.length ? (
        <p className="italic text-neutral-600">No photos in the photo log for this week.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {r.photos.map(p => (
            <figure key={p.id} className="avoid-break">
              <img src={p.url} alt={p.name} className="h-40 w-full border object-cover" />
              <figcaption className="text-[10px]">{p.reportDate ? `${p.estimated ? "uploaded " : ""}${fmtDate(p.reportDate)}` : ""} · {p.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </PrintShell>
  );
}
