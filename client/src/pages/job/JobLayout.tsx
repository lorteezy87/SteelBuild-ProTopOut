import { Button } from "@/components/ui/button";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { CostHealth, Pill, ScheduleHealth } from "@/components/brand/Status";
import { errMsg, fmtDate, fmtTons } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PROJECT_STATES } from "@shared/domain";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, type ComponentType, type LazyExoticComponent } from "react";
import { Link, Redirect } from "wouter";
import { toast } from "sonner";
import { JobProvider, type JobParams } from "./JobContext";

type Tab = { key: string; label: string; component: LazyExoticComponent<ComponentType>; priv?: string; fin?: boolean };

const TABS: Tab[] = [
  { key: "overview", label: "Overview", component: lazy(() => import("./Overview")) },
  { key: "schedule", label: "Schedule", component: lazy(() => import("./Schedule")) },
  { key: "tasks", label: "Sequences & Tasks", component: lazy(() => import("./Tasks")) },
  { key: "board", label: "Board", component: lazy(() => import("./Board")) },
  { key: "deliveries", label: "Deliveries", component: lazy(() => import("./Deliveries")) },
  { key: "daily", label: "Daily Reports", component: lazy(() => import("./DailyReports")) },
  { key: "tickets", label: "T&M Tickets", component: lazy(() => import("./Tickets")) },
  { key: "logs", label: "Logs", component: lazy(() => import("./Logs")) },
  { key: "drawings", label: "Drawings", component: lazy(() => import("./Drawings")) },
  { key: "model", label: "Model", component: lazy(() => import("./Model")) },
  { key: "lifts", label: "Cranes & Lifts", component: lazy(() => import("./Lifts")) },
  { key: "qc", label: "QC", component: lazy(() => import("./Qc")) },
  { key: "safety", label: "Safety", component: lazy(() => import("./Safety")) },
  { key: "rentals", label: "Rentals", component: lazy(() => import("./Rentals")) },
  { key: "financials", label: "Financials", component: lazy(() => import("./Financials")), fin: true },
  { key: "documents", label: "Documents", component: lazy(() => import("./Documents")) },
  { key: "baselines", label: "Baselines", component: lazy(() => import("./Baselines")) },
  { key: "activity", label: "Activity", component: lazy(() => import("./Activity")) },
];

const stateTone = (s: string) => (s === "active" ? "green" : s === "on_hold" ? "amber" : s === "cancelled" ? "red" : s === "completed" ? "blue" : "gray");

