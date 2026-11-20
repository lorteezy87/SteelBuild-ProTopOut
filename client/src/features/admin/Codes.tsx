import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ReferenceEditor, text, number, flag } from "./Editor";
export default function Codes() {
  const { ref } = useRefData();
  const time = trpc.admin.timeCodes.upsert.useMutation();
  const expense = trpc.admin.expenseCodes.upsert.useMutation();
  return (
    <div className="space-y-8">
      <ReferenceEditor
        title="Time code"
        description="Regular, overtime, standby and extra-work codes. Multiplier applies to labor cost."
        rows={ref?.timeCodes ?? []}
        columns={[
          { label: "Name", cell: r => r.name },
          {
            label: "OT multiplier",
            cell: r => <span className="num">{r.multiplier}×</span>,
          },
          { label: "Billable", cell: r => (r.billable ? "Yes" : "No") },
          { label: "Active", cell: r => (r.isActive ? "Yes" : "No") },
        ]}
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "multiplier", label: "OT multiplier (0–5)", type: "number" },
          { key: "billable", label: "Billable", type: "check" },
          { key: "isActive", label: "Active", type: "check" },
        ]}
        defaults={{ name: "", multiplier: 1, billable: true, isActive: true }}
        onSave={(d, id) =>
          time.mutateAsync({
            id,
            name: text(d, "name"),
            multiplier: number(d, "multiplier"),
            billable: flag(d, "billable"),
            isActive: flag(d, "isActive"),
          })
        }
      />
      <ReferenceEditor
        title="Expense code"
        description="Control whether expenses contribute to job cost and billing."
        rows={ref?.expenseCodes ?? []}
        columns={[
          { label: "Name", cell: r => r.name },
          { label: "Billable", cell: r => (r.billable ? "Yes" : "No") },
          { label: "Costable", cell: r => (r.costable ? "Yes" : "No") },
          { label: "Active", cell: r => (r.isActive ? "Yes" : "No") },
        ]}
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "billable", label: "Billable", type: "check" },
          { key: "costable", label: "Costable", type: "check" },
          { key: "isActive", label: "Active", type: "check" },
        ]}
        defaults={{ name: "", billable: true, costable: true, isActive: true }}
        onSave={(d, id) =>
          expense.mutateAsync({
            id,
            name: text(d, "name"),
            billable: flag(d, "billable"),
            costable: flag(d, "costable"),
            isActive: flag(d, "isActive"),
          })
        }
      />
    </div>
  );
}
