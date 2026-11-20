import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { fmtMoney } from "@/lib/format";
import { Pill } from "@/components/brand/Status";
import { CERT_TYPE_LABELS, certTypeLabel } from "@shared/certs";
import { ReferenceEditor, text, number, flag, checks } from "./Editor";
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
          label: "Required certifications",
          cell: r => (r.requiredCerts?.length ? r.requiredCerts.map(certTypeLabel).join(", ") : "—"),
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
        {
          key: "requiredCerts",
          label: "Required certifications",
          type: "checks",
          options: CERT_TYPE_LABELS,
          help: "Daily reports warn when a crew member in this classification has no current card.",
        },
      ]}
      defaults={{ name: "", costRate: 0, billRate: 0, isActive: true }}
      onSave={(d, id) =>
        save.mutateAsync({
          id,
          name: text(d, "name"),
          costRate: number(d, "costRate"),
          billRate: number(d, "billRate"),
          isActive: flag(d, "isActive"),
          requiredCerts: checks(d, "requiredCerts") as never,
        })
      }
    />
  );
}
