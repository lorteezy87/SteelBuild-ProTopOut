import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ReferenceEditor, text, nullableText } from "./Editor";
export default function Workspaces() {
  const { ref } = useRefData();
  const save = trpc.admin.workspaces.upsert.useMutation();
  return (
    <ReferenceEditor
      title="Workspace"
      description="Workspaces group jobs and scope security-role assignments."
      rows={ref?.workspaces ?? []}
      columns={[
        { label: "Name", cell: r => r.name },
        { label: "Description", cell: r => r.description ?? "—" },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "description", label: "Description", type: "textarea" },
      ]}
      defaults={{ name: "", description: "" }}
      onSave={(d, id) =>
        save.mutateAsync({
          id,
          name: text(d, "name"),
          description: nullableText(d, "description"),
        })
      }
    />
  );
}
