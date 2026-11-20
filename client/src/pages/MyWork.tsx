import {
  EmptyState,
  ErrorState,
  Kpi,
  Loading,
  PageHeader,
  Panel,
} from "@/components/brand/Layout";
import {
  PriorityBadge,
  ProgressBar,
  ScheduleHealth,
  SlaBadge,
  StateChip,
} from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { TaskDrawer } from "@/features/tasks/TaskDrawer";
import { EntryState, sum } from "@/features/time/shared";
import { addDays, fmtDate, fmtHours, fmtPct, weekStart } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

type Mine = RouterOutputs["tasks"]["mine"][number];
export default function MyWork() {
  const { ref, today, error: refError } = useRefData();
  const tasks = trpc.tasks.mine.useQuery();
  const start = weekStart(today);
  const time = trpc.time.week.useQuery(
    { weekStart: start },
    { enabled: !!ref }
  );
  const badges = trpc.ref.badges.useQuery();
  const [selected, setSelected] = useState<{
    projectId: number;
    taskId: number;
  } | null>(null);
  const groups: { key: string; title: string; tasks: Mine[] }[] = [
    { key: "overdue", title: "Overdue", tasks: [] },
    { key: "this", title: "This week", tasks: [] },
    { key: "next", title: "Next 2 weeks", tasks: [] },
    { key: "later", title: "Later / unscheduled", tasks: [] },
  ];
  const unique = Array.from(
    new Map((tasks.data ?? []).map(row => [row.task.id, row])).values()
  );
  for (const row of unique) {
    const due = row.task.finishDate;
    const index = !due
      ? 3
      : due < today
        ? 0
        : due <= addDays(start, 6)
          ? 1
          : due <= addDays(start, 20)
            ? 2
            : 3;
    groups[index].tasks.push(row);
  }
  const hours =
    time.data?.entries.reduce((n, entry) => n + entry.hours, 0) ?? 0;
  const states = Array.from(
    new Set(time.data?.entries.map(entry => entry.state) ?? [])
  );
  return (
    <>
      <PageHeader
        eyebrow="Assigned to me"
        title="My work"
        subtitle={`${ref?.me.name ?? "Your work"} · ${fmtDate(today)} · Active-job tasks and open log items.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/timesheet">
              Open timesheet
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        }
      />
      {refError && <ErrorState error={refError} />}
      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Overdue tasks"
            value={groups[0].tasks.length}
            tone={groups[0].tasks.length ? "red" : "green"}
            sub="Scheduled finish before today"
          />
          <Kpi
            label="Due this week"
            value={groups[1].tasks.length}
            sub={`Through ${fmtDate(addDays(start, 6))}`}
          />
          <Kpi
            label="This week's crew hours"
            value={time.isLoading ? "…" : fmtHours(hours)}
            sub={`${fmtHours(sum(time.data?.capacity ?? []))} calendar capacity`}
          />
          <Link
            href="/approvals"
            className="block hover:outline hover:outline-[var(--tp-accent)]"
          >
            <Kpi
              label="Pending approvals"
              value={badges.isLoading ? "…" : (badges.data?.total ?? "—")}
              tone={badges.data?.total ? "orange" : "gray"}
              sub="Open approval queues →"
            />
          </Link>
        </div>
        <Panel
          title={`Timesheet · week of ${fmtDate(start)}`}
          actions={
            <Link
              className="text-xs text-[var(--tp-blue)] hover:underline"
              href="/timesheet"
            >
              Review / submit week
            </Link>
          }
          bodyClassName="p-3"
        >
          {time.isLoading ? (
            <Loading />
          ) : time.error ? (
            <ErrorState error={time.error} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="num font-semibold">
                {fmtHours(hours)} logged
              </span>
              {states.length ? (
                states.map(state => (
                  <span key={state} className="flex items-center gap-1">
                    <EntryState state={state} />
                    <span className="num text-xs text-muted-foreground">
                      {fmtHours(
                        time.data?.entries
                          .filter(entry => entry.state === state)
                          .reduce((n, entry) => n + entry.hours, 0) ?? 0
                      )}
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  No entries. Open your timesheet to add hours.
                </span>
              )}
              {time.data?.entries.some(entry => entry.state === "rejected") && (
                <span className="text-xs text-[var(--tp-red-strong)]">
                  Returned time needs correction.
                </span>
              )}
            </div>
          )}
        </Panel>
        {badges.error && <ErrorState error={badges.error} />}
        <div className="label-caps pt-1 text-[var(--tp-ink)]">
          My tasks · scheduled finish
        </div>
        {tasks.isLoading ? (
          <Loading />
        ) : tasks.error ? (
          <ErrorState error={tasks.error} />
        ) : !unique.length ? (
          <Panel>
            <EmptyState
              title="No open tasks assigned to you."
              body="Active-job task assignments will appear here."
            />
          </Panel>
        ) : (
          groups.map(group => (
            <Panel
              key={group.key}
              title={`${group.title} · ${group.tasks.length}`}
            >
              {!group.tasks.length ? (
                <div className="px-4 py-3 text-xs text-muted-foreground">
                  No tasks in this bucket.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tp-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Task / erection sequence</th>
                        <th>Finish</th>
                        <th>Health</th>
                        <th>Priority</th>
                        <th className="right">Complete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tasks
                        .sort((a, b) =>
                          (a.task.finishDate ?? "9999").localeCompare(
                            b.task.finishDate ?? "9999"
                          )
                        )
                        .map(row => (
                          <tr
                            key={row.task.id}
                            onClick={() =>
                              setSelected({
                                projectId: row.task.projectId,
                                taskId: row.task.id,
                              })
                            }
                          >
                            <td>
                              <span className="num font-semibold">
                                {row.projectCode}
                              </span>
                              <div className="max-w-56 truncate text-xs text-muted-foreground">
                                {row.projectName}
                              </div>
                            </td>
                            <td>
                              <button
                                className="text-left font-medium hover:underline"
                                type="button"
                                onClick={() =>
                                  setSelected({
                                    projectId: row.task.projectId,
                                    taskId: row.task.id,
                                  })
                                }
                              >
                                <span className="num mr-2 text-xs text-muted-foreground">
                                  {row.task.wbs}
                                </span>
                                {row.task.name}
                              </button>
                              <div className="text-xs text-muted-foreground">
                                {row.task.location ??
                                  row.task.kind.replaceAll("_", " ")}
                              </div>
                            </td>
                            <td className="num whitespace-nowrap">
                              {fmtDate(row.task.finishDate)}
                            </td>
                            <td>
                              <ScheduleHealth value={row.task.scheduleHealth} />
                            </td>
                            <td>
                              <PriorityBadge value={row.task.priority} />
                            </td>
                            <td className="right min-w-28">
                              <span className="num">
                                {fmtPct(row.task.percentComplete)}
                              </span>
                              <ProgressBar
                                value={row.task.percentComplete}
                                className="mt-1"
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ))
        )}
        {ref && (
          <AssignedLogs
            apps={ref.apps.filter(
              app =>
                app.scope === "project" ||
                ref.me.isAdmin ||
                ref.me.globalPrivs.includes("bid.manage")
            )}
          />
        )}
      </div>
      {selected && (
        <TaskDrawer
          projectId={selected.projectId}
          taskId={selected.taskId}
          onClose={() => setSelected(null)}
          onChanged={() => {
            tasks.refetch();
          }}
        />
      )}
    </>
  );
}
function AssignedLogs({ apps }: { apps: RouterOutputs["ref"]["all"]["apps"] }) {
  const queries = trpc.useQueries(api =>
    apps.map(app =>
      api.wf.list({ appKey: app.key, assignedToMe: true, includeClosed: false })
    )
  );
  const loading = queries.some(query => query.isLoading);
  const rows = queries.flatMap((query, index) =>
    (query.data?.items ?? []).map(item => ({
      item,
      app: apps[index],
      state: query.data?.states.find(state => state.id === item.stateId),
    }))
  );
  const errors = queries.flatMap((query, index) =>
    query.error
      ? [
          {
            key: apps[index].key,
            name: apps[index].pluralName,
            error: query.error,
          },
        ]
      : []
  );
  return (
    <Panel
      title="My open log items"
      actions={<span className="num text-xs">{rows.length} items</span>}
    >
      {errors.map(error => (
        <div key={error.key}>
          <div className="px-4 pt-2 text-xs">{error.name}</div>
          <ErrorState error={error.error} />
        </div>
      ))}
      {loading && <Loading label="Loading assigned log items…" />}
      {!loading && !rows.length && (
        <EmptyState
          title="No open log items assigned to you."
          body="RFIs, submittals, COs and other assigned workflow records appear here."
        />
      )}
      {!!rows.length && (
        <div className="overflow-x-auto">
          <table className="tp-table min-w-[800px]">
            <thead>
              <tr>
                <th>Log / number</th>
                <th>Job</th>
                <th>Title</th>
                <th>Due</th>
                <th>State</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .sort((a, b) =>
                  (a.item.dueDate ?? "9999").localeCompare(
                    b.item.dueDate ?? "9999"
                  )
                )
                .map(({ item, app, state }) => (
                  <tr key={`${app.key}:${item.id}`}>
                    <td>
                      <span className="num font-semibold">{item.label}</span>
                      <div className="text-xs text-muted-foreground">
                        {app.name}
                      </div>
                    </td>
                    <td className="num">
                      {item.projectCode ??
                        (item.projectId ? `Job ${item.projectId}` : "Global")}
                    </td>
                    <td>
                      <Link
                        className="font-medium hover:underline"
                        href={
                          item.projectId
                            ? `/jobs/${item.projectId}/logs/${app.key}/${item.id}`
                            : `/bids/${item.id}`
                        }
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="num">{fmtDate(item.dueDate)}</td>
                    <td>
                      {state ? (
                        <StateChip
                          name={state.name}
                          color={state.color}
                          category={state.category}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <SlaBadge value={item.slaStatus} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
