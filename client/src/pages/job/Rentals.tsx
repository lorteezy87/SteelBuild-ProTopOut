import { useState } from "react";
import { toast } from "sonner";
import { CALL_OFF_LABEL, type CallOff } from "@shared/rentals";
import { RecordDrawer } from "@/components/brand/Controls";
import { ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nullableNumber, nullableText, number, text, type Draft } from "@/features/admin/Editor";
import { RecordList } from "@/features/records/RecordList";
import { errMsg, fmtDate, fmtMoney } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useJob } from "./JobContext";

type Rental = RouterOutputs["rentals"]["list"][number];
const TONE: Record<CallOff, "red" | "amber" | "green" | "gray"> = {
  overdue: "red",
  call_off_now: "red",
  call_off_soon: "amber",
  no_planned_date: "amber",
  not_yet_on_rent: "gray",
  called_off: "green",
  off_rent: "gray",
  on_rent: "green",
};
const today = () => new Date().toLocaleDateString("en-CA");

function callOffText(r: Rental) {
  const date = r.callOff.status === "called_off" ? r.calledOffOn : r.callOff.status === "off_rent" ? r.offRentDate : r.callOff.callBy;
  return CALL_OFF_LABEL[r.callOff.status].replace("{date}", fmtDate(date));
}

/** Job tab: rented equipment — on/off rent, call-off reminders, cost to date and standby days. */
export default function Rentals() {
  const { projectId, can } = useJob();
  const editable = can("task.edit");
  const q = trpc.rentals.list.useQuery({ projectId });
  const { ref } = useRefData();
  const utils = trpc.useUtils();
  const refresh = () => Promise.all([utils.rentals.list.invalidate({ projectId }), utils.financials.invalidate(), utils.today.invalidate()]);
  const opts = { onSuccess: refresh };
  const create = trpc.rentals.create.useMutation(opts);
  const update = trpc.rentals.update.useMutation(opts);
  const remove = trpc.rentals.remove.useMutation(opts);
  const callOff = trpc.rentals.callOff.useMutation({ ...opts, onError: e => toast.error(errMsg(e)) });
  const offRent = trpc.rentals.offRent.useMutation({ ...opts, onError: e => toast.error(errMsg(e)) });
  const [action, setAction] = useState<{ kind: "callOff" | "offRent"; r: Rental } | null>(null);
  const [aDate, setADate] = useState(today());
  const [conf, setConf] = useState("");
  if (q.isLoading) return <Loading label="Loading rentals…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = q.data ?? [];
  const equip = (ref?.equipment ?? []).map(e => ({ value: String(e.id), label: e.name }));
  const vendors = (ref?.companies ?? []).map(c => ({ value: String(c.id), label: c.name }));
  const fin = can("project.financials");
  const input = (d: Draft) => ({
    description: text(d, "description").trim(),
    equipmentId: d.equipmentId ? Number(d.equipmentId) : null,
    vendorCompanyId: d.vendorCompanyId ? Number(d.vendorCompanyId) : null,
    vendorName: nullableText(d, "vendorName"),
    poNumber: nullableText(d, "poNumber"),
    onRentDate: text(d, "onRentDate"),
    offRentDate: nullableText(d, "offRentDate"),
    plannedOffRentDate: nullableText(d, "plannedOffRentDate"),
    callOffNoticeDays: Math.max(0, Math.round(number(d, "callOffNoticeDays"))),
    dayRate: nullableNumber(d, "dayRate"),
    weekRate: nullableNumber(d, "weekRate"),
    monthRate: nullableNumber(d, "monthRate"),
    deliveryCharge: nullableNumber(d, "deliveryCharge"),
    pickupCharge: nullableNumber(d, "pickupCharge"),
    notes: nullableText(d, "notes"),
  });
  const vendor = (r: Rental) => r.vendorName || vendors.find(v => v.value === String(r.vendorCompanyId))?.label || "—";
  const onRent = rows.filter(r => !r.offRentDate);
  const unpriced = rows.filter(r => !r.priced).length;
  return (
    <Panel
      title="Equipment rentals"
      actions={<span className="text-xs text-muted-foreground">{onRent.length} on rent{unpriced ? ` · ${unpriced} without a rate` : ""}</span>}
      bodyClassName="p-0"
    >
      <RecordList<Rental>
        rows={rows}
        noun="Rental"
        editable={editable}
        minWidth={1180}
        empty={{ title: "No rentals", body: "Track each rented crane, lift, welder or forklift: vendor, on-rent date, rates, and the planned off-rent date so TopOut reminds you to call it off." }}
        columns={[
          { label: "Equipment", cell: r => <span className="font-medium">{r.description}</span> },
          { label: "Vendor", cell: vendor },
          { label: "PO", cell: r => r.poNumber || "—" },
          { label: "On rent", cell: r => fmtDate(r.onRentDate), className: "num" },
          { label: "Planned off", cell: r => fmtDate(r.plannedOffRentDate), className: "num" },
          { label: "Status", cell: r => <Pill tone={TONE[r.callOff.status]}>{callOffText(r)}</Pill> },
          { label: "Days", cell: r => r.cost.days, right: true, className: "num" },
          { label: "Cost to date", right: true, className: "num", cell: r => (!r.priced ? <span className="text-[var(--tp-amber)]">Rate not entered</span> : fin ? fmtMoney(r.cost.total, { cents: true }) : "—") },
          { label: "Standby days", right: true, className: "num", cell: r => (r.standbyDays == null ? "—" : r.standbyDays) },
        ]}
        rowActions={r =>
          editable && !r.offRentDate ? (
            <div className="flex justify-end gap-1">
              {!r.calledOffOn && <Button size="sm" variant="outline" onClick={() => { setAction({ kind: "callOff", r }); setADate(today()); setConf(""); }}>Called off…</Button>}
              <Button size="sm" variant="outline" onClick={() => { setAction({ kind: "offRent", r }); setADate(r.plannedOffRentDate && r.plannedOffRentDate <= today() ? r.plannedOffRentDate : today()); }}>Off rent…</Button>
            </div>
          ) : null
        }
        fields={[
          { key: "description", label: "Equipment (as rented)", required: true },
          { key: "equipmentId", label: "Equipment library unit", type: "select", nullable: true, options: equip, help: "Link it so daily-report hours count as standby days and aren't costed twice." },
          { key: "vendorCompanyId", label: "Vendor", type: "select", nullable: true, options: vendors },
          { key: "vendorName", label: "Vendor (if not in companies)" },
          { key: "poNumber", label: "PO #" },
          { key: "onRentDate", label: "On rent", type: "date", required: true },
          { key: "plannedOffRentDate", label: "Planned off rent", type: "date" },
          { key: "callOffNoticeDays", label: "Vendor call-off notice (days)", type: "number", step: 1 },
          { key: "offRentDate", label: "Off rent (actual)", type: "date" },
          ...(fin
            ? ([
                { key: "dayRate", label: "Day rate", type: "number" },
                { key: "weekRate", label: "Week rate", type: "number" },
                { key: "monthRate", label: "4-week rate", type: "number" },
                { key: "deliveryCharge", label: "Delivery charge", type: "number" },
                { key: "pickupCharge", label: "Pickup charge", type: "number" },
              ] as const)
            : []),
          { key: "notes", label: "Notes", type: "textarea" },
        ]}
        blank={{ onRentDate: today(), callOffNoticeDays: 1 }}
        toDraft={r => ({
          description: r.description,
          equipmentId: r.equipmentId == null ? null : String(r.equipmentId),
          vendorCompanyId: r.vendorCompanyId == null ? null : String(r.vendorCompanyId),
          vendorName: r.vendorName,
          poNumber: r.poNumber,
          onRentDate: r.onRentDate,
          plannedOffRentDate: r.plannedOffRentDate,
          callOffNoticeDays: r.callOffNoticeDays,
          offRentDate: r.offRentDate,
          dayRate: r.dayRate,
          weekRate: r.weekRate,
          monthRate: r.monthRate,
          deliveryCharge: r.deliveryCharge,
          pickupCharge: r.pickupCharge,
          notes: r.notes,
        })}
        validate={d => (!text(d, "description").trim() || !text(d, "onRentDate") ? "Enter the equipment and the on-rent date" : null)}
        onSave={(d, row) => {
          const v = input(d);
          if (row) {
            const { dayRate, weekRate, monthRate, deliveryCharge, pickupCharge, ...rest } = v;
            return update.mutateAsync({ id: row.id, ...rest, ...(fin ? { dayRate, weekRate, monthRate, deliveryCharge, pickupCharge } : {}) });
          }
          return create.mutateAsync({ projectId, ...v });
        }}
        onDelete={r => remove.mutateAsync({ id: r.id })}
      />
      <RecordDrawer
        open={action != null}
        onOpenChange={o => !o && setAction(null)}
        eyebrow={action?.r.description}
        title={action?.kind === "callOff" ? "Record call-off" : "Take off rent"}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              disabled={!aDate || callOff.isPending || offRent.isPending}
              onClick={async () => {
                if (!action) return;
                if (action.kind === "callOff") await callOff.mutateAsync({ id: action.r.id, calledOffOn: aDate, confirmation: conf.trim() || null });
                else await offRent.mutateAsync({ id: action.r.id, offRentDate: aDate });
                setAction(null);
              }}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={action?.kind === "callOff" ? "Called off on" : "Off-rent date (pickup day)"}><Input type="date" value={aDate} onChange={e => setADate(e.target.value)} /></Field>
          {action?.kind === "callOff" && <Field label="Vendor confirmation #"><Input value={conf} onChange={e => setConf(e.target.value)} /></Field>}
        </div>
      </RecordDrawer>
    </Panel>
  );
}
