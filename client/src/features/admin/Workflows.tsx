import { trpc } from "@/lib/trpc";
import { ErrorState, Loading } from "@/components/ks/Layout";
import { StateChip } from "@/components/ks/Status";
import { ReferenceEditor, text, nullableText, flag } from "./Editor";
import { WorkflowStructure } from "./WorkflowStructure";
export default function Workflows() {
  const q = trpc.wf.designer.apps.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.wf.designer.upsertApp.useMutation();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <ReferenceEditor
      title="Log app"
      description="Configure RFI, submittal, CO, delay notice and other workflow logs. Open an app to edit its states, transitions and SLA timeout policies. New apps begin with Open → Closed."
      rows={q.data ?? []}
      columns={[
        {
          label: "Name",
          cell: r => <StateChip name={r.name} color={r.color} />,
        },
        { label: "Key", cell: r => <code>{r.key}</code> },
        { label: "Prefix", cell: r => <code>{r.numberPrefix}</code> },
        {
          label: "Scope",
          cell: r => (r.scope === "global" ? "Global / intake" : "Per job"),
        },
        { label: "Due-date label", cell: r => r.dueDateLabel },
        { label: "Active", cell: r => (r.isActive ? "Yes" : "No") },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "pluralName", label: "Plural name", required: true },
        {
          key: "key",
          label: "App key (immutable after creation)",
          required: true,
          help: "Lowercase letters, digits and underscores. Use at least two characters.",
        },
        {
          key: "numberPrefix",
          label: "Number prefix",
          required: true,
          help: "Uppercase letters/digits, max 10. Example: RFI.",
        },
        { key: "color", label: "Color", type: "color" },
        {
          key: "scope",
          label: "Scope",
          type: "select",
          options: { project: "Per job", global: "Global / intake" },
        },
        { key: "dueDateLabel", label: "Due-date label", required: true },
        { key: "icon", label: "Icon key" },
        { key: "description", label: "Description", type: "textarea" },
        {
          key: "scoreFormula",
          label: "Score formula (optional)",
          type: "textarea",
        },
        { key: "isActive", label: "Active", type: "check" },
      ]}
      defaults={{
        name: "",
        pluralName: "",
        key: "",
        numberPrefix: "LOG",
        color: "#3B6A9A",
        scope: "project",
        dueDateLabel: "Due Date",
        icon: "file-text",
        description: "",
        scoreFormula: "",
        isActive: true,
      }}
      onSave={async (d, id) => {
        const old = q.data?.find(a => a.id === id);
        if (old && old.key !== text(d, "key"))
          throw new Error("App keys cannot change after creation");
        await save.mutateAsync({
          id,
          key: text(d, "key"),
          name: text(d, "name"),
          pluralName: text(d, "pluralName"),
          numberPrefix: text(d, "numberPrefix"),
          color: text(d, "color"),
          icon: text(d, "icon"),
          scope: text(d, "scope") as "project" | "global",
          dueDateLabel: text(d, "dueDateLabel"),
          description: nullableText(d, "description"),
          scoreFormula: nullableText(d, "scoreFormula"),
          isActive: flag(d, "isActive"),
          config: old?.config,
        });
        await Promise.all([
          utils.wf.designer.apps.invalidate(),
          utils.wf.app.invalidate(),
          utils.ref.all.invalidate(),
        ]);
      }}
      extra={id => {
        const app = q.data?.find(a => a.id === id);
        return app ? (
          <WorkflowStructure key={app.key} appKey={app.key} />
        ) : null;
      }}
    />
  );
}
