import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/brand/Layout";
import { fmtNum } from "@/lib/format";
import { useThemeTokens } from "@/hooks/useThemeTokens";
import { formatCell, type ReportConfig, type ReportData } from "./model";

const PALETTE_TOKENS = [
  "--chart-1", "--chart-2", "--chart-3", "--chart-5", "--chart-4",
  "--tp-muted", "--tp-red-strong", "--tp-blue", "--tp-ink-2", "--tp-orange", "--tp-accent-ink",
] as const;
const CHART_TOKENS = [...PALETTE_TOKENS, "--tp-rule", "--tp-paper"] as const;

function recordLink(row: Record<string, unknown>, config?: ReportConfig) {
  const id = Number(row.id),
    pid = Number(row._projectId);
  if (!id || !config) return null;
  if (config.source === "jobs") return `/jobs/${id}`;
  if (config.source === "tasks" && pid) return `/jobs/${pid}/tasks?task=${id}`;
  if (config.source === "deliveries" && pid)
    return `/jobs/${pid}/deliveries/${id}`;
  if (config.source === "logs" && config.appKey)
    return pid ? `/jobs/${pid}/logs/${config.appKey}/${id}` : `/bids/${id}`;
  return null;
}
export function ReportResult({
  result,
  config,
  compact = false,
}: {
  result: ReportData;
  config?: ReportConfig;
  compact?: boolean;
}) {
  const colors = useThemeTokens(CHART_TOKENS);
  const palette = PALETTE_TOKENS.map(name => colors[name]);
  const [page, setPage] = useState(0);
  const pageSize = compact ? 12 : 100;
  useEffect(() => setPage(0), [result]);
  const pages = Math.max(1, Math.ceil(result.rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  if (
    !result.totalRows ||
    (result.output !== "table" && !result.series?.length)
  )
    return (
      <EmptyState
        title="No matching records"
        body="Adjust the source or filters to include records."
        className="py-8"
      />
    );
  if (result.output === "table")
    return (
      <div>
        {!!result.groups?.length && (
          <div className="flex max-h-40 flex-wrap gap-2 overflow-auto border-b border-[var(--tp-rule)] p-3">
            {result.groups.map(g => (
              <div
                key={g.key}
                className="border border-[var(--tp-rule)] bg-[var(--tp-bone)] px-2 py-1 text-xs"
              >
                <strong>{g.label}</strong>
                <span className="num ml-2">{fmtNum(g.count)} records</span>
                {Object.entries(g.totals).map(([key, value]) => {
                  const c = result.columns.find(x => x.key === key);
                  return c ? (
                    <span key={key} className="ml-3">
                      {c.label}:{" "}
                      <span className="num">{formatCell(value, c)}</span>
                    </span>
                  ) : null;
                })}
              </div>
            ))}
          </div>
        )}
        <div
          className="overflow-auto"
          style={{ maxHeight: compact ? 360 : 620 }}
        >
          <table className="tp-table">
            <thead>
              <tr>
                {result.columns.map(c => (
                  <th
                    key={c.key}
                    className={
                      ["number", "currency", "percent"].includes(c.type)
                        ? "text-right"
                        : ""
                    }
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows
                .slice(current * pageSize, (current + 1) * pageSize)
                .map((row, i) => {
                  const link = recordLink(row, config);
                  return (
                    <tr key={String(row.id ?? i)}>
                      {result.columns.map((c, j) => (
                        <td
                          key={c.key}
                          className={
                            ["number", "currency", "percent"].includes(c.type)
                              ? "right num"
                              : c.type === "date"
                                ? "num whitespace-nowrap"
                                : ""
                          }
                        >
                          {j === 0 && link ? (
                            <Link
                              href={link}
                              className="font-medium hover:text-[var(--tp-accent-ink)] hover:underline"
                            >
                              {formatCell(row[c.key], c)}
                            </Link>
                          ) : (
                            formatCell(row[c.key], c)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--tp-rule)] px-3 py-2 text-xs text-muted-foreground">
          <span className="num">
            {fmtNum(result.rows.length)} shown / {fmtNum(result.totalRows)}{" "}
            matching{result.truncated ? " · 15,000-row cap reached" : ""}
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!current}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <span className="num">
                {current + 1} / {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  const series = result.series ?? [];
  const metricColumn = result.columns.find(
    c => c.key === config?.metric?.field
  );
  const metricFormat = (value: number) =>
    metricColumn
      ? formatCell(value, metricColumn)
      : fmtNum(value, Number.isInteger(value) ? 0 : 2);
  const tooltip = (
    <Tooltip
      formatter={(value: number) => [
        metricFormat(value),
        config?.metric?.agg === "count"
          ? "Records"
          : (metricColumn?.label ?? "Value"),
      ]}
      labelStyle={{ color: "var(--tp-ink)" }}
      itemStyle={{ color: "var(--tp-ink-2)" }}
      cursor={{ fill: "var(--tp-gray-soft)", stroke: "var(--tp-muted)" }}
      contentStyle={{
        background: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--tp-rule)",
        borderRadius: 3,
        fontSize: 12,
      }}
    />
  );
  return (
    <div className="px-3 pt-3">
      <div
        role="img"
        aria-label={`${result.output} report chart, ${series.length} groups`}
        className="w-full"
        style={{ height: compact ? 260 : 360 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {result.output === "pie" ? (
            <PieChart>
              <Pie
                data={series}
                dataKey="value"
                nameKey="label"
                innerRadius={compact ? 45 : 65}
                outerRadius={compact ? 80 : 110}
                paddingAngle={1}
                stroke={colors["--tp-paper"]}
                isAnimationActive={false}
              >
                {series.map((s, i) => (
                  <Cell key={s.label} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              {tooltip}
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={value => <span className="text-[var(--tp-ink-2)]">{value}</span>} />
            </PieChart>
          ) : result.output === "line" ? (
            <LineChart
              data={series}
              margin={{ top: 8, right: 12, left: 0, bottom: 12 }}
            >
              <CartesianGrid stroke={colors["--tp-rule"]} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: colors["--tp-muted"] }}
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 11, fill: colors["--tp-muted"] }} width={60} />
              {tooltip}
              <Line
                dataKey="value"
                name={metricColumn?.label ?? "Records"}
                stroke={colors["--chart-1"]}
                strokeWidth={2}
                dot={series.length < 30}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <BarChart
              data={series}
              margin={{ top: 8, right: 12, left: 0, bottom: 12 }}
            >
              <CartesianGrid stroke={colors["--tp-rule"]} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: colors["--tp-muted"] }}
                minTickGap={12}
              />
              <YAxis tick={{ fontSize: 11, fill: colors["--tp-muted"] }} width={60} />
              {tooltip}
              <Bar
                dataKey="value"
                name={metricColumn?.label ?? "Records"}
                fill={colors["--chart-2"]}
                maxBarSize={48}
                isAnimationActive={false}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="num border-t border-[var(--tp-rule)] py-2 text-[11px] text-muted-foreground">
        {fmtNum(result.totalRows)} matching records
        {result.truncated && " · 15,000-row cap reached"}
      </div>
    </div>
  );
}
export default ReportResult;
