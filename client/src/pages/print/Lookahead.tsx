import { ErrorState, Loading } from "@/components/brand/Layout";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { LookaheadGrid } from "./LookaheadGrid";
import { PrintShell } from "./PrintShell";

/** Printable 3-week look-ahead from the schedule. */
export default function Lookahead({ params }: { params: { projectId: string; from: string } }) {
  const projectId = Number(params.projectId);
  const q = trpc.gcReport.lookahead.useQuery({ projectId, from: params.from });
  if (q.isLoading) return <Loading label="Loading look-ahead…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Not found")} />;
  return (
    <PrintShell title="3-week look-ahead" subtitle={`${fmtDate(q.data.weeks[0].start)} – ${fmtDate(q.data.weeks[2].end)}`} projectId={projectId} landscape>
      <LookaheadGrid la={q.data} />
    </PrintShell>
  );
}
