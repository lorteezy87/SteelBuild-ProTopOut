import { useState } from "react";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { errMsg, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput, ConfirmButton } from "@/components/ks/Controls";
import { Field, Loading, ErrorState } from "@/components/ks/Layout";
import { ReferenceEditor, text, number, flag, Check } from "./Editor";
function Holidays({ id }: { id: number }) {
  const q = trpc.admin.calendars.get.useQuery({ id });
  const utils = trpc.useUtils();
  const [date, setDate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const success = async () => {
    await Promise.all([
      utils.admin.calendars.get.invalidate({ id }),
      utils.ref.all.invalidate(),
    ]);
  };
  const add = trpc.admin.calendars.addException.useMutation({
    onSuccess: () => {
      setDate(null);
      setName("");
      void success();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.admin.calendars.removeException.useMutation({
    onSuccess: success,
    onError: e => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-3">
      <h3 className="label-caps">Holidays & workday exceptions</h3>
      <table className="ks-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Working</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data?.exceptions.map(x => (
            <tr key={x.id}>
              <td className="num">{fmtDate(x.date)}</td>
              <td>{x.name ?? "—"}</td>
              <td>{x.isWorking ? "Yes" : "No"}</td>
              <td>
                <ConfirmButton
                  title="Remove calendar exception?"
                  destructive
                  onConfirm={() => remove.mutate({ id: x.id })}
                >
                  Remove
                </ConfirmButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!q.data?.exceptions.length && (
        <p className="text-muted-foreground">
          No exceptions. Add holidays below.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Name">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Holiday or make-up day"
          />
        </Field>
      </div>
      <div className="flex items-center justify-between">
        <Check
          label="Working day override"
          checked={working}
          onChange={setWorking}
        />
        <Button
          size="sm"
          disabled={!date || add.isPending}
          onClick={() =>
            date &&
            add.mutate({
              calendarId: id,
              date,
              name: name || undefined,
              isWorking: working,
            })
          }
        >
          Add exception
        </Button>
      </div>
    </div>
  );
}
export default function Calendars() {
  const { ref } = useRefData();
  const save = trpc.admin.calendars.upsert.useMutation();
  return (
    <ReferenceEditor
      title="Calendar"
      description="Scheduling and resource capacity use these work days, daily hours and holidays. Open a calendar to edit exceptions."
      rows={ref?.calendars ?? []}
      columns={[
        { label: "Name", cell: r => r.name },
        {
          label: "Work days",
          cell: r =>
            r.workDays
              .map(
                d => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]
              )
              .join(", "),
        },
        {
          label: "Hours / day",
          cell: r => <span className="num">{r.hoursPerDay}</span>,
        },
        { label: "Default", cell: r => (r.isDefault ? "Default" : "—") },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        {
          key: "hoursPerDay",
          label: "Hours / day (1–24)",
          type: "number",
          min: 1,
        },
        { key: "workDays", label: "Work days", type: "days" },
        { key: "isDefault", label: "Default calendar", type: "check" },
      ]}
      defaults={{
        name: "",
        hoursPerDay: 8,
        workDays: [1, 2, 3, 4, 5],
        isDefault: false,
      }}
      onSave={(d, id) =>
        save.mutateAsync({
          id,
          name: text(d, "name"),
          hoursPerDay: number(d, "hoursPerDay"),
          workDays: Array.isArray(d.workDays) ? d.workDays : [],
          isDefault: flag(d, "isDefault"),
        })
      }
      extra={id => <Holidays key={id} id={id} />}
    />
  );
}
