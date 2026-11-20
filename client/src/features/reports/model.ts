import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { RouterOutputs } from "@/lib/ref";
import {
  REPORT_SOURCES,
  type ColumnDef,
  type SourceKey,
} from "@shared/reports";
import { fmtDate, fmtMoney, fmtNum, fmtPct } from "@/lib/format";

export type ReportConfig =
  inferRouterInputs<AppRouter>["reports"]["run"]["config"];
export type ReportData = RouterOutputs["reports"]["run"];
export type Widget =
  inferRouterInputs<AppRouter>["reports"]["saveDashboard"]["widgets"][number];
export const defaultConfig = (source: SourceKey = "jobs"): ReportConfig => ({
  source,
  columns: [...REPORT_SOURCES[source].defaultColumns],
  filters: [],
  output: "table",
  sort: [],
  metric: { agg: "count" },
  dateBucket: "week",
  limit: 15000,
});
export function normalizeConfig(
  config: RouterOutputs["reports"]["get"]["config"]
): ReportConfig {
  return {
    ...config,
    source:
      config.source in REPORT_SOURCES ? (config.source as SourceKey) : "jobs",
  };
}
export function formatCell(value: unknown, column: ColumnDef): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value))
    return value.map(v => formatCell(v, column)).join(", ");
  switch (column.type) {
    case "currency":
      return fmtMoney(Number(value), { cents: true });
    case "number":
      return fmtNum(Number(value), Number.isInteger(Number(value)) ? 0 : 2);
    case "percent":
      return fmtPct(Number(value), 1);
    case "date":
      return fmtDate(String(value));
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return column.options?.[String(value)] ?? String(value);
  }
}
export function exportCsv(result: ReportData, name: string) {
  // Prefix spreadsheet formulas in user text to prevent CSV formula execution.
  const quote = (v: unknown) => {
    let text = v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
    if (/^[=+@-]/.test(text) && typeof v !== "number") text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [
    result.columns.map(c => quote(c.label)).join(","),
    ...result.rows.map(r => result.columns.map(c => quote(r[c.key])).join(",")),
  ];
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w -]/g, "_") || "report"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
