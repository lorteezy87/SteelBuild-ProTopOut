import { toast } from "sonner";
import { ConfirmButton } from "@/components/brand/Controls";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
import { PRIORITIES } from "@shared/domain";
import {
  ReferenceEditor,
  text,
  number,
  nullableNumber,
  nullableText,
} from "./Editor";
import { useWorkflowChanged, type AppStructure } from "./WorkflowStructure";
export default function WorkflowPolicies({ data }: { data: AppStructure }) {
  const changed = useWorkflowChanged(data.app.key);
  const save = trpc.wf.designer.upsertPolicy.useMutation();
  const remove = trpc.wf.designer.removePolicy.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  const stateName = (id: number | null) =>
    data.states.find(s => s.id === id)?.name ?? "—";
  const rows = data.policies.map(p => ({
    ...p,
    name: `${stateName(p.stateId)} · ${p.priority ? PRIORITIES[p.priority as keyof typeof PRIORITIES] : "Any priority"}`,
    days: p.hours / 24,
  }));
  const opts = data.states.map(s => ({ value: String(s.id), label: s.name }));
  return (
    <ReferenceEditor
      title="Timeout policy"
      description="Fixed days are elapsed calendar days in a state (24 hours/day), not work days. Notice hours run from creation; due-date policies end at the due date in the org timezone. At Risk starts at the selected percentage; timeout marks Delayed or moves the item. Sweeper runs every five minutes."
      rows={rows}
      columns={[
        { label: "State / priority", cell: r => r.name },
        {
          label: "Timeout",
          cell: r =>
            r.source === "fixed"
              ? `${r.days} days`
              : r.source === "project_notice"
                ? "Job notice hours"
                : "Item due date",
        },
        {
          label: "Action",
          cell: r =>
            r.action === "transition"
              ? `Move → ${stateName(r.toStateId)}`
              : "Mark Delayed",
        },
        { label: "At Risk", cell: r => `${r.atRiskPct}%` },
      ]}
      fields={[
        { key: "stateId", label: "In state", type: "select", options: opts },
        {
          key: "priority",
          label: "Priority",
          type: "select",
          nullable: true,
          options: PRIORITIES,
        },
        {
          key: "source",
          label: "Timeout source",
          type: "select",
          options: {
            fixed: "Fixed days in state",
            project_notice: "Job notice hours",
            due_date: "Item due date",
          },
        },
        {
          key: "days",
          label: "After N elapsed days (fixed source)",
          type: "number",
          min: 0.25 / 24,
          help: "Ignored by notice-hour and due-date policies.",
        },
        {
          key: "action",
          label: "On timeout",
          type: "select",
          options: {
            mark_delayed: "Mark Delayed",
            transition: "Auto-transition",
          },
        },
        {
          key: "toStateId",
          label: "Auto-transition destination",
          type: "select",
          nullable: true,
          options: opts,
        },
        {
          key: "atRiskPct",
          label: "At Risk at % of timeout (1–99)",
          type: "number",
          min: 1,
          step: 1,
        },
      ]}
      defaults={{
        stateId: data.states.find(s => s.category !== "end")?.id ?? null,
        priority: null,
        source: "fixed",
        days: 1,
        action: "mark_delayed",
        toStateId: null,
        atRiskPct: 75,
      }}
      onSave={async (d, id) => {
        const stateId = number(d, "stateId");
        const priority = nullableText(d, "priority");
        if (
          data.policies.some(
            p => p.id !== id && p.stateId === stateId && p.priority === priority
          )
        )
          throw new Error(
            "A policy already exists for that state and priority"
          );
        const action = text(d, "action") as "mark_delayed" | "transition";
        const toStateId =
          action === "transition" ? nullableNumber(d, "toStateId") : null;
        if (action === "transition" && toStateId === stateId)
          throw new Error("Choose a different timeout destination");
        await save.mutateAsync({
          id,
          appId: data.app.id,
          stateId,
          priority,
          source: text(d, "source") as "fixed" | "project_notice" | "due_date",
          hours: number(d, "days") * 24,
          action,
          toStateId,
          atRiskPct: number(d, "atRiskPct"),
        });
        await changed();
      }}
      extra={id => (
        <ConfirmButton
          title="Remove timeout policy?"
          body="SLA dates are recalculated for existing items."
          destructive
          disabled={remove.isPending}
          onConfirm={() => remove.mutate({ id })}
        >
          Remove policy
        </ConfirmButton>
      )}
    />
  );
}
