import { RecordDrawer } from "@/components/brand/Controls";
import { ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { Pill, ProgressBar, ScheduleHealth } from "@/components/brand/Status";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { TASK_KINDS } from "@shared/domain";
import { varianceLabel } from "@/features/jobs/metrics";
import { TaskDependencies } from "./TaskDependencies";
import { TaskChecklist, TaskResources } from "./TaskResources";
import { TaskForm } from "./TaskForm";
import { GatePanel } from "./GatePanel";

/** Fixed shared interface: used by Schedule, Board, Tasks and My Work. */
export type TaskDrawerProps = {
  projectId: number;
  taskId: number | null;
  onClose: () => void;
  onChanged?: () => void;
};
export function TaskDrawer({
  projectId,
  taskId,
  onClose,
  onChanged,
}: TaskDrawerProps) {
  const utils = trpc.useUtils();
  const q = trpc.tasks.get.useQuery(
    { id: taskId ?? 0 },
    { enabled: taskId != null && taskId > 0 }
  );
  const job = trpc.projects.get.useQuery(
    { id: projectId },
    { enabled: taskId != null }
  );
  const activeBaselineId = job.data?.project.activeBaselineId;
  const comparison = trpc.baselines.compare.useQuery(
    { projectId, baselineId: activeBaselineId ?? 0 },
    { enabled: taskId != null && !!activeBaselineId }
  );
  async function changed() {
    await Promise.all([
      utils.tasks.get.invalidate({ id: taskId ?? 0 }),
      utils.tasks.list.invalidate(),
      utils.tasks.mine.invalidate(),
      utils.projects.get.invalidate(),
      utils.projects.list.invalidate(),
      utils.baselines.compare.invalidate(),
      utils.dashboard.portfolio.invalidate(),
      utils.collab.activity.invalidate(),
    ]);
    onChanged?.();
  }
  const t = q.data?.task;
  const baseline = comparison.data?.items.find(item => item.taskId === taskId);
  const variance = baseline?.finishVariance ?? null;
  return (
    <RecordDrawer
      open={taskId != null}
      onOpenChange={o => !o && onClose()}
      eyebrow={
        t
          ? `Task ${t.wbs ?? t.id} · ${TASK_KINDS[t.kind as keyof typeof TASK_KINDS] ?? t.kind}`
          : "Task details"
      }
      title={t?.name ?? "Task"}
      width={760}
      actions={
        t && (
          <>
            <ScheduleHealth value={t.scheduleHealth} />
            {t.isCritical && <Pill tone="red">Critical</Pill>}
            {t.constraintViolated && (
              <Pill tone="red" hazard>
                Constraint violated
              </Pill>
            )}
          </>
        )
      }
    >
      {q.isLoading ? (
        <Loading label="Loading task…" />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        q.data &&
        t && (
          <div className="space-y-4">
            <Panel
              title="Schedule & projection"
              bodyClassName="grid gap-3 p-3 sm:grid-cols-3"
            >
              <Field label="Projected finish">
                <span className="num">{fmtDate(t.projectedFinish)}</span>
              </Field>
              <Field label="Total float">
                <span className="num">{fmtNum(t.totalFloat, 1)} work days</span>
              </Field>
              <Field label="Baseline finish variance">
                <span
                  className={`num ${variance != null && variance > 0 ? "text-[var(--tp-red-strong)]" : variance != null && variance < 0 ? "text-[var(--tp-green)]" : ""}`}
                >
                  {baseline
                    ? varianceLabel(variance, "work days")
                    : "No active baseline"}
                </span>
                {baseline && (
                  <div className="text-[11px] text-muted-foreground">
                    Baseline finish {fmtDate(baseline.baselineFinish)}
                  </div>
                )}
              </Field>
              <Field label="Progress" className="sm:col-span-3">
                <span className="num">{fmtPct(t.percentComplete)}</span>
                <ProgressBar value={t.percentComplete} className="mt-1" />
              </Field>
            </Panel>
            {t.kind === "sequence" && !q.data.isSummary && (
              <GatePanel taskId={t.id} editable={q.data.privileges.includes("task.edit")} />
            )}
            <TaskForm
              key={t.id}
              data={q.data}
              changed={changed}
              progressMethod={job.data?.project.progressMethod}
            />
            <TaskDependencies data={q.data} changed={changed} />
            <TaskResources data={q.data} changed={changed} />
            <TaskChecklist data={q.data} changed={changed} />
          </div>
        )
      )}
    </RecordDrawer>
  );
}
