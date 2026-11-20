import { EmptyState, ErrorState, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { addDays, fmtDate, fmtHours, fmtNum } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "wouter";

type Workload = RouterOutputs["resources"]["workload"];
type Conflicts = RouterOutputs["resources"]["equipmentConflicts"];
export function WorkloadGrid({
  data,
  conflicts,
  conflictsLoading,
  conflictsError,
}: {
  data: Workload;
  conflicts: Conflicts;
  conflictsLoading: boolean;
  conflictsError: unknown;
}) {
  const { jobRoleName } = useRefData();
  const [expanded, setExpanded] = useState<number[]>([]);
  const rangeEnd = addDays(data.weeks[data.weeks.length - 1], 6);
  const rangeConflicts = conflicts.filter(
    conflict => conflict.from <= rangeEnd && conflict.to >= data.weeks[0]
  );
  function toggle(id: number) {
    setExpanded(current =>
      current.includes(id)
        ? current.filter(value => value !== id)
        : [...current, id]
    );
  }
  const weekHeaders = data.weeks.map(week => (
    <th key={week} className="right min-w-28">
      Week of <span className="num">{fmtDate(week)}</span>
    </th>
  ));
  return (
    <div className="space-y-4">
      <Panel
        title="Crew capacity heat map"
        actions={
          <div className="flex gap-2">
            <Pill tone="red" hazard>
              Overload
            </Pill>
            <Pill tone="green">At capacity</Pill>
            <Pill>Under-allocated</Pill>
          </div>
        }
      >
        {!data.people.length ? (
          <EmptyState
            title="No people match this role."
            body="Choose another job role or add active resources."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th className="min-w-64">Person / craft</th>
                  {weekHeaders}
                </tr>
              </thead>
              <tbody>
                {data.people.map(person => (
                  <Fragment key={person.userId}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          aria-expanded={expanded.includes(person.userId)}
                          className="flex w-full items-center gap-2 text-left"
                          onClick={() => toggle(person.userId)}
                        >
                          {expanded.includes(person.userId) ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          <div>
                            <div className="font-semibold">{person.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {jobRoleName(person.jobRoleId)}
                            </div>
                          </div>
                        </button>
                      </td>
                      {person.allocated.map((hours, i) => (
                        <td
                          key={i}
                          className={cn(
                            "right num border-l border-[var(--tp-rule)]",
                            person.overloaded[i]
                              ? "hazard bg-[var(--tp-red-soft)] text-[var(--tp-red-strong)]"
                              : person.capacity[i] > 0 &&
                                  hours >= person.capacity[i] * 0.95
                                ? "bg-[var(--tp-green-soft)]"
                                : "bg-[var(--tp-gray-soft)] text-muted-foreground"
                          )}
                          title={`${person.name}: ${fmtHours(hours)} allocated / ${fmtHours(person.capacity[i])} capacity`}
                        >
                          <div className="font-semibold">
                            {fmtNum(hours, 1)}{" "}
                            <span className="font-normal text-[11px]">
                              / {fmtNum(person.capacity[i], 1)} h
                            </span>
                          </div>
                          <div className="text-[10px]">
                            {person.capacity[i] === 0 && hours > 0
                              ? "No capacity"
                              : `${person.utilization[i]}%`}
                          </div>
                        </td>
                      ))}
                    </tr>
                    {expanded.includes(person.userId) &&
                      (person.tasks.length ? (
                        person.tasks.map((task, index) => (
                          <tr
                            key={`${task.taskId}:${index}`}
                            className="bg-[var(--tp-paper)]"
                          >
                            <td className="pl-9">
                              <Link
                                href={`/jobs/${task.projectId}/tasks?task=${task.taskId}`}
                                className="text-xs hover:underline"
                              >
                                <span className="num font-semibold">
                                  {task.projectCode ?? `Job ${task.projectId}`}
                                </span>{" "}
                                · {task.name}
                              </Link>
                            </td>
                            {task.hours.map((hours, i) => (
                              <td
                                key={i}
                                className="right num text-xs text-muted-foreground"
                              >
                                {hours ? fmtHours(hours) : "—"}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={data.weeks.length + 1}
                            className="pl-9 text-xs text-muted-foreground"
                          >
                            No task allocations in this range.
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Unassigned demand by job role">
        {!data.roleDemand.length ? (
          <EmptyState
            title="No unassigned role demand."
            body="Job-role assignments without a named crew member appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th className="min-w-64">Craft / work needing assignment</th>
                  {weekHeaders}
                </tr>
              </thead>
              <tbody>
                {data.roleDemand.map(role => (
                  <tr key={role.jobRoleId}>
                    <td>
                      <div className="font-semibold">{role.name}</div>
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          {role.tasks.length} task assignments
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {role.tasks.map((task, i) => (
                            <li key={`${task.taskId}:${i}`}>
                              <span className="num">
                                {task.projectCode ?? "Job"}
                              </span>{" "}
                              · {task.name}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    {role.hours.map((hours, i) => (
                      <td
                        key={i}
                        className={cn(
                          "right num",
                          hours > 0 && "bg-[var(--tp-amber-soft)]"
                        )}
                      >
                        {hours ? fmtHours(hours) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title="Crane / equipment allocation"
        actions={
          <span className="text-xs text-muted-foreground">
            Task assignment-days, not operating hours
          </span>
        }
      >
        {!data.equipment.length ? (
          <EmptyState
            title="No equipment allocations in this range."
            body="Assign a crane or equipment unit to an active job task."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th className="min-w-64">Equipment / assignments</th>
                  {weekHeaders}
                </tr>
              </thead>
              <tbody>
                {data.equipment.map(equipment => (
                  <tr key={equipment.equipmentId}>
                    <td>
                      <div className="font-semibold">{equipment.name}</div>
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          {equipment.tasks.length} task assignments
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {equipment.tasks.map((task, i) => (
                            <li key={`${task.taskId}:${i}`}>
                              <span className="num">
                                {task.projectCode ?? "Job"}
                              </span>{" "}
                              · {task.name}
                              <div className="num">
                                {task.days
                                  .map((days, wi) =>
                                    days
                                      ? `${fmtDate(data.weeks[wi])}: ${fmtNum(days)} d`
                                      : null
                                  )
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    {equipment.days.map((days, i) => {
                      const conflict = rangeConflicts.some(
                        conflict =>
                          conflict.equipmentId === equipment.equipmentId &&
                          conflict.from <= addDays(data.weeks[i], 6) &&
                          conflict.to >= data.weeks[i]
                      );
                      return (
                        <td
                          key={i}
                          className={cn(
                            "right num",
                            conflict || equipment.doubleBooked[i]
                              ? "hazard bg-[var(--tp-red-soft)] text-[var(--tp-red-strong)]"
                              : "text-muted-foreground"
                          )}
                        >
                          {days ? `${fmtNum(days)} d` : "—"}
                          {conflict && (
                            <div className="text-[10px]">Conflict</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title="Double-booked equipment"
        actions={
          <Pill tone={rangeConflicts.length ? "red" : "gray"}>
            {rangeConflicts.length} conflicts in range
          </Pill>
        }
      >
        {conflictsLoading ? (
          <Loading />
        ) : conflictsError ? (
          <ErrorState error={conflictsError} />
        ) : !rangeConflicts.length ? (
          <EmptyState
            title="No equipment conflicts in this range."
            body="Overlapping assignments of the same unit are flagged here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Assignment A</th>
                  <th>Assignment B</th>
                  <th>Overlap</th>
                </tr>
              </thead>
              <tbody>
                {rangeConflicts.map((conflict, i) => (
                  <tr
                    key={`${conflict.equipmentId}:${conflict.a.taskId}:${conflict.b.taskId}:${i}`}
                  >
                    <td className="font-medium">
                      <Pill tone="red" hazard>
                        {conflict.equipmentName}
                      </Pill>
                    </td>
                    <td>
                      <span className="num">{conflict.a.code}</span> ·{" "}
                      {conflict.a.name}
                    </td>
                    <td>
                      <span className="num">{conflict.b.code}</span> ·{" "}
                      {conflict.b.name}
                    </td>
                    <td className="num">
                      {fmtDate(conflict.from)} – {fmtDate(conflict.to)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
