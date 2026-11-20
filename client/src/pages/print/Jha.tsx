import { JHA_STATUSES, type JhaStatus } from "@shared/safety";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { PpeTicks, StepsTable } from "@/features/safety/printParts";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PrintShell } from "./PrintShell";

/** Printable JHA / AHA: steps, hazards, controls, PPE and the competent person's sign-off. */
export default function Jha({ params }: { params: { id: string } }) {
  const q = trpc.safety.jhas.get.useQuery({ id: Number(params.id) });
  if (q.isLoading) return <Loading label="Loading JHA…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("JHA not found")} />;
  const j = q.data;
  return (
    <PrintShell title="Job hazard analysis" subtitle={j.title} projectId={j.projectId}>
      {j.status !== "active" && <div className="mb-3 border border-neutral-400 p-2 font-semibold">{(JHA_STATUSES[j.status as JhaStatus] ?? j.status).toUpperCase()} — not an active JHA</div>}
      <table className="mb-3">
        <tbody>
          <tr><th className="w-44">Activity</th><td>{j.title}</td></tr>
          <tr><th>Sequence / task</th><td>{j.taskName ?? "—"}</td></tr>
          <tr><th>Competent person</th><td>{j.competentPerson ?? "Not named"}</td></tr>
          <tr><th>Reviewed</th><td>{fmtDate(j.reviewedOn)}</td></tr>
        </tbody>
      </table>
      <h2>Steps, hazards and controls</h2>
      <StepsTable steps={j.steps} />
      <h2>Required PPE</h2>
      <PpeTicks ppe={j.ppe} />
      <table className="avoid-break mt-6">
        <thead><tr><th className="w-48">Role</th><th>Name</th><th className="w-48">Signature</th><th className="w-28">Date</th></tr></thead>
        <tbody>
          <tr><td>Competent person</td><td>{j.competentPerson ?? ""}</td><td /><td /></tr>
          <tr><td>Superintendent</td><td /><td /><td /></tr>
        </tbody>
      </table>
    </PrintShell>
  );
}
