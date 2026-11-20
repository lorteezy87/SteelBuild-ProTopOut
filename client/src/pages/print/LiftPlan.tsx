import { LIFT_SIGNOFFS, liftPlanFields } from "@shared/lift";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { trpc } from "@/lib/trpc";
import { PrintShell } from "./PrintShell";

/** Printable lift plan for one pick: crane, setup, loads, radius, chart capacity and four sign-offs. */
export default function LiftPlan({ params }: { params: { pickId: string } }) {
  const q = trpc.cranes.picks.get.useQuery({ id: Number(params.pickId) });
  if (q.isLoading) return <Loading label="Loading lift plan…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Pick not found")} />;
  const { pick, setup, model, sequence, check } = q.data;
  const critical = check.status === "critical";
  const rows = liftPlanFields(pick, setup, model, check);
  const signed = pick.signoffs ?? {};
  return (
    <PrintShell title={critical ? "Critical lift plan" : "Lift plan"} subtitle={`Pick ${pick.mark}${sequence ? ` · ${sequence}` : ""}`} projectId={pick.projectId}>
      {check.status === "blocked" && (
        <div className="mb-3 border-2 border-red-700 p-2 font-bold text-red-800">DO NOT LIFT — {check.reason}. Re-plan the setup, radius or crane.</div>
      )}
      <table className="avoid-break">
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <th className="w-56">{r.label}</th>
              <td className={r.value === "Not entered" ? "italic text-neutral-500" : ""}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model?.chartNote && <p className="mt-2 text-[11px]">Chart: {model.chartNote}</p>}
      {setup.notes && <p className="mt-1 text-[11px]">Setup notes: {setup.notes}</p>}
      <h2>Load chart used</h2>
      <table className="avoid-break">
        <thead><tr><th className="right">Radius (ft)</th><th className="right">Capacity (lb)</th></tr></thead>
        <tbody>
          {(model?.chart ?? []).map(r => (
            <tr key={r.radiusFt} className={check.capacityLb === r.capacityLb && pick.radiusFt != null && r.radiusFt >= pick.radiusFt ? "font-bold" : ""}>
              <td className="right">{r.radiusFt}</td>
              <td className="right">{r.capacityLb.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Sign-offs</h2>
      <table className="avoid-break">
        <thead><tr><th className="w-40">Role</th><th>Name</th><th className="w-48">Signature</th><th className="w-28">Date</th></tr></thead>
        <tbody>
          {LIFT_SIGNOFFS.map(s => (
            <tr key={s.key} className="h-10">
              <td>{s.label}</td>
              <td>{signed[s.key]?.name ?? ""}</td>
              <td />
              <td>{signed[s.key]?.date ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] text-neutral-600">
        Capacity is the chart value at the next longer radius (no interpolation). Critical lift: ≥ 75 % of chart capacity. Verify ground conditions, rigging
        and radius in the field before the pick.
      </p>
    </PrintShell>
  );
}
