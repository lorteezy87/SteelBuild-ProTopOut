import { Button } from "@/components/ui/button";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { CostHealth, Pill, ScheduleHealth } from "@/components/brand/Status";
import { errMsg, fmtDate, fmtTons } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PROJECT_STATES } from "@shared/domain";
import { ChevronLeft, RefreshCw, SlidersHorizontal } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { JobTabsDialog } from "@/features/jobs/JobTabsDialog";
import { resolveJobTabs } from "@shared/jobTabs";
import { isPublicId, jobPath, legacyJobId } from "@shared/jobUrl";
import { JobProvider, type JobParams } from "./JobContext";

/** Screen for each tab in the registry (shared/jobTabs.ts). A registry key with no screen here is not shown. */
const TAB_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  overview: lazy(() => import("./Overview")),
  schedule: lazy(() => import("./Schedule")),
  tasks: lazy(() => import("./Tasks")),
  board: lazy(() => import("./Board")),
  deliveries: lazy(() => import("./Deliveries")),
  daily: lazy(() => import("./DailyReports")),
  tickets: lazy(() => import("./Tickets")),
  logs: lazy(() => import("./Logs")),
  drawings: lazy(() => import("./Drawings")),
  model: lazy(() => import("./Model")),
  lifts: lazy(() => import("./Lifts")),
  qc: lazy(() => import("./Qc")),
  safety: lazy(() => import("./Safety")),
  rentals: lazy(() => import("./Rentals")),
  photos: lazy(() => import("./Photos")),
  financials: lazy(() => import("./Financials")),
  documents: lazy(() => import("./Documents")),
  baselines: lazy(() => import("./Baselines")),
  activity: lazy(() => import("./Activity")),
};
const DEFAULT_TABS = resolveJobTabs([]);

const safeDecode = (s: string) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

const stateTone = (s: string) => (s === "active" ? "green" : s === "on_hold" ? "amber" : s === "cancelled" ? "red" : s === "completed" ? "blue" : "gray");

export type JobRouteParams = {
  /** Legacy /jobs/:id route. */
  id?: string;
  /** Canonical /j/:pid/:slug route. */
  pid?: string;
  slug?: string;
  tab?: string;
  a?: string;
  b?: string;
};

/**
 * A job, reached either by its canonical URL (/j/{publicId}/{slug}/{tab}) or by the older
 * /jobs/{id}/{tab}. Old links keep working: once the job is loaded they are replaced in the
 * address bar by the canonical URL, as is a URL whose slug is stale after a rename.
 */
export default function JobLayout({ params }: { params: JobRouteParams }) {
  const byPublicId = params.pid !== undefined;
  const validPid = isPublicId(params.pid);
  const located = trpc.projects.locate.useQuery({ publicId: params.pid ?? "" }, { enabled: byPublicId && validPid, staleTime: Infinity, retry: false });
  const id = byPublicId ? located.data?.id ?? NaN : legacyJobId(params.id) ?? NaN;
  const hasId = Number.isFinite(id);
  const tabKey = params.tab ?? "overview";
  const jp = useMemo<JobParams>(() => ({ id, tab: tabKey, a: params.a, b: params.b }), [id, tabKey, params.a, params.b]);
  const q = trpc.projects.get.useQuery({ id }, { enabled: hasId });
  const [path] = useLocation();
  const search = useSearch();
  const [editingTabs, setEditingTabs] = useState(false);
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
  const moduleAccess = !!ref && (isAdmin || ["full", "team_member"].includes(ref.me.accessType));
  // The job's own tab layout; falls back to the registry defaults while loading or if it cannot be read.
  const layout = trpc.jobTabs.list.useQuery({ projectId: id }, { enabled: hasId && moduleAccess, staleTime: 60_000, retry: false });
  // A job opened by its old numeric URL teaches the cache its public id, so the canonical URL resolves without a round trip.
  const publicId = q.data?.project.publicId;
  useEffect(() => {
    if (publicId && hasId) utils.projects.locate.setData({ publicId }, { id });
  }, [publicId, hasId, id, utils]);

  if ((byPublicId && !validPid) || (!byPublicId && !hasId) || located.error) return <ErrorState error={located.error ?? { message: "Job not found" }} />;
  if (located.isLoading || q.isLoading || refLoading) return <Loading label="Loading job…" />;
  if (refError || !ref) return <ErrorState error={refError ?? { message: "Access information unavailable" }} />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? { message: "Job not found" }} />;

  const { project: p, companies, tons, canFinancials, counts } = q.data;
  const to = (tab?: string, a?: string, b?: string) => jobPath(p, tab, a, b);
  if (!moduleAccess && tabKey !== "logs") return <Redirect to={to("logs")} replace />;
  const canonical = to(tabKey, params.a, params.b);
  if (safeDecode(path) !== safeDecode(canonical)) return <Redirect to={search ? `${canonical}?${search}` : canonical} replace />;

  const gc = companies.find(c => c.role === "gc");
  const fab = companies.find(c => c.role === "fabricator");
  const allTabs = layout.data?.tabs ?? DEFAULT_TABS;
  const allowed = allTabs.filter(t => TAB_COMPONENTS[t.key] && (moduleAccess || t.key === "logs") && (!t.fin || canFinancials));
  const active = allowed.find(t => t.key === tabKey) ?? allowed.find(t => !t.hidden) ?? allowed[0];
  // A hidden tab opened from a link still shows in the bar while it is open, so the user can see where they are.
  const tabs = allowed.filter(t => !t.hidden || t.key === active.key);
  const Active = TAB_COMPONENTS[active.key];
  const late = p.deadline && p.projectedFinish && p.projectedFinish > p.deadline;
  const privs = q.data.privileges as string[];
  const canReforecast = privs.includes("project.edit") || privs.includes("task.progress");
  const canEditTabs = moduleAccess && privs.includes("project.edit");

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
                href={to(t.key)}
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
            {canEditTabs && (
              <button
                type="button"
                onClick={() => setEditingTabs(true)}
                title="Reorder, rename or hide this job's tabs"
                aria-label="Edit job tabs"
                className="ml-auto flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-[var(--tp-muted)] hover:text-[var(--tp-ink)]"
              >
                <SlidersHorizontal className="size-3.5" /> Tabs
              </button>
            )}
          </div>
        </div>
        {canEditTabs && (
          <JobTabsDialog projectId={id} tabs={allTabs} customized={!!layout.data?.customized} open={editingTabs} onOpenChange={setEditingTabs} />
        )}
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
