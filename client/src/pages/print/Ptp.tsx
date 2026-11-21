import { ErrorState, Loading } from "@/components/brand/Layout";
import { PpeTicks, SignIn, StepsTable } from "@/features/safety/printParts";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PrintShell } from "./PrintShell";

/** Printable pre-task plan with the crew sign-in. */
export default function Ptp({ params }: { params: { id: string } }) {
  const q = trpc.safety.ptps.get.useQuery({ id: Number(params.id) });
  if (q.isLoading) return <Loading label="Loading pre-task plan…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Pre-task plan not found")} />;
  const p = q.data;
  return (
    <PrintShell title="Pre-task plan" subtitle={fmtDate(p.planDate, { year: true })} projectId={p.projectId}>
      <table className="mb-3">
        <tbody>
          <tr><th className="w-44">Foreman</th><td>{p.foremanName ?? "—"}</td></tr>
          <tr><th>Sequence / task</th><td>{p.taskName ?? "—"}</td></tr>
          <tr><th>From JHA</th><td>{p.jhaTitle ?? "—"}</td></tr>
          <tr><th>Today's work</th><td className="whitespace-pre-wrap">{p.workDescription || "—"}</td></tr>
        </tbody>
      </table>
      <h2>Steps, hazards and controls</h2>
      <StepsTable steps={p.steps} />
      <h2>PPE</h2>
      <PpeTicks ppe={p.ppe} />
      <h2>Crew sign-in</h2>
      <p className="text-[11px]">By signing I confirm I reviewed this plan and understand its hazards and controls.</p>
      <SignIn attendees={p.attendees} />
    </PrintShell>
  );
}
