import { PPE_ITEMS, PPE_KEYS, type Attendee, type JhaStep } from "@shared/safety";

export function StepsTable({ steps }: { steps: JhaStep[] }) {
  if (!steps.length) return <p>No steps entered.</p>;
  return (
    <table>
      <thead><tr><th className="w-8">#</th><th>Task step</th><th>Hazards</th><th>Controls</th></tr></thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={i} className="avoid-break">
            <td>{i + 1}</td>
            <td className="whitespace-pre-wrap">{s.step}</td>
            <td className="whitespace-pre-wrap">{s.hazards}</td>
            <td className="whitespace-pre-wrap">{s.controls}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PpeTicks({ ppe }: { ppe: string[] }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-x-4 text-[12px]">
      {PPE_KEYS.map(k => (
        <div key={k}>{ppe.includes(k) ? "☒" : "☐"} {PPE_ITEMS[k]}</div>
      ))}
    </div>
  );
}

/** Sign-in sheet: printed names with blank signature cells, plus spare rows for walk-ups. */
export function SignIn({ attendees, spare = 6 }: { attendees: Attendee[]; spare?: number }) {
  const rows = [...attendees.map(a => a.name), ...Array.from({ length: spare }, () => "")];
  return (
    <table>
      <thead><tr><th className="w-8">#</th><th>Name (print)</th><th className="w-64">Signature</th></tr></thead>
      <tbody>
        {rows.map((n, i) => (
          <tr key={i} className="h-8"><td>{i + 1}</td><td>{n}</td><td /></tr>
        ))}
      </tbody>
    </table>
  );
}
