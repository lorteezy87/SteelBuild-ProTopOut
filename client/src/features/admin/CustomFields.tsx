import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  RecordDrawer,
  SimpleSelect,
  NumberInput,
  ConfirmButton,
} from "@/components/ks/Controls";
import {
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ks/Layout";
import { Pill } from "@/components/ks/Status";
import { FIELD_TYPES } from "@shared/domain";
import { trpc } from "@/lib/trpc";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { errMsg } from "@/lib/format";
import { Check, SaveBar } from "./Editor";
type Def = RouterOutputs["customFields"]["allDefs"][number];
type Form = Omit<Def, "id"> & { id?: number };
type Rollup = "none" | "sum" | "avg" | "min" | "max";
const blank = (entityType: string): Form => ({
  entityType,
  key: "",
  label: "",
  fieldType: "text",
  options: [],
  formula: "",
  required: false,
  isFinancial: false,
  rollup: "none",
  colorRules: [],
  projectType: null,
  helpText: "",
  showInList: false,
  sortOrder: 0,
  isActive: true,
});
const inputFor = (d: Form) => ({ ...d, rollup: d.rollup as Rollup });
export default function CustomFields() {
  const q = trpc.customFields.allDefs.useQuery();
  const { ref } = useRefData();
  const utils = trpc.useUtils();
  const [entity, setEntity] = useState("project");
  const [form, setForm] = useState<Form | null>(null);
  const [sample, setSample] = useState('{"hours":8,"rate":65}');
  const [preview, setPreview] = useState<{
    ok: boolean;
    error?: string;
    value?: unknown;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const { mutateAsync: testFormula } =
    trpc.customFields.testFormula.useMutation();
  const success = async () => {
    await Promise.all([
      utils.customFields.allDefs.invalidate(),
      utils.customFields.defs.invalidate(),
      utils.wf.invalidate(),
      utils.ref.all.invalidate(),
    ]);
  };
  const save = trpc.customFields.upsert.useMutation({
    onError: e => toast.error(errMsg(e)),
  });
  const formula = form?.fieldType === "formula" ? form.formula : null;
  useEffect(() => {
    let current = true;
    setPreview(null);
    if (!formula?.trim()) {
      setTesting(false);
      return;
    }
    setTesting(true);
    const timer = window.setTimeout(async () => {
      try {
        const parsed: unknown = JSON.parse(sample);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
          throw new Error("Sample must be a JSON object");
        const result = await testFormula({
          formula,
          sample: parsed as Record<string, unknown>,
        });
        if (current) setPreview(result);
      } catch (e) {
        if (current) setPreview({ ok: false, error: errMsg(e) });
      } finally {
        if (current) setTesting(false);
      }
    }, 450);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [formula, sample, testFormula]);
  const put = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm(f => (f ? { ...f, [key]: value } : f));
  const rows = (q.data ?? [])
    .filter(f => f.entityType === entity)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const reorder = async (index: number, delta: number) => {
    const ordered = [...rows];
    [ordered[index], ordered[index + delta]] = [
      ordered[index + delta],
      ordered[index],
    ];
    setReordering(true);
    try {
      for (let i = 0; i < ordered.length; i++)
        await save.mutateAsync(inputFor({ ...ordered[i], sortOrder: i }));
      await success();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setReordering(false);
    }
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Record type">
          <SimpleSelect
            className="min-w-64"
            value={entity}
            onChange={v => setEntity(v ?? "project")}
            options={[
              { value: "project", label: "Job" },
              { value: "task", label: "Task / erection sequence" },
              { value: "user", label: "Person" },
              { value: "company", label: "Company" },
              ...(ref?.apps ?? []).map(a => ({
                value: `app:${a.key}`,
                label: a.pluralName,
              })),
            ]}
          />
        </Field>
        <Button
          size="sm"
          onClick={() => setForm({ ...blank(entity), sortOrder: rows.length })}
        >
          New field
        </Button>
      </div>
      <p className="text-muted-foreground">
        Keys are permanent. Formulas are safely parsed and computed on write;
        use me.field for base and custom values. Deactivation preserves recorded
        values.
      </p>
      <Panel title={`${rows.length} field definitions`}>
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Label / key</th>
                <th>Type</th>
                <th>Required</th>
                <th>Financial</th>
                <th>In lists</th>
                <th>Job type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => (
                <tr
                  key={f.id}
                  className="cursor-pointer"
                  onClick={() => setForm({ ...f })}
                >
                  <td>
                    <div
                      className="flex gap-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${f.label} up`}
                        disabled={i === 0 || reordering}
                        onClick={() => void reorder(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${f.label} down`}
                        disabled={i === rows.length - 1 || reordering}
                        onClick={() => void reorder(i, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </td>
                  <td>
                    <button className="font-medium text-left">{f.label}</button>
                    <code className="block text-[10px] text-muted-foreground">
                      {f.key}
                    </code>
                  </td>
                  <td>
                    {FIELD_TYPES[f.fieldType as keyof typeof FIELD_TYPES] ??
                      f.fieldType}
                  </td>
                  <td>{f.required ? "Yes" : "—"}</td>
                  <td>{f.isFinancial ? "Yes" : "—"}</td>
                  <td>{f.showInList ? "Yes" : "—"}</td>
                  <td>{f.projectType ?? "All"}</td>
                  <td>
                    <Pill tone={f.isActive ? "green" : "gray"}>
                      {f.isActive ? "Active" : "Inactive"}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="No custom fields"
            body="Add a field to capture erection-specific information on this record type."
          />
        )}
      </Panel>
      <RecordDrawer
        open={!!form}
        onOpenChange={v => {
          if (!v) setForm(null);
        }}
        eyebrow={`Custom fields · ${entity}`}
        title={form?.id ? form.label : "New custom field"}
        width={720}
        actions={
          form?.id &&
          form.isActive && (
            <ConfirmButton
              title="Deactivate this field?"
              body="Existing values remain. The field no longer appears on forms."
              onConfirm={() =>
                form &&
                save.mutate(inputFor({ ...form, isActive: false }), {
                  onSuccess: () => {
                    void success();
                    setForm(null);
                  },
                })
              }
            >
              Deactivate
            </ConfirmButton>
          )
        }
        footer={
          <SaveBar
            pending={save.isPending || reordering}
            disabled={
              !form?.label.trim() ||
              !form?.key.trim() ||
              (form.fieldType === "formula" && (!preview?.ok || testing))
            }
            onCancel={() => setForm(null)}
            onSave={() =>
              form &&
              save.mutate(inputFor(form), {
                onSuccess: () => {
                  void success();
                  setForm(null);
                  toast.success("Field saved");
                },
              })
            }
          />
        }
      >
        {form && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label">
                <Input
                  value={form.label}
                  onChange={e => put("label", e.target.value)}
                />
              </Field>
              <Field label="Permanent key">
                <Input
                  className="font-mono"
                  disabled={!!form.id}
                  value={form.key}
                  placeholder="crew_hours"
                  onChange={e => put("key", e.target.value)}
                />
              </Field>
              <Field label="Field type">
                <SimpleSelect
                  value={form.fieldType}
                  options={FIELD_TYPES}
                  onChange={v => {
                    put("fieldType", v ?? "text");
                    if (
                      !["number", "decimal", "currency", "formula"].includes(
                        v ?? ""
                      )
                    )
                      put("rollup", "none");
                  }}
                />
              </Field>
              <Field label="Job type scope">
                <SimpleSelect
                  value={form.projectType}
                  allowNone
                  noneLabel="All job types"
                  options={(ref?.projectTypes ?? []).map(p => ({
                    value: p,
                    label: p,
                  }))}
                  onChange={v => put("projectType", v)}
                />
              </Field>
              {entity === "task" && (
                <Field label="WBS rollup">
                  <SimpleSelect
                    disabled={
                      !["number", "decimal", "currency", "formula"].includes(
                        form.fieldType
                      )
                    }
                    value={form.rollup}
                    options={{
                      none: "No rollup",
                      sum: "Sum",
                      avg: "Average",
                      min: "Minimum",
                      max: "Maximum",
                    }}
                    onChange={v => put("rollup", v ?? "none")}
                  />
                </Field>
              )}
              <Field label="Sort order">
                <NumberInput
                  value={form.sortOrder}
                  min={0}
                  step={1}
                  onChange={v => put("sortOrder", v ?? 0)}
                />
              </Field>
            </div>
            {["select", "multiselect"].includes(form.fieldType) && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="label-caps">
                    Select options · value / label / color
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      put("options", [
                        ...(form.options ?? []),
                        { value: "", label: "", color: "#6b7684" },
                      ])
                    }
                  >
                    Add option
                  </Button>
                </div>
                {(form.options ?? []).map((o, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label="Option value"
                      value={o.value}
                      onChange={e =>
                        put(
                          "options",
                          form.options!.map((x, j) =>
                            i === j ? { ...x, value: e.target.value } : x
                          )
                        )
                      }
                    />
                    <Input
                      aria-label="Option label"
                      value={o.label}
                      onChange={e =>
                        put(
                          "options",
                          form.options!.map((x, j) =>
                            i === j ? { ...x, label: e.target.value } : x
                          )
                        )
                      }
                    />
                    <Input
                      className="w-14 shrink-0"
                      aria-label="Option color"
                      type="color"
                      value={o.color || "#6b7684"}
                      onChange={e =>
                        put(
                          "options",
                          form.options!.map((x, j) =>
                            i === j ? { ...x, color: e.target.value } : x
                          )
                        )
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        put(
                          "options",
                          form.options!.filter((_, j) => i !== j)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {form.fieldType === "formula" && (
              <div className="space-y-3">
                <Field label="Formula">
                  <Textarea
                    className="font-mono"
                    value={form.formula ?? ""}
                    onChange={e => put("formula", e.target.value)}
                    placeholder="roundTo(me.hours * me.rate, 2)"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Arithmetic, comparisons, and/or/not, ternary, round, roundTo,
                  ceil, floor, abs, min, max, if, daysBetween, today,
                  formatCurrency, contains, isEmpty.
                </p>
                <Field label="Sample me values (JSON)">
                  <Textarea
                    className="font-mono text-xs"
                    value={sample}
                    onChange={e => setSample(e.target.value)}
                  />
                </Field>
                <div
                  role="status"
                  className={`border p-3 ${preview && !preview.ok ? "bg-[var(--ks-red-soft)]" : "bg-[var(--ks-bone)]"}`}
                >
                  {testing
                    ? "Validating…"
                    : preview
                      ? preview.ok
                        ? `Valid · result: ${JSON.stringify(preview.value) ?? "null"}`
                        : preview.error
                      : "Enter a formula for live validation."}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="label-caps">
                  Color rules · first matching rule wins
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    put("colorRules", [
                      ...(form.colorRules ?? []),
                      { op: "gte", value: 0, color: "#16A34A" },
                    ])
                  }
                >
                  Add rule
                </Button>
              </div>
              {(form.colorRules ?? []).map((r, i) => (
                <div key={i} className="flex gap-2">
                  <SimpleSelect
                    value={r.op}
                    options={{ lt: "<", lte: "≤", gt: ">", gte: "≥", eq: "=" }}
                    onChange={v =>
                      put(
                        "colorRules",
                        form.colorRules!.map((x, j) =>
                          i === j ? { ...x, op: (v ?? "eq") as typeof r.op } : x
                        )
                      )
                    }
                  />
                  <Input
                    aria-label="Rule value"
                    value={String(r.value)}
                    onChange={e =>
                      put(
                        "colorRules",
                        form.colorRules!.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                value:
                                  e.target.value.trim() !== "" &&
                                  Number.isFinite(Number(e.target.value))
                                    ? Number(e.target.value)
                                    : e.target.value,
                              }
                            : x
                        )
                      )
                    }
                  />
                  <Input
                    className="w-14 shrink-0"
                    type="color"
                    aria-label="Rule color"
                    value={r.color}
                    onChange={e =>
                      put(
                        "colorRules",
                        form.colorRules!.map((x, j) =>
                          i === j ? { ...x, color: e.target.value } : x
                        )
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      put(
                        "colorRules",
                        form.colorRules!.filter((_, j) => i !== j)
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Field label="Help text">
              <Textarea
                value={form.helpText ?? ""}
                onChange={e => put("helpText", e.target.value)}
              />
            </Field>
            <div className="grid sm:grid-cols-2">
              <Check
                label="Required"
                checked={form.required}
                onChange={v => put("required", v)}
              />
              <Check
                label="Financial (restricted)"
                checked={form.isFinancial}
                onChange={v => put("isFinancial", v)}
              />
              <Check
                label="Show in list"
                checked={form.showInList}
                onChange={v => put("showInList", v)}
              />
              <Check
                label="Active"
                checked={form.isActive}
                onChange={v => put("isActive", v)}
              />
            </div>
          </div>
        )}
      </RecordDrawer>
    </div>
  );
}
