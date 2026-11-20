import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STAGES, isStage, type Stage } from "@shared/stages";
import { EmptyState, Panel } from "@/components/brand/Layout";
import { SimpleSelect } from "@/components/brand/Controls";
import { useThemeTokens } from "@/hooks/useThemeTokens";
import { fmtDate, fmtNum } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";

const TOKENS = ["--tp-rule-soft", "--tp-muted", "--tp-accent-ink", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const;
const tooltipStyle = { background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--tp-rule)", borderRadius: 8, fontSize: 12 };

/** Tons erected per day, stacked by the daily report's foreman, against the planned daily rate. */
export function ProductionChart({ projectId }: { projectId: number }) {
  const [stage, setStage] = useState<Stage>("set");
  const q = trpc.daily.production.useQuery({ projectId, stage });
  const { userName } = useRefData();
  const c = useThemeTokens(TOKENS);
  const days = q.data?.days ?? [];
  const foremen = Array.from(new Set(days.flatMap(d => Object.keys(d.byForeman))));
  const palette = [c["--tp-accent-ink"], c["--chart-2"], c["--chart-3"], c["--chart-4"], c["--chart-5"]];
  const label = (k: string) => (k === "none" ? "No foreman" : userName(Number(k)));
  const data = days.map(d => ({ date: d.date, ...Object.fromEntries(foremen.map(f => [f, d.byForeman[f]?.tons ?? 0])) }));
  const plan = q.data?.plan.tonsPerDay ?? null;
  return (
    <Panel
      title="Production — tons per day by foreman"
      actions={<SimpleSelect value={stage} options={STAGES} onChange={v => v && isStage(v) && setStage(v)} />}
    >
      {!days.length ? (
        <EmptyState title="No production yet" body="Finalize daily reports to build the production chart." className="py-10" />
      ) : (
        <div className="h-72 p-3" role="img" aria-label={`Tons per day at stage ${STAGES[stage]}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={c["--tp-rule-soft"]} vertical={false} />
              <XAxis dataKey="date" tickFormatter={v => fmtDate(v)} tick={{ fontSize: 11, fill: c["--tp-muted"] }} minTickGap={24} />
              <YAxis width={50} tick={{ fontSize: 11, fill: c["--tp-muted"] }} />
              <Tooltip labelFormatter={v => fmtDate(String(v))} formatter={(v: number, k: string) => [`${fmtNum(v, 2)} t`, label(k)]} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={k => label(String(k))} />
              {foremen.map((f, i) => (
                <Bar key={f} dataKey={f} stackId="t" fill={palette[i % palette.length]} />
              ))}
              {plan != null && <ReferenceLine y={plan} stroke={c["--tp-muted"]} strokeDasharray="4 3" label={{ value: `Plan ${fmtNum(plan, 1)} t/day`, fontSize: 11, fill: c["--tp-muted"], position: "insideTopRight" }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
