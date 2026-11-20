import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { readableDataColor } from "@/lib/theme";
import { DateInput, NumberInput, SimpleSelect, UserSelect } from "./Controls";

export type CfDef = {
  id?: number;
  key: string;
  label: string;
  fieldType: string;
  options?: { value: string; label: string; color?: string }[] | null;
  formula?: string | null;
  required?: boolean;
  isFinancial?: boolean;
  helpText?: string | null;
  showInList?: boolean;
  colorRules?: { op: string; value: number | string; color: string }[] | null;
};

export type CfValues = Record<string, unknown>;

function ruleColor(def: CfDef, v: unknown): string | undefined {
  if (!def.colorRules?.length || typeof v !== "number") return undefined;
  for (const r of def.colorRules) {
    const t = Number(r.value);
    const hit = r.op === "lt" ? v < t : r.op === "lte" ? v <= t : r.op === "gt" ? v > t : r.op === "gte" ? v >= t : v === t;
    if (hit) return r.color;
  }
  return undefined;
}

/** Read-only rendering of one custom field value. */
export function CfValue({ def, value, className }: { def: CfDef; value: unknown; className?: string }) {
  const { userName } = useRefData();
  useTheme(); // Re-evaluate configured colors whenever the resolved palette changes.
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return <span className="text-muted-foreground">—</span>;
  const color = ruleColor(def, value);
  const style = color ? { color: readableDataColor(color), borderBottom: `2px solid ${color}` } : undefined;
  switch (def.fieldType) {
    case "currency":
      return <span className={cn("num", className)} style={style}>{fmtMoney(Number(value), { cents: true })}</span>;
    case "number":
    case "decimal":
    case "formula":
      return typeof value === "number" ? (
        <span className={cn("num", className)} style={style}>{fmtNum(value, def.fieldType === "number" ? 0 : 2)}</span>
      ) : (
        <span className={className}>{String(value)}</span>
      );
    case "date":
      return <span className={cn("num", className)}>{fmtDate(String(value))}</span>;
    case "boolean":
      return <span className={className}>{value ? "Yes" : "No"}</span>;
    case "user":
      return <span className={className}>{userName(Number(value))}</span>;
    case "select": {
      const o = def.options?.find(x => x.value === value);
      return o?.color ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px]">
          <span className="size-2 rounded-full" style={{ background: o.color }} />
          {o.label}
        </span>
      ) : (
        <span className={className}>{o?.label ?? String(value)}</span>
      );
    }
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      return <span className={className}>{arr.map(v => def.options?.find(x => x.value === v)?.label ?? String(v)).join(", ")}</span>;
    }
    case "richtext":
      return <div className={cn("whitespace-pre-wrap text-[13px] leading-relaxed", className)}>{String(value)}</div>;
    default:
      return <span className={className}>{String(value)}</span>;
  }
}

/** Editor for one custom field. Formula fields are read-only. */
export function CfInput({ def, value, onChange }: { def: CfDef; value: unknown; onChange: (v: unknown) => void }) {
  switch (def.fieldType) {
    case "richtext":
      return <Textarea value={(value as string) ?? ""} onChange={e => onChange(e.target.value || null)} rows={3} className="bg-[var(--tp-paper)]" />;
    case "number":
    case "decimal":
    case "currency":
      return <NumberInput value={(value as number) ?? null} onChange={onChange} step={def.fieldType === "number" ? 1 : "0.01"} />;
    case "date":
      return <DateInput value={(value as string) ?? null} onChange={onChange} />;
    case "boolean":
      return (
        <label className="flex h-9 items-center gap-2 text-[13px]">
          <Checkbox checked={!!value} onCheckedChange={c => onChange(!!c)} />
          {value ? "Yes" : "No"}
        </label>
      );
    case "select":
      return (
        <SimpleSelect
          value={(value as string) ?? null}
          onChange={onChange}
          allowNone={!def.required}
          options={(def.options ?? []).map(o => ({ value: o.value, label: o.label }))}
        />
      );
    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-input bg-[var(--tp-paper)] px-3 py-2">
          {(def.options ?? []).map(o => (
            <label key={o.value} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox
                checked={arr.includes(o.value)}
                onCheckedChange={c => onChange(c ? [...arr, o.value] : arr.filter(x => x !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "user":
      return <UserSelect value={(value as number) ?? null} onChange={onChange} />;
    case "formula":
      return (
        <div className="flex h-9 items-center rounded-md border border-dashed border-input px-3 text-[13px] text-muted-foreground">
          <CfValue def={def} value={value} />
          <span className="ml-auto font-mono text-[11px]">= formula</span>
        </div>
      );
    default:
      return <Input value={(value as string) ?? ""} onChange={e => onChange(e.target.value || null)} className="bg-[var(--tp-paper)]" />;
  }
}

/** Grid of custom field editors. */
export function CfForm({ defs, values, onChange, columns = 2 }: { defs: CfDef[]; values: CfValues; onChange: (next: CfValues) => void; columns?: 1 | 2 }) {
  if (!defs.length) return null;
  return (
    <div className={cn("grid gap-x-4 gap-y-3", columns === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
      {defs.map(def => (
        <div key={def.key} className={cn(def.fieldType === "richtext" || def.fieldType === "multiselect" ? "sm:col-span-2" : "")}>
          <label className="label-caps mb-1 block">
            {def.label}
            {def.required && <span className="ml-0.5 text-[var(--tp-red-strong)]">*</span>}
          </label>
          <CfInput def={def} value={values[def.key]} onChange={v => onChange({ ...values, [def.key]: v })} />
          {def.helpText && <div className="mt-1 text-[11.5px] text-muted-foreground">{def.helpText}</div>}
        </div>
      ))}
    </div>
  );
}

/** Read-only grid of custom field values. */
export function CfDisplay({ defs, values, columns = 2 }: { defs: CfDef[]; values: CfValues; columns?: 1 | 2 | 3 }) {
  if (!defs.length) return null;
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
      {defs.map(def => (
        <div key={def.key} className={cn(def.fieldType === "richtext" ? "sm:col-span-full" : "")}>
          <dt className="label-caps mb-0.5">{def.label}</dt>
          <dd className="text-[13px]">
            <CfValue def={def} value={values[def.key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
