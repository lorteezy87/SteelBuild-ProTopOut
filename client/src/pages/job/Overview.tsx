import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/brand/Controls";
import { CfDisplay } from "@/components/brand/CustomFields";
import { ActivityFeed } from "@/components/brand/Collab";
import {
  EmptyState,
  ErrorState,
  Field,
  Kpi,
  Loading,
  Panel,
} from "@/components/brand/Layout";
import {
  CostHealth,
  DeliveryRiskBadge,
  ProgressBar,
  ScheduleHealth,
} from "@/components/brand/Status";
import { JobFormDrawer } from "@/features/jobs/JobFormDrawer";
import { deadlineVariance, varianceLabel } from "@/features/jobs/metrics";
import { TaskDrawer } from "@/features/tasks/TaskDrawer";
import { ProductionChart } from "@/features/daily/ProductionChart";
import {
  errMsg,
  fmtDate,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtTons,
} from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import {
  CONTRACT_TYPES,
  PRIORITIES,
  PROGRESS_METHODS,
  PROJECT_COMPANY_ROLES,
} from "@shared/domain";
import { useJob } from "./JobContext";

const performanceTone = (value: number | null) =>
  value == null ? "gray" : value < 0.95 ? "red" : value < 1 ? "amber" : "green";

export default function Overview() {
  const { projectId, data, can, refetch } = useJob();
  const { project: p, tons, counts, canFinancials } = data;
  const { ref, userName, companyName, appById } = useRefData();
  const [editing, setEditing] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const tasks = trpc.tasks.list.useQuery({ projectId });
  const deliveries = trpc.deliveries.list.useQuery({ projectId });
  const logs = trpc.wf.summary.useQuery(
    { projectId },
    { enabled: can("log.view") }
  );
  const remove = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Job deleted.");
      void utils.projects.list.invalidate();
      void utils.dashboard.portfolio.invalidate();
      navigate("/jobs");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const earned = data.eva;
  const planned = data.plannedPercent;
  const variance = deadlineVariance(p.deadline, p.projectedFinish);
  const sequences = (tasks.data?.tasks ?? []).filter(
    t => t.kind === "sequence"
  );
  const links = Object.entries(PROJECT_COMPANY_ROLES).map(([role, label]) => ({
    label,
    company: data.companies.find(c => c.role === role),
  }));
  return (
    <div className="space-y-4 p-5">
      <div
        className={`grid gap-3 sm:grid-cols-2 ${canFinancials ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}
      >
        <Kpi
          label="Complete / planned"
          value={fmtPct(p.percentComplete)}
          sub={
            <>
              <span className="num">{fmtPct(planned)}</span> planned
              <ProgressBar
                value={p.percentComplete}
                planned={planned}
                className="mt-2"
              />
            </>
          }
          tone="orange"
        />
        <Kpi
          label="Tons erected / planned"
          value={fmtTons(tons.erected)}
          sub={`${fmtTons(p.totalTons || tons.planned)} planned`}
        />
        <Kpi
          label="Projected finish"
          value={
            <span className="text-[19px]">{fmtDate(p.projectedFinish)}</span>
          }
          sub={
            <>
              {fmtDate(p.deadline)} deadline ·{" "}
              {varianceLabel(variance, "calendar days")}
            </>
          }
          tone={variance != null && variance > 0 ? "red" : "gray"}
        />
        <Kpi
          label="Schedule exceptions"
          value={
            <>
              {counts.critical} / {counts.delayed} / {counts.violated}
            </>
          }
          sub="Critical / delayed / constraint violations"
          tone={counts.delayed || counts.violated ? "red" : "gray"}
        />
        {canFinancials && (
          <Kpi
            label="Cost performance"
            value={<CostHealth value={p.costHealth} />}
            sub={
              <span className="num">
                CPI {fmtNum(earned?.cpi, 2)} · SPI {fmtNum(earned?.spi, 2)}
              </span>
            }
            tone={p.costHealth === "overbudget" ? "red" : "gray"}
          />
        )}
      </div>
      {canFinancials && earned && (
        <Panel title="Earned value analysis / EVA" bodyClassName="p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <Kpi label="PV / Planned value" value={fmtMoney(earned.pv)} />
            <Kpi label="EV / Earned value" value={fmtMoney(earned.ev)} />
            <Kpi label="AC / Actual cost" value={fmtMoney(earned.ac)} />
            <Kpi label="SV / Schedule variance" value={fmtMoney(earned.sv)} tone={earned.sv < 0 ? "red" : "gray"} />
            <Kpi label="CV / Cost variance" value={fmtMoney(earned.cv)} tone={earned.cv < 0 ? "red" : "gray"} />
            <Kpi label="CPI / Cost index" value={fmtNum(earned.cpi, 2)} tone={performanceTone(earned.cpi)} />
            <Kpi label="SPI / Schedule index" value={fmtNum(earned.spi, 2)} tone={performanceTone(earned.spi)} />
            <Kpi label="EAC / Est. at completion" value={fmtMoney(earned.eac)} />
          </div>
        </Panel>
      )}
      <ProductionChart projectId={p.id} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <Panel
            title="Erection sequences"
            actions={
              <Link
                href={`/jobs/${projectId}/tasks`}
                className="text-[12px] text-[var(--tp-accent-ink)]"
              >
                All sequences & tasks →
              </Link>
            }
          >
            {tasks.isLoading ? (
              <Loading />
            ) : tasks.error ? (
              <ErrorState error={tasks.error} />
            ) : !sequences.length ? (
              <EmptyState
                title="No erection sequences"
                body="Add a sequence in Sequences & Tasks to plan the crane and crew flow."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="tp-table">
                  <thead>
                    <tr>
                      <th>Sequence / location</th>
                      <th>Start</th>
                      <th>Finish</th>
                      <th>Erected / planned</th>
                      <th>Health</th>
                      <th>Loads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequences.map(t => {
                      const loads = (deliveries.data ?? []).filter(
                        d => d.sequenceTaskId === t.id
                      );
                      const risk = loads.some(d => d.risk === "late")
                        ? "late"
                        : loads.some(d => d.risk === "at_risk")
                          ? "at_risk"
                          : loads.length &&
                              loads.every(d => d.risk === "received")
                            ? "received"
                            : "ok";
                      return (
                        <tr
                          key={t.id}
                          className="cursor-pointer"
                          onClick={() => setTaskId(t.id)}
                        >
                          <td>
                            <div className="font-semibold">
                              <span className="num mr-2 text-muted-foreground">
                                {t.wbs}
                              </span>
                              {t.name}
                            </div>
                            <div className="text-[12px] text-muted-foreground">
                              {t.location || "Location not set"}
                            </div>
                          </td>
                          <td className="num">{fmtDate(t.startDate)}</td>
                          <td className="num">{fmtDate(t.finishDate)}</td>
                          <td className="num">
                            {fmtTons(t.erectedTons)} / {fmtTons(t.plannedTons)}
                            <ProgressBar
                              value={t.percentComplete}
                              className="mt-1"
                            />
                          </td>
                          <td>
                            <ScheduleHealth value={t.scheduleHealth} />
                          </td>
                          <td>
                            {deliveries.isLoading ? (
                              "…"
                            ) : deliveries.error ? (
                              "Unavailable"
                            ) : loads.length ? (
                              <>
                                <DeliveryRiskBadge value={risk} />
                                <span className="num ml-2 text-[11px]">
                                  {loads.length}
                                </span>
                              </>
                            ) : (
                              "No loads"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {can("log.view") && (
            <Panel
              title="Open job logs"
              actions={
                <Link
                  href={`/jobs/${projectId}/logs`}
                  className="text-[12px] text-[var(--tp-accent-ink)]"
                >
                  View logs →
                </Link>
              }
            >
              {logs.isLoading ? (
                <Loading />
              ) : logs.error ? (
                <ErrorState error={logs.error} />
              ) : !logs.data?.some(l => l.open > 0) ? (
                <EmptyState
                  title="No open logs"
                  body="RFIs, submittals and notices will appear here."
                />
              ) : (
                <table className="tp-table">
                  <thead>
                    <tr>
                      <th>Log</th>
                      <th className="right">Open</th>
                      <th className="right">At risk</th>
                      <th className="right">Delayed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.data
                      .filter(l => l.open > 0)
                      .map(l => (
                        <tr key={l.appId}>
                          <td>
                            <Link
                              href={`/jobs/${projectId}/logs/${appById(l.appId)?.key ?? ""}`}
                              className="font-medium hover:text-[var(--tp-accent-ink)]"
                            >
                              {appById(l.appId)?.pluralName ?? `App ${l.appId}`}
                            </Link>
                          </td>
                          <td className="right num">{l.open}</td>
                          <td
                            className={`right num ${l.atRisk ? "text-[var(--tp-amber)]" : ""}`}
                          >
                            {l.atRisk}
                          </td>
                          <td
                            className={`right num ${l.delayed ? "hazard text-[var(--tp-red-strong)]" : ""}`}
                          >
                            {l.delayed}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}
          <Panel title="Recent activity">
            <ActivityFeed projectId={projectId} limit={8} />
          </Panel>
        </div>
        <Panel
          title="Job details"
          actions={
            can("project.edit") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3" />
                Edit
              </Button>
            )
          }
          bodyClassName="space-y-4 p-4"
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Job type">{p.projectType || "—"}</Field>
            <Field label="Priority">
              {PRIORITIES[p.priority as keyof typeof PRIORITIES] ?? p.priority}
            </Field>
            <Field label="PM">{userName(p.managerId)}</Field>
            <Field label="Start date">{fmtDate(p.startDate)}</Field>
            <Field label="Planned finish">{fmtDate(p.plannedFinish)}</Field>
            <Field label="Contract">
              {CONTRACT_TYPES[p.contractType as keyof typeof CONTRACT_TYPES] ??
                p.contractType}
            </Field>
            <Field label="Notice requirement">
              <span className="num">{p.noticeHours} hours</span>
            </Field>
            <Field label="Progress method">
              {PROGRESS_METHODS[
                p.progressMethod as keyof typeof PROGRESS_METHODS
              ] ?? p.progressMethod}
            </Field>
            <Field label="Total pieces">
              <span className="num">{fmtNum(p.totalPieces)}</span>
            </Field>
            <Field label="Calendar">
              {ref?.calendars.find(c => c.id === p.calendarId)?.name ??
                "Default"}
            </Field>
            <Field label="Schedule">
              <ScheduleHealth value={p.scheduleHealth} />
            </Field>
            {canFinancials && (
              <>
                <Field label="Contract value">
                  {fmtMoney(p.contractValue)}
                </Field>
                <Field label="Budget">{fmtMoney(p.budget)}</Field>
                <Field label="Actual cost">
                  {fmtMoney(data.costs?.total ?? p.actualCost)}
                </Field>
                <Field label="Projected cost">
                  {fmtMoney(p.projectedCost)}
                </Field>
                <Field label="Retainage">{fmtPct(p.retainagePct)}</Field>
              </>
            )}
            {links.map(c => (
              <Field key={c.label} label={c.label}>
                {companyName(c.company?.companyId)}
              </Field>
            ))}
            <Field label="Site address" className="col-span-2">
              <div className="whitespace-pre-wrap">{p.siteAddress || "—"}</div>
            </Field>
            {p.description && (
              <Field label="Scope" className="col-span-2">
                <div className="whitespace-pre-wrap">{p.description}</div>
              </Field>
            )}
          </div>
          <CfDisplay defs={data.customFieldDefs} values={data.customFields} />
          {can("project.delete") && (
            <div className="border-t border-[var(--tp-rule)] pt-3">
              <ConfirmButton
                destructive
                title={`Delete ${p.code ?? p.name}?`}
                confirmLabel="Delete job"
                body={
                  <div className="space-y-2">
                    <p>
                      This permanently removes the job, tasks, logs, reports and
                      financial entries. Type {p.code ?? p.name} to confirm.
                    </p>
                    <Input
                      value={confirmation}
                      onChange={e => setConfirmation(e.target.value)}
                    />
                  </div>
                }
                onConfirm={() => {
                  if (confirmation !== (p.code ?? p.name))
                    return toast.error("Job number does not match.");
                  remove.mutate({ id: projectId, confirm: confirmation });
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="size-3.5" />
                Delete job
              </ConfirmButton>
            </div>
          )}
        </Panel>
      </div>
      {editing && (
        <JobFormDrawer
          data={data}
          onClose={() => setEditing(false)}
          onSaved={refetch}
        />
      )}
      <TaskDrawer
        projectId={projectId}
        taskId={taskId}
        onClose={() => setTaskId(null)}
        onChanged={refetch}
      />
    </div>
  );
}
