import type { ColumnDef } from "@shared/reports";
import { DATE_RANGES, FILTER_OPS } from "@shared/filters";
import { SimpleSelect } from "@/components/ks/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import type { ReportConfig } from "./model";

type Filter = ReportConfig["filters"][number];
function valueText(value: unknown) {
  return Array.isArray(value)
    ? value.join(", ")
    : value == null
      ? ""
      : String(value);
}
export function FilterBuilder({
  columns,
  filters,
  onChange,
}: {
  columns: ColumnDef[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const update = (i: number, changes: Partial<Filter>) =>
    onChange(
      filters.map((f, index) => (index === i ? { ...f, ...changes } : f))
    );
  return (
    <div className="space-y-2">
      {filters.map((f, i) => {
        const col = columns.find(c => c.key === f.field);
        const numeric =
          !!col && ["number", "currency", "percent"].includes(col.type);
        const parse = (value: string) =>
          numeric && value.trim() !== "" ? Number(value) : value;
        const ops = Object.fromEntries(
          Object.entries(FILTER_OPS).filter(
            ([key]) => key !== "range" || col?.type === "date"
          )
        );
        const input = (
          value: unknown,
          set: (v: unknown) => void,
          placeholder?: string
        ) => (
          <Input
            aria-label={`${col?.label ?? "Filter"} value`}
            value={valueText(value)}
            onChange={e => set(parse(e.target.value))}
            type={numeric ? "number" : "text"}
            placeholder={
              placeholder ??
              (col?.type === "date" ? "YYYY-MM-DD or today+7" : "Value")
            }
            className="bg-[var(--ks-paper)]"
            maxLength={2000}
            list={col?.type === "date" ? "relative-date-tokens" : undefined}
          />
        );
        return (
          <div
            key={i}
            className="grid grid-cols-[minmax(110px,1fr)_minmax(90px,.8fr)_minmax(120px,1.4fr)_32px] items-center gap-2"
          >
            <SimpleSelect
              value={f.field}
              onChange={v => update(i, { field: v ?? "", op: "eq", value: "" })}
              options={columns.map(c => ({ value: c.key, label: c.label }))}
              size="sm"
            />
            <SimpleSelect
              value={f.op}
              onChange={v =>
                update(i, {
                  op: v ?? "eq",
                  value:
                    v === "range"
                      ? "this_week"
                      : v === "between"
                        ? ["", ""]
                        : "",
                })
              }
              options={ops}
              size="sm"
            />
            {f.op === "empty" || f.op === "notempty" ? (
              <span className="text-xs text-muted-foreground">
                No value needed
              </span>
            ) : f.op === "range" ? (
              <SimpleSelect
                value={String(f.value || "this_week")}
                onChange={v => update(i, { value: v })}
                options={DATE_RANGES}
                size="sm"
              />
            ) : f.op === "between" ? (
              <div className="flex gap-1">
                {[0, 1].map(n => (
                  <div key={n} className="min-w-0 flex-1">
                    {input(
                      Array.isArray(f.value) ? f.value[n] : "",
                      value => {
                        const next = Array.isArray(f.value)
                          ? [...f.value]
                          : ["", ""];
                        next[n] = value === "" ? null : value;
                        update(i, { value: next });
                      },
                      n ? "To" : "From"
                    )}
                  </div>
                ))}
              </div>
            ) : f.op === "in" || f.op === "nin" ? (
              <Input
                aria-label="Comma separated filter values"
                value={valueText(f.value)}
                onChange={e =>
                  update(i, {
                    value: e.target.value.split(",").map(v => parse(v.trim())),
                  })
                }
                placeholder="Values, separated, by commas"
                className="bg-[var(--ks-paper)]"
              />
            ) : col?.type === "boolean" ? (
              <SimpleSelect
                value={String(f.value)}
                onChange={v => update(i, { value: v === "true" })}
                options={{ true: "Yes", false: "No" }}
                size="sm"
              />
            ) : col?.options && ["eq", "ne"].includes(f.op) ? (
              <SimpleSelect
                value={String(f.value ?? "")}
                onChange={v => update(i, { value: v })}
                options={col.options}
                size="sm"
              />
            ) : (
              input(f.value, value => update(i, { value }))
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove filter"
              onClick={() => onChange(filters.filter((_, n) => n !== i))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <Button
        size="sm"
        variant="outline"
        disabled={!columns.length || filters.length >= 20}
        onClick={() =>
          onChange([...filters, { field: columns[0].key, op: "eq", value: "" }])
        }
      >
        <Plus className="size-3" />
        Add filter
      </Button>
      <p className="text-[11px] text-muted-foreground">
        All filters must match. Dates accept today, tomorrow, today+N, today-N
        and week/month start/end tokens.
      </p>
      <datalist id="relative-date-tokens">
        {[
          "today",
          "yesterday",
          "tomorrow",
          "today+7",
          "today-30",
          "this_week_start",
          "this_week_end",
          "next_week_start",
          "next_week_end",
          "this_month_start",
          "this_month_end",
          "next_month_start",
          "next_month_end",
        ].map(v => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </div>
  );
}