export default function JobLayout({ params }: { params: { id: string; tab?: string; a?: string; b?: string } }) {
  const id = Number(params.id);
  const tabKey = params.tab ?? "overview";
  const jp = useMemo<JobParams>(() => ({ id, tab: tabKey, a: params.a, b: params.b }), [id, tabKey, params.a, params.b]);
  const q = trpc.projects.get.useQuery({ id }, { enabled: Number.isFinite(id) });
  const { ref, isAdmin, userName, companyName, isLoading: refLoading, error: refError } = useRefData();
  const utils = trpc.useUtils();
  const reforecast = trpc.projects.reforecast.useMutation({
    onSuccess: r => {
      toast.success((r as { message?: string })?.message ?? "Reforecast complete.");
      utils.projects.get.invalidate({ id });
      utils.tasks.list.invalidate({ projectId: id });
    },
    onError: e => toast.error(errMsg(e)),
  });
  const refetch = useCallback(() => void q.refetch(), [q]);

  if (q.isLoading || refLoading) return <Loading label="Loading job…" />;
  if (refError || !ref) return <ErrorState error={refError ?? { message: "Access information unavailable" }} />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? { message: "Job not found" }} />;

  const moduleAccess = isAdmin || ["full", "team_member"].includes(ref.me.accessType);
  if (!moduleAccess && tabKey !== "logs") return <Redirect to={`/jobs/${id}/logs`} replace />;

  const { project: p, companies, tons, canFinancials, counts } = q.data;
  const gc = companies.find(c => c.role === "gc");
  const fab = companies.find(c => c.role === "fabricator");
  const tabs = TABS.filter(t => (moduleAccess || t.key === "logs") && (!t.fin || canFinancials));
  const active = tabs.find(t => t.key === tabKey) ?? tabs[0];
  const Active = active.component;
  const late = p.deadline && p.projectedFinish && p.projectedFinish > p.deadline;
  const privs = q.data.privileges as string[];
  const canReforecast = privs.includes("project.edit") || privs.includes("task.progress");

  return (
    <JobProvider params={jp} data={q.data} refetch={refetch}>
      <div className="flex min-h-full flex-col">
        <div className="border-b border-[var(--tp-rule)] bg-[var(--tp-paper)] px-6 pb-0 pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--tp-muted)]">
            <Link href="/jobs" className="flex items-center gap-1 hover:text-[var(--tp-accent-ink)]">
              <ChevronLeft className="size-4" /> Jobs
            </Link>
            <span className="text-[var(--tp-muted)]">/</span>
            <span className="num font-medium text-[var(--tp-ink-2)]">{p.code}</span>
            <div className="ml-auto flex items-center gap-2">
              {canReforecast && (
              <Button
                variant="outline"
                size="sm"
                disabled={reforecast.isPending}
                onClick={() => reforecast.mutate({ id })}
                title="Recalculate schedule, projected finish and health from current progress"
              >
                <RefreshCw className={cn("size-3.5", reforecast.isPending && "animate-spin")} /> Reforecast
              </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="tp-display min-w-0 truncate text-[22px] leading-tight text-[var(--tp-ink)]">{p.name}</h1>
            <Pill tone={stateTone(p.state)} dot>{PROJECT_STATES[p.state as keyof typeof PROJECT_STATES] ?? p.state}</Pill>
            {p.projectType && <span className="text-[13px] text-[var(--tp-muted)]">{p.projectType}</span>}
          </div>
          {/* Job facts */}
          <div
            className="title-block mb-4 mt-4 overflow-x-auto"
            style={{ gridTemplateColumns: "minmax(104px,0.8fr) repeat(7, minmax(124px,1fr))" }}
          >
            <Cell label="Job no."><span className="num">{p.code}</span></Cell>
            <Cell label="Project manager">{userName(p.managerId)}</Cell>
            <Cell label="General contractor">{gc ? companyName(gc.companyId) : "—"}</Cell>
            <Cell label="Fabricator">{fab ? companyName(fab.companyId) : "—"}</Cell>
            <Cell label="Tons erected">
              <span className="num">
                {fmtTons(tons.erected)}
                <span className="text-[var(--tp-muted)]"> / {fmtTons(p.totalTons || tons.planned)}</span>
              </span>
            </Cell>
            <Cell label="Schedule">
              <ScheduleHealth value={p.scheduleHealth} />
            </Cell>
            <Cell label="Cost">{canFinancials ? <CostHealth value={p.costHealth} /> : <span className="text-[var(--tp-muted)]">Restricted</span>}</Cell>
            <Cell label={late ? "Projected finish vs deadline" : "Deadline"}>
              <span className={cn("num", late && "text-[var(--tp-red-strong)]")}>
                {late ? `${fmtDate(p.projectedFinish)} › ${fmtDate(p.deadline)}` : fmtDate(p.deadline)}
              </span>
            </Cell>
          </div>
          <div className="-mb-px flex gap-0 overflow-x-auto">
            {tabs.map(t => (
              <Link
                key={t.key}
                href={t.key === "overview" ? `/jobs/${id}` : `/jobs/${id}/${t.key}`}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                  active.key === t.key ? "border-[var(--tp-accent-ink)] text-[var(--tp-ink)]" : "border-transparent text-[var(--tp-muted)] hover:text-[var(--tp-ink)]"
                )}
              >
                {t.label}
                {t.key === "tasks" && counts.delayed > 0 && (
                  <span className="num rounded-full bg-[var(--tp-red-soft)] px-1.5 text-[11px] font-semibold leading-[18px] text-[var(--tp-red-strong)]">{counts.delayed}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<Loading />}>
            <Active />
          </Suspense>
        </div>
      </div>
    </JobProvider>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center">
      <div className="label-caps">{label}</div>
      <div className="mt-1 truncate text-[14px] font-medium text-[var(--tp-ink)]">{children}</div>
    </div>
  );
}
