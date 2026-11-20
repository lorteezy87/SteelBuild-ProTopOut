import { useState } from "react";
import { Link, useLocation } from "wouter";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useRefData } from "@/lib/ref";
import {
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtHours,
  fmtPct,
  fmtTons,
  diffDays,
} from "@/lib/format";
import {
  PageHeader,
  Panel,
  Kpi,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/brand/Layout";
import { SimpleSelect } from "@/components/brand/Controls";
import {
  ScheduleHealth,
  CostHealth,
  DeliveryRiskBadge,
  ProgressBar,
  Pill,
  SlaBadge,
  scheduleTone,
  costTone,
} from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { SCHEDULE_HEALTH, COST_HEALTH } from "@shared/domain";
import { CrewChart, RfiChart, TonsChart } from "@/features/portfolio/Charts";

export default function Portfolio() {
  const { ref } = useRefData();
  const [tonsJob, setTonsJob] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const q = trpc.dashboard.portfolio.useQuery(
    undefined
  );
  const tons = trpc.dashboard.jobTons.useQuery(
    { projectId: Number(tonsJob) || 1 },
    { enabled: !!tonsJob }
  );
  const d = q.data;
  const rag = (counts: Record<string, number>, type: "schedule" | "cost") => {
    const labels: Record<string, string> =
      type === "schedule" ? SCHEDULE_HEALTH : COST_HEALTH;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {Object.entries(counts).map(([key, n]) => (
          <Pill
            key={key}
            tone={type === "schedule" ? scheduleTone(key) : costTone(key)}
            dot
          >
            {n} {labels[key] ?? key}
          </Pill>
        ))}
        {!Object.keys(counts).length && "No jobs in scope"}
      </div>
    );
  };
  return (
    <div>
      <PageHeader
        eyebrow="Portfolio / operations"
        title="Erection control room"
        subtitle={
          d
            ? `As of ${fmtDate(d.today)} · active jobs · current plan`
            : "Schedule, loads, exposure and production."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={q.isFetching}
              onClick={() => {
                void q.refetch();
                if (tonsJob) void tons.refetch();
              }}
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        d && (
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label="Active jobs"
                value={d.counts.active}
                sub={`${d.counts.onHold} on hold · ${d.counts.draft} draft`}
              />
              <Kpi
                label="Schedule health"
                value={
                  (d.scheduleRag.delayed ?? 0) + (d.scheduleRag.blocked ?? 0)
                }
                sub={<>slipping / blocked{rag(d.scheduleRag, "schedule")}</>}
              />
              <Kpi
                label="Cost health"
                value={d.costRag.overbudget ?? 0}
                sub={<>overbudget{rag(d.costRag, "cost")}</>}
              />
              <Kpi
                label="Loads late / at risk"
                value={`${d.deliveries.filter(x => x.risk === "late").length} / ${d.deliveries.filter(x => x.risk === "at_risk").length}`}
                tone={
                  d.deliveries.some(x => x.risk === "late")
                    ? "red"
                    : d.deliveries.length
                      ? "amber"
                      : "gray"
                }
                sub="Exceptions shown · max 25"
              />
              <Kpi
                label="CO pending"
                value={fmtMoney(d.money?.coPending, { compact: true })}
                sub={
                  <Link href="/logs/co" className="hover:underline">
                    Approved {fmtMoney(d.money?.coApproved, { compact: true })}
                  </Link>
                }
              />
              <Kpi
                label="Backcharges open"
                value={fmtMoney(d.money?.bcOutstanding, { compact: true })}
                sub={
                  <Link href="/logs/backcharge" className="hover:underline">
                    Recovered{" "}
                    {fmtMoney(d.money?.bcRecovered, { compact: true })}
                  </Link>
                }
              />
              <Kpi
                label="Crew hours / week"
                value={fmtHours(d.crewHours.total)}
                sub="All time sources · Mon–Sun"
              />
              <Kpi
                label="Actual / budget"
                value={
                  d.money
                    ? fmtMoney(
                        d.jobs.reduce((s, j) => s + (j.actualCost ?? 0), 0),
                        { compact: true }
                      )
                    : "—"
                }
                sub={
                  d.money
                    ? `Budget ${fmtMoney(
                        d.jobs.reduce((s, j) => s + (j.budget ?? 0), 0),
                        { compact: true }
                      )} · financial access only`
                    : "Financial access required"
                }
              />
            </div>
            <Panel
              title="Jobs / health matrix"
              actions={
                <Link href="/jobs" className="text-xs hover:underline">
                  All jobs ↗
                </Link>
              }
            >
              {!d.jobs.length ? (
                <EmptyState
                  title="No active jobs"
                  body="Activate a job to see health, tons and exceptions here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>Job / PM</th>
                        <th>Complete / plan</th>
                        <th>Schedule</th>
                        <th>Cost</th>
                        <th>Projected / deadline</th>
                        <th className="text-right">Erected / planned</th>
                        <th className="text-right">Actual / budget</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.jobs.map(j => {
                        const slip =
                          j.deadline && j.projectedFinish
                            ? diffDays(j.deadline, j.projectedFinish)
                            : 0;
                        return (
                          <tr
                            key={j.id}
                            className="cursor-pointer"
                            onClick={() => navigate(`/jobs/${j.id}`)}
                          >
                            <td>
                              <Link
                                href={`/jobs/${j.id}`}
                                className="font-semibold hover:underline"
                              >
                                <span className="num mr-2">
                                  {j.code || "—"}
                                </span>
                                {j.name}
                              </Link>
                              <div className="text-xs text-muted-foreground">
                                PM · {j.managerName ?? "Unassigned"}
                              </div>
                            </td>
                            <td className="min-w-40">
                              <div className="num mb-1 flex justify-between gap-3">
                                <span>{fmtPct(j.percentComplete)}</span>
                                <span className="text-muted-foreground">
                                  {fmtPct(j.plannedPercentComplete)} plan
                                </span>
                              </div>
                              <ProgressBar
                                value={j.percentComplete}
                                planned={j.plannedPercentComplete}
                              />
                            </td>
                            <td>
                              <ScheduleHealth value={j.scheduleHealth} />
                            </td>
                            <td>
                              <CostHealth value={j.costHealth} />
                            </td>
                            <td className={slip > 0 ? "hazard" : ""}>
                              <span className="num">
                                {fmtDate(j.projectedFinish)}
                              </span>
                              <div className="text-xs text-muted-foreground">
                                Due {fmtDate(j.deadline)}
                                {slip > 0 && (
                                  <span className="num ml-2 text-[var(--tp-red-strong)]">
                                    +{slip}d
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="right num">
                              {fmtTons(j.erectedTons)}
                              <div className="text-xs text-muted-foreground">
                                / {fmtTons(j.plannedTons)}
                              </div>
                            </td>
                            <td className="right num">
                              {fmtMoney(j.actualCost, { compact: true })}
                              <div className="text-xs text-muted-foreground">
                                / {fmtMoney(j.budget, { compact: true })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <div className="grid gap-4 xl:grid-cols-3">
              <Panel
                className="xl:col-span-2"
                title="Tons erected vs plan / cumulative"
                actions={
                  <div className="w-44">
                    <SimpleSelect
                      value={tonsJob}
                      onChange={setTonsJob}
                      allowNone
                      noneLabel="Portfolio"
                      options={d.jobs.map(j => ({
                        value: String(j.id),
                        label: j.code || j.name,
                      }))}
                    />
                  </div>
                }
              >
                {tonsJob && tons.isLoading ? (
                  <Loading />
                ) : tonsJob && tons.error ? (
                  <ErrorState error={tons.error} />
                ) : (
                  <TonsChart data={tonsJob ? (tons.data ?? []) : d.tons} />
                )}
              </Panel>
              <Panel
                title="Open RFIs / age"
                actions={
                  <Link className="text-xs hover:underline" href="/logs/rfi">
                    RFI log ↗
                  </Link>
                }
              >
                <RfiChart data={d.rfiAging} />
              </Panel>
            </div>
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <Panel title={`Loads / late & at risk (${d.deliveries.length})`}>
                <div className="max-h-80 overflow-auto">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>Load / job</th>
                        <th>Fabricator / sequence</th>
                        <th>Need / promised</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.deliveries.map(r => (
                        <tr key={r.id}>
                          <td>
                            <Link
                              href={`/jobs/${r.projectId}/deliveries/${r.id}`}
                              className="font-medium hover:underline"
                            >
                              {r.loadNumber}
                            </Link>
                            <div className="num text-xs text-muted-foreground">
                              {r.projectCode}
                            </div>
                          </td>
                          <td>
                            {r.fabricatorName ?? "—"}
                            <div className="text-xs text-muted-foreground">
                              {r.sequenceName ?? "Unassigned sequence"}
                            </div>
                          </td>
                          <td className="num whitespace-nowrap">
                            {fmtDate(r.needDate)}
                            <div className="text-xs text-muted-foreground">
                              {fmtDate(r.promisedDate)}
                            </div>
                          </td>
                          <td>
                            <DeliveryRiskBadge value={r.risk} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.deliveries.length && (
                  <EmptyState title="No load exceptions" className="py-7" />
                )}
              </Panel>
              <Panel title="Tasks / slipping or blocked">
                <div className="max-h-80 overflow-auto">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>Job / task</th>
                        <th>Finish / projection</th>
                        <th>Health</th>
                        <th className="text-right">Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.delayedTasks.map(t => (
                        <tr key={t.id}>
                          <td>
                            <Link
                              href={`/jobs/${t.projectId}/tasks?task=${t.id}`}
                              className="font-medium hover:underline"
                            >
                              <span className="num mr-2 text-xs">
                                {t.projectCode} · {t.wbs}
                              </span>
                              {t.name}
                            </Link>
                            {t.isCritical && (
                              <div className="label-caps text-[var(--tp-red-strong)]">
                                Critical path
                              </div>
                            )}
                          </td>
                          <td className="num whitespace-nowrap">
                            {fmtDate(t.finishDate)}
                            <div className="text-xs text-muted-foreground">
                              {fmtDate(t.projectedFinish)}
                            </div>
                          </td>
                          <td>
                            <ScheduleHealth value={t.health} />
                          </td>
                          <td className="right num">
                            {fmtPct(t.percentComplete)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.delayedTasks.length && (
                  <EmptyState title="No delayed tasks" className="py-7" />
                )}
              </Panel>
              <Panel title="Milestones / next 30 days">
                <div className="max-h-72 overflow-auto">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>Job / milestone</th>
                        <th>Finish</th>
                        <th>Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.milestones.map(m => (
                        <tr key={m.id}>
                          <td>
                            <Link
                              href={`/jobs/${m.projectId}/tasks?task=${m.id}`}
                              className="font-medium hover:underline"
                            >
                              <span className="num mr-2 text-xs">
                                {m.projectCode}
                              </span>
                              {m.name}
                            </Link>
                          </td>
                          <td className="num">{fmtDate(m.finishDate)}</td>
                          <td>
                            <ScheduleHealth value={m.health} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.milestones.length && (
                  <EmptyState
                    title="No milestones in the window"
                    className="py-7"
                  />
                )}
              </Panel>
              <Panel title="Crew hours / this week">
                <CrewChart data={d.crewHours.byJob} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--tp-rule)] px-3 py-2">
                  {d.crewHours.byJob.map(j => (
                    <Link
                      key={j.projectId}
                      href={`/jobs/${j.projectId}`}
                      className="num text-xs hover:underline"
                    >
                      {j.code || j.name} · {fmtHours(j.hours)}
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>
            <Panel title="Delay notices / notice window">
              <div className="overflow-auto">
                <table className="tp-table">
                  <thead>
                    <tr>
                      <th>Job / notice</th>
                      <th>Title</th>
                      <th>Notice due</th>
                      <th>SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.delayNotices.map(n => (
                      <tr key={n.id}>
                        <td>
                          <Link
                            href={
                              n.projectId
                                ? `/jobs/${n.projectId}/logs/delay/${n.id}`
                                : `/logs/delay/${n.id}`
                            }
                            className="num font-medium hover:underline"
                          >
                            {n.projectCode} · {n.label}
                          </Link>
                        </td>
                        <td>{n.title}</td>
                        <td className="num">{fmtDateTime(n.slaDueAt)}</td>
                        <td>
                          <SlaBadge value={n.slaStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!d.delayNotices.length && (
                <EmptyState title="No unsent delay notices" className="py-6" />
              )}
            </Panel>
            <p className="text-[11px] text-muted-foreground">
              Financials reflect accessible jobs only. Exception lists are
              service-capped. Planned percent uses current task dates and the
              job progress method. Tons are cumulative by week.
            </p>
          </div>
        )
      )}
    </div>
  );
}
