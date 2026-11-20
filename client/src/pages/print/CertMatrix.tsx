import { certTypeLabel } from "@shared/certs";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { certStatusText } from "@/features/settings/Certifications";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PrintShell } from "./PrintShell";

/** Printable crew certification matrix, e.g. for a GC orientation packet. */
export default function CertMatrix() {
  const q = trpc.certs.matrix.useQuery();
  if (q.isLoading) return <Loading label="Loading certifications…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Not found")} />;
  const m = q.data;
  const types = m.types.filter(t => m.users.some(u => m.cells[`${u.id}:${t}`]));
  return (
    <PrintShell title="Crew certifications" subtitle={`As of ${fmtDate(m.today, { year: true })}`} landscape>
      {!types.length ? <p>No certifications entered.</p> : (
        <table>
          <thead><tr><th>Crew member</th><th>Classification</th>{types.map(t => <th key={t}>{certTypeLabel(t)}</th>)}</tr></thead>
          <tbody>
            {m.users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.classification ?? "—"}</td>
                {types.map(t => {
                  const c = m.cells[`${u.id}:${t}`];
                  return <td key={t}>{c ? certStatusText(c.status, c.expiresOn) : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PrintShell>
  );
}
