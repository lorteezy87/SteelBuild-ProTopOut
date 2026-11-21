import { ErrorState, Loading } from "@/components/brand/Layout";
import { SignIn } from "@/features/safety/printParts";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PrintShell } from "./PrintShell";

/** Printable toolbox talk with its sign-in sheet. */
export default function Toolbox({ params }: { params: { id: string } }) {
  const q = trpc.safety.talks.get.useQuery({ id: Number(params.id) });
  if (q.isLoading) return <Loading label="Loading toolbox talk…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Toolbox talk not found")} />;
  const t = q.data;
  return (
    <PrintShell title="Toolbox talk" subtitle={fmtDate(t.talkDate, { year: true })} projectId={t.projectId}>
      <table className="mb-3">
        <tbody>
          <tr><th className="w-44">Topic</th><td>{t.topic}</td></tr>
          <tr><th>Presenter</th><td>{t.presenter ?? "—"}</td></tr>
          <tr><th>Notes</th><td className="whitespace-pre-wrap">{t.notes || "—"}</td></tr>
        </tbody>
      </table>
      <h2>Attendance</h2>
      <SignIn attendees={t.attendees} />
    </PrintShell>
  );
}
