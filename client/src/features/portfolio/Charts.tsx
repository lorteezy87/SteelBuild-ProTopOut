import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { useLocation } from "wouter";
import type { RouterOutputs } from "@/lib/ref";
import { EmptyState } from "@/components/brand/Layout";
import { fmtDate, fmtNum } from "@/lib/format";
import { useThemeTokens } from "@/hooks/useThemeTokens";

const CHART_TOKENS = ["--tp-rule-soft", "--tp-muted", "--tp-accent-ink", "--chart-2"] as const;

type Portfolio = RouterOutputs["dashboard"]["portfolio"];
const tooltipStyle = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--tp-rule)",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(16,24,40,0.08)",
  fontSize: 12,
};
export function TonsChart({ data }: { data: Portfolio["tons"] }) {
  const colors = useThemeTokens(CHART_TOKENS);
  if (!data.length)
    return (
      <EmptyState
        title="No tonnage plan"
        body="Plan erection sequences and approve daily progress to build the curve."
        className="py-10"
      />
    );
  return (
    <div
      className="h-72 p-3"
      role="img"
      aria-label="Cumulative tons erected versus plan by week"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={colors["--tp-rule-soft"]} vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={v => fmtDate(v)}
            tick={{ fontSize: 11, fill: colors["--tp-muted"] }}
            minTickGap={30}
          />
          <YAxis width={55} tick={{ fontSize: 11, fill: colors["--tp-muted"] }} />
          <Tooltip
            labelFormatter={v => `Week of ${fmtDate(String(v))}`}
            formatter={(v: number) => `${fmtNum(v, 1)} t`}
            contentStyle={tooltipStyle} labelStyle={{ color: "var(--tp-ink)" }} itemStyle={{ color: "var(--tp-ink-2)" }} cursor={{ fill: "var(--tp-gray-soft)", stroke: "var(--tp-muted)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={value => <span className="text-[var(--tp-ink-2)]">{value}</span>} />
          <Line
            dataKey="planned"
            name="Planned"
            stroke={colors["--tp-muted"]}
            strokeDasharray="4 3"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <Line
            dataKey="erected"
            name="Erected"
            stroke={colors["--tp-accent-ink"]}
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export function RfiChart({ data }: { data: Portfolio["rfiAging"] }) {
  const colors = useThemeTokens(CHART_TOKENS);
  const [, navigate] = useLocation();
  return (
    <div className="h-56 p-3" role="img" aria-label="Open RFIs by age">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -20, right: 8, top: 10 }}>
          <CartesianGrid stroke={colors["--tp-rule-soft"]} vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: colors["--tp-muted"] }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: colors["--tp-muted"] }} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--tp-ink)" }} itemStyle={{ color: "var(--tp-ink-2)" }} cursor={{ fill: "var(--tp-gray-soft)", stroke: "var(--tp-muted)" }} />
          <Bar
            dataKey="count"
            name="Open RFIs"
            fill={colors["--chart-2"]}
            maxBarSize={48}
            isAnimationActive={false}
            cursor="pointer"
            onClick={() => navigate("/logs/rfi")}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function CrewChart({ data }: { data: Portfolio["crewHours"]["byJob"] }) {
  const colors = useThemeTokens(CHART_TOKENS);
  const [, navigate] = useLocation();
  if (!data.length)
    return (
      <EmptyState
        title="No crew hours this week"
        body="Submit timesheets or approve daily reports to post hours."
        className="py-8"
      />
    );
  return (
    <div
      className="h-56 p-3"
      role="img"
      aria-label="Crew hours this week by job"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data.map(j => ({ ...j, label: j.code || j.name }))}
          layout="vertical"
          margin={{ top: 8, bottom: 0, right: 15 }}
        >
          <CartesianGrid stroke={colors["--tp-rule-soft"]} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: colors["--tp-muted"] }} />
          <YAxis
            type="category"
            dataKey="label"
            width={78}
            tick={{ fontSize: 11, fill: colors["--tp-muted"] }}
          />
          <Tooltip
            contentStyle={tooltipStyle} labelStyle={{ color: "var(--tp-ink)" }} itemStyle={{ color: "var(--tp-ink-2)" }} cursor={{ fill: "var(--tp-gray-soft)", stroke: "var(--tp-muted)" }}
            formatter={(v: number) => `${fmtNum(v, 1)} h`}
          />
          <Bar
            dataKey="hours"
            name="Crew hours"
            fill={colors["--chart-2"]}
            maxBarSize={24}
            isAnimationActive={false}
            cursor="pointer"
            onClick={d => {
              if (d.projectId) navigate(`/jobs/${d.projectId}`);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
