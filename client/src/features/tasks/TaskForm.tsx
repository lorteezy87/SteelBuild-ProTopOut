import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput, NumberInput, SimpleSelect } from "@/components/brand/Controls";
import { CfDisplay, CfForm } from "@/components/brand/CustomFields";
import { Field, Panel } from "@/components/brand/Layout";
import { errMsg } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import {
  CONSTRAINT_TYPES,
  PRIORITIES,
  TASK_KINDS,
  TASK_STATUSES,
} from "@shared/domain";

type Detail = RouterOutputs["tasks"]["get"];
type Draft = Omit<
  Pick<
    Detail["task"],
    | "name"
    | "description"
    | "kind"
    | "status"
    | "priority"
    | "percentComplete"
    | "schedulingMode"
    | "durationDays"
    | "effortHours"
    | "startDate"
    | "finishDate"
    | "constraintType"
    | "constraintDate"
    | "location"
    | "plannedTons"
    | "plannedPieces"
    | "erectedTons"
    | "erectedPieces"
    | "actualStart"
    | "actualFinish"
    | "budgetCost"
  >,
  "schedulingMode"
> & { schedulingMode: "auto" | "manual" };
const KEYS: (keyof Draft)[] = [
  "name",
  "description",
  "kind",
  "status",
  "priority",
  "percentComplete",
  "schedulingMode",
  "durationDays",
  "effortHours",
  "startDate",
  "finishDate",
  "constraintType",
  "constraintDate",
  "location",
  "plannedTons",
  "plannedPieces",
  "erectedTons",
  "erectedPieces",
  "actualStart",
  "actualFinish",
  "budgetCost",
];
const PROGRESS_KEYS: (keyof Draft)[] = [
  "status",
  "percentComplete",
  "erectedTons",
  "erectedPieces",
  "actualStart",
  "actualFinish",
];
function makeDraft(t: Detail["task"]): Draft {
  return Object.fromEntries(KEYS.map(key => [key, t[key]])) as Draft;
}
export function TaskForm({
  data,
  changed,
  progressMethod,
}: {
  data: Detail;
  changed: () => Promise<void>;
  progressMethod?: string;
}) {
  const [draft, setDraft] = useState<Draft>(() => makeDraft(data.task));
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    data.customFields
  );
  useEffect(() => {
    setDraft(makeDraft(data.task));
    setCustomFields(data.customFields);
  }, [data.task, data.customFields]);
  const canEdit = data.privileges.includes("task.edit");
  const canProgress = canEdit || data.privileges.includes("task.progress");
  const canFinancials = data.privileges.includes("project.financials");
  const summary = data.isSummary;
  const quantityDriven =
    draft.kind === "sequence" &&
    (progressMethod === "tonnage" || progressMethod === "pieces");
  const update = trpc.tasks.update.useMutation({
    onSuccess: async () => {
      toast.success("Task updated.");
      await changed();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(d => ({ ...d, [key]: value }));
  function save() {
    if (!draft.name.trim()) return toast.error("Enter a task name.");
    const keys = canEdit ? KEYS : PROGRESS_KEYS;
    const edits = Object.fromEntries(
      keys
        .filter(key => key !== "budgetCost" || canFinancials)
        .filter(key => draft[key] !== data.task[key])
        .map(key => [key, draft[key]])
    ) as Partial<Draft>;
    // Auto dates are governed by constraints; a changed start creates a SNET constraint.
    if (
      draft.schedulingMode === "auto" &&
      edits.startDate &&
      draft.constraintType === "asap"
    ) {
      edits.constraintType = "snet";
      edits.constraintDate = edits.startDate;
    }
    const { budgetCost, ...ordinary } = edits;
    update.mutate({
      id: data.task.id,
      ...ordinary,
      ...(budgetCost != null ? { budgetCost } : {}),
      ...(canEdit ? { customFields } : {}),
    });
  }
  return (
    <Panel
      title={
        summary ? "Summary task · dates and progress roll up" : "Task details"
      }
      bodyClassName="p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input
            value={draft.name}
            onChange={e => set("name", e.target.value)}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Kind">
          <SimpleSelect
            value={draft.kind}
            onChange={v => v && set("kind", v)}
            options={TASK_KINDS}
            disabled={!canEdit || summary}
          />
        </Field>
        <Field label="WBS">
          <div className="num flex h-9 items-center">
            {data.task.wbs ?? "—"}
            <span className="ml-2 text-[11px] text-muted-foreground">
              Computed from the task tree
            </span>
          </div>
        </Field>
        <Field label="Status">
          <SimpleSelect
            value={draft.status}
            onChange={v => v && set("status", v)}
            options={TASK_STATUSES}
            disabled={!canProgress || summary}
          />
        </Field>
        <Field label="Priority">
          <SimpleSelect
            value={draft.priority}
            onChange={v => v && set("priority", v)}
            options={PRIORITIES}
            disabled={!canEdit}
          />
        </Field>
        <Field
          label={
            quantityDriven ? "Complete (%) — quantity-derived" : "Complete (%)"
          }
        >
          <NumberInput
            value={draft.percentComplete}
            onChange={v => set("percentComplete", v ?? 0)}
            min={0}
            step="0.1"
            disabled={!canProgress || summary || quantityDriven}
          />
        </Field>
        <Field label="Scheduling mode">
          <SimpleSelect
            value={draft.schedulingMode}
            onChange={v => v && set("schedulingMode", v)}
            options={{
              auto: "Auto — dependencies & calendar",
              manual: "Manual — explicit dates",
            }}
            disabled={!canEdit || summary}
          />
        </Field>
        <Field label="Duration (work days)">
          <NumberInput
            value={draft.durationDays}
            onChange={v => set("durationDays", v ?? 0)}
            min={0}
            step="0.5"
            disabled={!canEdit || summary || draft.kind === "milestone"}
          />
        </Field>
        <Field label="Effort (crew hours)">
          <NumberInput
            value={draft.effortHours}
            onChange={v => set("effortHours", v ?? 0)}
            min={0}
            step="0.5"
            disabled={!canEdit || summary}
          />
        </Field>
        <Field label="Start">
          <DateInput
            value={draft.startDate}
            onChange={v =>
              setDraft(d => ({
                ...d,
                startDate: v,
                ...(d.schedulingMode === "auto"
                  ? {
                      constraintType: v ? "snet" : "asap",
                      constraintDate: v,
                    }
                  : {}),
              }))
            }
            disabled={!canEdit || summary}
          />
        </Field>
        <Field
          label={
            draft.schedulingMode === "auto" ? "Finish (calculated)" : "Finish"
          }
        >
          <DateInput
            value={draft.finishDate}
            onChange={v => set("finishDate", v)}
            disabled={!canEdit || summary || draft.schedulingMode === "auto"}
          />
        </Field>
        <Field label="Constraint">
          <SimpleSelect
            value={draft.constraintType}
            onChange={v =>
              v &&
              setDraft(d => ({
                ...d,
                constraintType: v,
                constraintDate:
                  v === "asap" ? null : (d.constraintDate ?? d.startDate),
              }))
            }
            options={CONSTRAINT_TYPES}
            disabled={!canEdit || summary}
          />
        </Field>
        <Field label="Constraint date">
          <DateInput
            value={draft.constraintDate}
            onChange={v => set("constraintDate", v)}
            disabled={!canEdit || summary || draft.constraintType === "asap"}
          />
        </Field>
        <Field label="Actual start">
          <DateInput
            value={draft.actualStart}
            onChange={v => set("actualStart", v)}
            disabled={!canProgress || summary}
          />
        </Field>
        <Field label="Actual finish">
          <DateInput
            value={draft.actualFinish}
            onChange={v => set("actualFinish", v)}
            disabled={!canProgress || summary}
          />
        </Field>
        {canFinancials && (
          <Field label="Task cost budget ($)">
            <NumberInput
              min={0}
              value={draft.budgetCost}
              onChange={v => set("budgetCost", v ?? 0)}
              disabled={!canEdit || summary}
            />
          </Field>
        )}
        {draft.kind === "sequence" && (
          <section className="grid gap-3 border-y border-[var(--tp-rule)] py-3 sm:col-span-2 sm:grid-cols-2">
            <h3 className="label-caps sm:col-span-2">
              Erection sequence · field progress
            </h3>
            <Field label="Location / grid / level" className="sm:col-span-2">
              <Input
                value={draft.location ?? ""}
                onChange={e => set("location", e.target.value || null)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Planned tons">
              <NumberInput
                value={draft.plannedTons}
                onChange={v => set("plannedTons", v ?? 0)}
                step="0.1"
                min={0}
                disabled={!canEdit || summary}
              />
            </Field>
            <Field label="Planned pieces">
              <NumberInput
                value={draft.plannedPieces}
                onChange={v => set("plannedPieces", v ?? 0)}
                step={1}
                min={0}
                disabled={!canEdit || summary}
              />
            </Field>
            <Field label="Erected tons">
              <NumberInput
                value={draft.erectedTons}
                onChange={v => set("erectedTons", v ?? 0)}
                step="0.1"
                min={0}
                disabled={!canProgress || summary}
              />
            </Field>
            <Field label="Erected pieces">
              <NumberInput
                value={draft.erectedPieces}
                onChange={v => set("erectedPieces", v ?? 0)}
                step={1}
                min={0}
                disabled={!canProgress || summary}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Final daily reports post erected quantities. Tonnage / Pieces
              progress methods calculate % complete from these quantities.
            </p>
          </section>
        )}
        <Field label="Notes / scope" className="sm:col-span-2">
          <Textarea
            rows={4}
            value={draft.description ?? ""}
            onChange={e => set("description", e.target.value || null)}
            disabled={!canEdit}
          />
        </Field>
      </div>
      {!!data.customFieldDefs.length && (
        <section className="mt-4 border-t border-[var(--tp-rule)] pt-3">
          <h3 className="label-caps mb-3">Custom fields</h3>
          {canEdit ? (
            <CfForm
              defs={data.customFieldDefs}
              values={customFields}
              onChange={setCustomFields}
            />
          ) : (
            <CfDisplay defs={data.customFieldDefs} values={customFields} />
          )}
        </section>
      )}
      {(canEdit || canProgress) && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" disabled={update.isPending} onClick={save}>
            {update.isPending ? "Saving…" : "Save task"}
          </Button>
        </div>
      )}
    </Panel>
  );
}
