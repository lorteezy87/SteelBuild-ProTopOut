import { BOLT_GRADES, BOLT_METHODS, NDT_METHODS, QC_RESULTS, SI_RESULTS, SI_TYPES, WELD_PROCESSES } from "@shared/qc";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useSearch } from "wouter";
import { PrintShell } from "./PrintShell";

const l = (m: Record<string, string>, k: string | null | undefined) => (k ? m[k] ?? k : "—");
const v = (x: unknown) => (x == null || x === "" ? "—" : String(x));

/** Printable field QC log: bolting, welding and special inspections, with an inspector sign-off. */
export default function QcLog({ params }: { params: { projectId: string } }) {
  const projectId = Number(params.projectId);
  const seq = new URLSearchParams(useSearch()).get("sequence");
  const q = trpc.qc.print.useQuery({ projectId, ...(seq ? { taskId: Number(seq) } : {}) });
  if (q.isLoading) return <Loading label="Loading QC log…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Not found")} />;
  const { bolts, welds, inspections, sequence } = q.data;
  return (
    <PrintShell title="Field QC log" subtitle={sequence ? `Sequence: ${sequence}` : "All sequences"} projectId={projectId}>
      <h2>High-strength bolting</h2>
      {!bolts.length ? <p>No bolting entries.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Sequence</th><th>Location</th><th>Grade</th><th>Method</th><th>Lot</th><th className="right">Bolts</th><th>Inspector</th><th>Result</th><th>Punch</th></tr></thead>
          <tbody>
            {bolts.map(r => (
              <tr key={r.id}>
                <td>{fmtDate(r.logDate)}</td><td>{v(r.sequence)}</td><td>{r.location}</td><td>{l(BOLT_GRADES, r.grade)}</td><td>{l(BOLT_METHODS, r.method)}</td>
                <td>{v(r.lotNumber)}</td><td className="right">{v(r.boltCount)}</td><td>{v(r.inspectorName)}</td><td>{l(QC_RESULTS, r.result)}</td><td>{v(r.punchLabel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Field welding</h2>
      {!welds.length ? <p>No weld entries.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Sequence</th><th>Joint</th><th>Welder</th><th>WPS</th><th>Process</th><th>Size</th><th>NDT</th><th>Inspector</th><th>Result</th><th>Punch</th></tr></thead>
          <tbody>
            {welds.map(r => (
              <tr key={r.id}>
                <td>{fmtDate(r.logDate)}</td><td>{v(r.sequence)}</td><td>{r.location}</td><td>{v(r.welder)}</td><td>{v(r.wps)}</td><td>{l(WELD_PROCESSES, r.process)}</td>
                <td>{v(r.weldSize)}</td><td>{l(NDT_METHODS, r.ndt)}</td><td>{v(r.inspectorName)}</td><td>{l(QC_RESULTS, r.result)}</td><td>{v(r.punchLabel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Special inspections</h2>
      {!inspections.length ? <p>No special inspections.</p> : (
        <table>
          <thead><tr><th>Inspection</th><th>Sequence</th><th>Agency</th><th>Requested</th><th>Scheduled</th><th>Inspected</th><th>Report</th><th>Result</th><th>Punch</th></tr></thead>
          <tbody>
            {inspections.map(r => (
              <tr key={r.id}>
                <td>{l(SI_TYPES, r.type)}</td><td>{v(r.sequence)}</td><td>{v(r.agency)}</td><td>{fmtDate(r.requestedDate)}</td><td>{fmtDate(r.scheduledDate)}</td>
                <td>{fmtDate(r.inspectedDate)}</td><td>{v(r.reportNumber)}</td><td>{l(SI_RESULTS, r.result)}</td><td>{v(r.punchLabel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="avoid-break mt-6">
        <thead><tr><th className="w-48">Role</th><th>Name</th><th className="w-48">Signature</th><th className="w-28">Date</th></tr></thead>
        <tbody>
          <tr><td>Erector QC</td><td /><td /><td /></tr>
          <tr><td>Special inspector</td><td /><td /><td /></tr>
        </tbody>
      </table>
    </PrintShell>
  );
}
