import { NumberInput, SimpleSelect } from "@/components/ks/Controls";
import { ErrorState, Kpi, Loading, PageHeader } from "@/components/ks/Layout";
import { WorkloadGrid } from "@/features/resources/WorkloadGrid";
import { WeekPicker, sum } from "@/features/time/shared";
import { fmtHours, weekStart } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function Resources() {
  const { ref, today } = useRefData();
  const [start, setStart] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [role, setRole] = useState<string | null>(null);
  const selectedWeek = start ?? weekStart(today);
  const query = trpc.resources.workload.useQuery(
    {
      weekStart: selectedWeek,
      weeks,
      jobRoleId: role ? Number(role) : undefined,
    },
    { enabled: !!ref }
  );
  const conflicts = trpc.resources.equipmentConflicts.useQuery(undefined, {
    enabled: !!ref,
  });
  const data = query.data;
  const allocated =
    data?.people.reduce((n, person) => n + sum(person.allocated), 0) ?? 0;
  const capacity =
    data?.people.reduce((n, person) => n + sum(person.capacity), 0) ?? 0;
  const overload =
    data?.people.filter(person => person.overloaded.some(Boolean)).length ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Crew / crane planning"
        title="Resource workload"
        subtitle="Weekly allocated hours against each person's working calendar. Unassigned role demand is shown separately."
        actions={
          <WeekPicker value={selectedWeek} today={today} onChange={setStart} />
        }
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-24">
            <label className="label-caps mb-1 block">Weeks (1–26)</label>
            <NumberInput
              value={weeks}
              min={1}
              step={1}
              onChange={value => {
                if (
                  value != null &&
                  Number.isInteger(value) &&
                  value >= 1 &&
                  value <= 26
                )
                  setWeeks(value);
              }}
            />
          </div>
          <div className="w-56">
            <label className="label-caps mb-1 block">Job role</label>
            <SimpleSelect
              value={role}
              allowNone
              noneLabel="All job roles"
              onChange={setRole}
              options={(ref?.jobRoles ?? []).map(role => ({
                value: String(role.id),
                label: role.name,
              }))}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            Expand a person to inspect job and task allocations.
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Allocated crew hours" value={fmtHours(allocated)} />
          <Kpi
            label="Available capacity"
            value={fmtHours(capacity)}
            sub={`${data?.people.length ?? 0} people · ${weeks} weeks`}
          />
          <Kpi
            label="People overloaded"
            value={overload}
            tone={overload ? "red" : "green"}
            sub="Above capacity in at least one week"
          />
          <Kpi
            label="Unassigned role demand"
            value={fmtHours(
              data?.roleDemand.reduce((n, role) => n + sum(role.hours), 0) ?? 0
            )}
            tone="amber"
          />
        </div>
        {query.isLoading || !ref ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : data ? (
          <WorkloadGrid
            data={data}
            conflicts={conflicts.data ?? []}
            conflictsLoading={conflicts.isLoading}
            conflictsError={conflicts.error}
          />
        ) : null}
      </div>
    </>
  );
}
