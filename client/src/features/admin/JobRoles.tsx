import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { fmtMoney } from "@/lib/format";
import { Pill } from "@/components/ks/Status";
import { ReferenceEditor, text, number, flag } from "./Editor";
export default function JobRoles() {
  const { ref } = useRefData();
  const save = trpc.admin.jobRoles.upsert.useMutation();
  return (
    <ReferenceEditor
      title="Job role"
      description="Default hourly labor rates. A person's own rate overrides their job-role rate."
      rows={ref?.jobRoles ?? []}
      columns={[
        { label: "Name", cell: r => r.name },
        {
          label: "Cost / hr",
          cell: r => (
            <span className="num">{fmtMoney(r.costRate, { cents: true })}</span>
          ),
        },
        {
          label: "Bill / hr",
          cell: r => (
            <span className="num">{fmtMoney(r.billRate, { cents: true })}</span>
          ),
        },
        {
          label: "Status",
          cell: r => (
            <Pill tone={r.isActive ? "green" : "gray"}>
              {r.isActive ? "Active" : "Inactive"}
            </Pill>
          ),
        },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "costRate", label: "Cost rate / hr", type: "number" },
        { key: "billRate", label: "Bill rate / hr", type: "number" },
        { key: "isActive", label: "Active", type: "check" },
      ]}
      defaults={{ name: "", costRate: 0, billRate: 0, isActive: true }}
      onSave={(d, id) =>
        save.mutateAsync({
          id,
          name: text(d, "name"),
          costRate: number(d, "costRate"),
          billRate: number(d, "billRate"),
          isActive: flag(d, "isActive"),
        })
      }
    />
  );
}
