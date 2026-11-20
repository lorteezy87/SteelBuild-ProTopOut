import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RecordDrawer,
  NumberInput,
  SimpleSelect,
} from "@/components/ks/Controls";
import { EmptyState, Field, Panel } from "@/components/ks/Layout";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Copy } from "lucide-react";

export type DraftValue = string | number | boolean | null | number[];
export type Draft = Record<string, DraftValue>;
export type EditorField = {
  key: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "number"
    | "textarea"
    | "select"
    | "check"
    | "days"
    | "color";
  options?: Record<string, string> | { value: string; label: string }[];
  nullable?: boolean;
  min?: number;
  step?: number;
  required?: boolean;
  help?: string;
};
export const text = (d: Draft, k: string) => String(d[k] ?? "");
export const nullableText = (d: Draft, k: string) => text(d, k).trim() || null;
export const number = (d: Draft, k: string) => Number(d[k] ?? 0);
export const nullableNumber = (d: Draft, k: string) =>
  d[k] == null || d[k] === "" ? null : Number(d[k]);
export const flag = (d: Draft, k: string) => !!d[k];
export function toDraft(row: object): Draft {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([, v]) =>
        v == null ||
        ["string", "number", "boolean"].includes(typeof v) ||
        (Array.isArray(v) && v.every(n => typeof n === "number"))
    )
  );
}
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={v => onChange(v === true)} />
      {label}
    </label>
  );
}
export function DraftFields({
  fields,
  draft,
  onChange,
}: {
  fields: EditorField[];
  draft: Draft;
  onChange: (d: Draft) => void;
}) {
  const put = (key: string, value: DraftValue) =>
    onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(f => (
        <Field
          key={f.key}
          label={f.label}
          className={
            f.type === "textarea" || f.type === "days" ? "sm:col-span-2" : ""
          }
        >
          {f.type === "check" ? (
            <Check
              label={f.label}
              checked={flag(draft, f.key)}
              onChange={v => put(f.key, v)}
            />
          ) : f.type === "select" ? (
            <SimpleSelect
              value={draft[f.key] == null ? null : text(draft, f.key)}
              options={f.options ?? {}}
              allowNone={f.nullable}
              onChange={v => put(f.key, v)}
            />
          ) : f.type === "number" ? (
            <NumberInput
              value={nullableNumber(draft, f.key)}
              min={f.min ?? 0}
              step={f.step ?? 0.01}
              onChange={v => put(f.key, v)}
            />
          ) : f.type === "textarea" ? (
            <Textarea
              rows={3}
              value={text(draft, f.key)}
              onChange={e => put(f.key, e.target.value)}
            />
          ) : f.type === "days" ? (
            <div className="flex flex-wrap gap-4">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                (day, i) => {
                  const days = Array.isArray(draft[f.key])
                    ? (draft[f.key] as number[])
                    : [];
                  return (
                    <Check
                      key={day}
                      label={day}
                      checked={days.includes(i + 1)}
                      onChange={v =>
                        put(
                          f.key,
                          v
                            ? [...days, i + 1].sort()
                            : days.filter(d => d !== i + 1)
                        )
                      }
                    />
                  );
                }
              )}
            </div>
          ) : (
            <Input
              type={
                f.type === "color"
                  ? "color"
                  : f.type === "email"
                    ? "email"
                    : "text"
              }
              required={f.required}
              value={text(draft, f.key)}
              onChange={e => put(f.key, e.target.value)}
            />
          )}
          {f.help && (
            <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>
          )}
        </Field>
      ))}
    </div>
  );
}
export function SaveBar({
  pending,
  onSave,
  onCancel,
  disabled,
}: {
  pending?: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button disabled={pending || disabled} onClick={onSave}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}
export function CopySecret({
  value,
  label = "Save this secret now. It is shown only once.",
  onDismiss,
}: {
  value: string;
  label?: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="space-y-3 border border-[var(--ks-amber)] bg-[var(--ks-amber-soft)] p-4"
      role="status"
    >
      <p className="font-semibold">{label}</p>
      <code className="block break-all select-all rounded border bg-[var(--ks-paper)] p-3 font-mono text-xs">
        {value}
      </code>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.success("Copied");
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          I saved it
        </Button>
      </div>
    </div>
  );
}
export function ReferenceEditor<T extends { id: number; name: string }>({
  title,
  description,
  rows,
  columns,
  fields,
  defaults,
  onSave,
  extra,
}: {
  title: string;
  description: string;
  rows: T[];
  columns: { label: string; cell: (r: T) => ReactNode }[];
  fields: EditorField[];
  defaults: Draft;
  onSave: (d: Draft, id?: number) => Promise<unknown>;
  extra?: (id: number) => ReactNode;
}) {
  const [selected, setSelected] = useState<T | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(defaults);
  const [pending, setPending] = useState(false);
  const utils = trpc.useUtils();
  const open = (r: T | null) => {
    setSelected(r);
    setDraft(r ? { ...defaults, ...toDraft(r) } : { ...defaults });
  };
  const save = async () => {
    const missing = fields.find(f => f.required && !text(draft, f.key).trim());
    if (missing) {
      toast.error(`Enter ${missing.label.toLowerCase()}`);
      return;
    }
    setPending(true);
    try {
      await onSave(draft, selected?.id);
      await utils.ref.all.invalidate();
      toast.success("Saved");
      setSelected(undefined);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-muted-foreground">{description}</p>
        <Button size="sm" onClick={() => open(null)}>
          <Plus className="size-3.5" />
          New {title.toLowerCase()}
        </Button>
      </div>
      <Panel title={`${rows.length} records`}>
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                {columns.map(c => (
                  <th key={c.label}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => open(r)}
                >
                  {columns.map((c, i) => (
                    <td key={c.label}>
                      {i === 0 ? (
                        <button
                          className="text-left font-medium hover:text-[var(--ks-accent-ink)]"
                          onClick={e => {
                            e.stopPropagation();
                            open(r);
                          }}
                        >
                          {c.cell(r)}
                        </button>
                      ) : (
                        c.cell(r)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title={`No ${title.toLowerCase()} records`}
            body="Create a record to make it available in job pickers."
          />
        )}
      </Panel>
      <RecordDrawer
        open={selected !== undefined}
        onOpenChange={v => {
          if (!v) setSelected(undefined);
        }}
        eyebrow="Administration"
        title={selected ? selected.name : `New ${title.toLowerCase()}`}
        footer={
          <SaveBar
            pending={pending}
            onSave={() => void save()}
            onCancel={() => setSelected(undefined)}
          />
        }
      >
        <DraftFields fields={fields} draft={draft} onChange={setDraft} />
        {selected && extra && (
          <div className="mt-6 border-t border-[var(--ks-rule)] pt-4">
            {extra(selected.id)}
          </div>
        )}
      </RecordDrawer>
    </div>
  );
}
