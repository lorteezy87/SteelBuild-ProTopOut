import { toast } from "sonner";
import { ConfirmButton } from "@/components/brand/Controls";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { StateChip } from "@/components/brand/Status";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { ReferenceEditor, text, number, flag } from "./Editor";
import WorkflowPolicies from "./WorkflowPolicies";
export type AppStructure = RouterOutputs["wf"]["app"];
export function WorkflowStructure({ appKey }: { appKey: string }) {
  const q = trpc.wf.app.useQuery({ key: appKey });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;
  return (
    <div className="space-y-8">
      <States data={q.data} />
      <Transitions data={q.data} />
      <WorkflowPolicies data={q.data} />
    </div>
  );
}
export function useWorkflowChanged(key: string) {
  const utils = trpc.useUtils();
  return async () => {
    await Promise.all([
      utils.wf.app.invalidate({ key }),
      utils.wf.designer.apps.invalidate(),
      utils.wf.list.invalidate(),
      utils.ref.all.invalidate(),
    ]);
  };
}
function States({ data }: { data: AppStructure }) {
  const changed = useWorkflowChanged(data.app.key);
  const save = trpc.wf.designer.upsertState.useMutation();
  const remove = trpc.wf.designer.removeState.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  const indispensable = (id: number) => {
    const s = data.states.find(s => s.id === id);
    return (
      s &&
      ["start", "end"].includes(s.category) &&
      data.states.filter(x => x.category === s.category).length <= 1
    );
  };
  return (
    <ReferenceEditor
      title="State"
      description="One start state and at least one end state are required. State colors appear in logs. States containing items cannot be removed."
      rows={data.states}
      columns={[
        {
          label: "Name",
          cell: r => (
            <StateChip name={r.name} color={r.color} category={r.category} />
          ),
        },
        { label: "Category", cell: r => r.category },
        {
          label: "Order",
          cell: r => <span className="num">{r.sortOrder}</span>,
        },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        {
          key: "category",
          label: "Category",
          type: "select",
          options: { start: "Start", active: "Active", end: "End" },
        },
        { key: "color", label: "Color", type: "color" },
        { key: "sortOrder", label: "Order", type: "number", step: 1 },
      ]}
      defaults={{
        name: "",
        category: "active",
        color: "#6b7684",
        sortOrder: data.states.length,
      }}
      onSave={async (d, id) => {
        const category = text(d, "category") as "start" | "active" | "end";
        const after = [...data.states.filter(s => s.id !== id), { category }];
        if (
          after.filter(s => s.category === "start").length !== 1 ||
          !after.some(s => s.category === "end")
        )
          throw new Error(
            "Keep exactly one start state and at least one end state"
          );
        await save.mutateAsync({
          id,
          appId: data.app.id,
          name: text(d, "name"),
          category,
          color: text(d, "color"),
          sortOrder: number(d, "sortOrder"),
        });
        await changed();
      }}
      extra={id => (
        <div className="space-y-2">
          <ConfirmButton
            title="Remove workflow state?"
            body="Related transitions and state policies will also be removed. Move all log items out of this state first."
            destructive
            disabled={
              !!indispensable(id) ||
              remove.isPending ||
              data.policies.some(p => p.toStateId === id)
            }
            onConfirm={() => remove.mutate({ id })}
          >
            Remove state
          </ConfirmButton>
          {indispensable(id) && (
            <p className="text-xs text-muted-foreground">
              The only start or end state cannot be removed.
            </p>
          )}
          {data.policies.some(p => p.toStateId === id) && (
            <p className="text-xs text-muted-foreground">
              Change timeout policies targeting this state before removal.
            </p>
          )}
        </div>
      )}
    />
  );
}
function Transitions({ data }: { data: AppStructure }) {
  const changed = useWorkflowChanged(data.app.key);
  const save = trpc.wf.designer.upsertTransition.useMutation();
  const remove = trpc.wf.designer.removeTransition.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  const opts = data.states.map(s => ({ value: String(s.id), label: s.name }));
  const stateName = (id: number) =>
    data.states.find(s => s.id === id)?.name ?? `State ${id}`;
  return (
    <ReferenceEditor
      title="Transition"
      description="User-allowed transitions appear as actions in a log item. Automatic timeout policies can also move items to their destination state."
      rows={data.transitions}
      columns={[
        { label: "Name", cell: r => r.name },
        {
          label: "From → to",
          cell: r => `${stateName(r.fromStateId)} → ${stateName(r.toStateId)}`,
        },
        {
          label: "User allowed",
          cell: r => (r.userAllowed ? "Yes" : "Auto only"),
        },
      ]}
      fields={[
        { key: "name", label: "Action name", required: true },
        {
          key: "fromStateId",
          label: "From state",
          type: "select",
          options: opts,
        },
        { key: "toStateId", label: "To state", type: "select", options: opts },
        { key: "userAllowed", label: "User allowed", type: "check" },
      ]}
      defaults={{
        name: "",
        fromStateId: data.states[0]?.id ?? null,
        toStateId: data.states[1]?.id ?? null,
        userAllowed: true,
      }}
      onSave={async (d, id) => {
        await save.mutateAsync({
          id,
          appId: data.app.id,
          name: text(d, "name"),
          fromStateId: number(d, "fromStateId"),
          toStateId: number(d, "toStateId"),
          userAllowed: flag(d, "userAllowed"),
        });
        await changed();
      }}
      extra={id => (
        <ConfirmButton
          title="Remove workflow transition?"
          destructive
          disabled={remove.isPending}
          onConfirm={() => remove.mutate({ id })}
        >
          Remove transition
        </ConfirmButton>
      )}
    />
  );
}
