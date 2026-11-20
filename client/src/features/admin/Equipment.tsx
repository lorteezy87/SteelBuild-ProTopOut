import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { fmtMoney } from "@/lib/format";
import { EQUIPMENT_TYPES } from "@shared/domain";
import {
  ReferenceEditor,
  text,
  number,
  nullableText,
  nullableNumber,
  flag,
} from "./Editor";
export default function Equipment() {
  const { ref, companyName } = useRefData();
  const save = trpc.admin.equipment.upsert.useMutation();
  return (
    <ReferenceEditor
      title="Equipment"
      description="Owned and rented field equipment. Daily-report operating and standby hours use these rates."
      rows={ref?.equipment ?? []}
      columns={[
        { label: "Name", cell: r => r.name },
        {
          label: "Type",
          cell: r =>
            EQUIPMENT_TYPES[r.type as keyof typeof EQUIPMENT_TYPES] ?? r.type,
        },
        { label: "Ownership", cell: r => r.ownership },
        { label: "Vendor", cell: r => companyName(r.vendorCompanyId) },
        {
          label: "Operating / hr",
          cell: r => (
            <span className="num">
              {fmtMoney(r.hourlyRate, { cents: true })}
            </span>
          ),
        },
        {
          label: "Standby / hr",
          cell: r => (
            <span className="num">
              {fmtMoney(r.standbyRate, { cents: true })}
            </span>
          ),
        },
        { label: "Active", cell: r => (r.isActive ? "Yes" : "No") },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        {
          key: "type",
          label: "Type",
          type: "select",
          options: EQUIPMENT_TYPES,
        },
        { key: "capacity", label: "Capacity" },
        {
          key: "ownership",
          label: "Ownership",
          type: "select",
          options: { owned: "Owned", rented: "Rented" },
        },
        {
          key: "vendorCompanyId",
          label: "Vendor",
          type: "select",
          nullable: true,
          options: (ref?.companies ?? []).map(c => ({
            value: String(c.id),
            label: c.name,
          })),
        },
        { key: "hourlyRate", label: "Operating rate / hr", type: "number" },
        { key: "standbyRate", label: "Standby rate / hr", type: "number" },
        { key: "isActive", label: "Active", type: "check" },
      ]}
      defaults={{
        name: "",
        type: "crane",
        capacity: "",
        ownership: "rented",
        vendorCompanyId: null,
        hourlyRate: 0,
        standbyRate: 0,
        isActive: true,
      }}
      onSave={(d, id) =>
        save.mutateAsync({
          id,
          name: text(d, "name"),
          type: text(d, "type"),
          capacity: nullableText(d, "capacity"),
          ownership: text(d, "ownership") as "owned" | "rented",
          vendorCompanyId: nullableNumber(d, "vendorCompanyId"),
          hourlyRate: number(d, "hourlyRate"),
          standbyRate: number(d, "standbyRate"),
          isActive: flag(d, "isActive"),
        })
      }
    />
  );
}
