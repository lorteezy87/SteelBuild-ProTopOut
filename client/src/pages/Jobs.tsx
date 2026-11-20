import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowDown, ArrowUp, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ks/Controls";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
} from "@/components/ks/Layout";
import {
  CostHealth,
  Pill,
  ProgressBar,
  ScheduleHealth,
} from "@/components/ks/Status";
import { JobFormDrawer } from "@/features/jobs/JobFormDrawer";
import { errMsg, fmtDateShort, fmtPct, fmtTons } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { PROJECT_STATES } from "@shared/domain";

type Job = RouterOutputs["projects"]["list"][number];
type Sort =
  | "code"
  | "name"
  | "projectType"
  | "state"
  | "manager"
  | "gc"
  | "fabricator"
  | "percentComplete"
  | "tons"
  | "scheduleHealth"
  | "costHealth"
  | "deadline"
  | "projectedFinish"
  | "openLogs"
  | "delayedLogs"
  | "lateDeliveries";
export default function Jobs() {
  const [states, setStates] = useState<string[]>([
    "active",
    "draft",
    "on_hold",
  ]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("code");
  const [descending, setDescending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [, navigate] = useLocation();
  const { ref, userName, companyName, canGlobal } = useRefData();
  const utils = trpc.useUtils();
  const q = trpc.projects.list.useQuery({
    states,
    workspaceId: workspace ? Number(workspace) : undefined,
    search,
  });
  const reforecast = trpc.projects.reforecastMany.useMutation({
    onSuccess: r => {
      toast.success(`${r.reforecast} jobs reforecast.`);
      void utils.projects.list.invalidate();
      void utils.projects.get.invalidate();
      void utils.tasks.list.invalidate();
      void utils.dashboard.portfolio.invalidate();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const company = (j: Job, role: string) =>
    companyName(j.companies.find(c => c.role === role)?.companyId);
  const rows = useMemo(() => {
    const key = (j: Job): string | number =>
      sort === "manager"
        ? userName(j.managerId)
        : sort === "gc" || sort === "fabricator"
          ? companyName(j.companies.find(c => c.role === sort)?.companyId)
          : sort === "tons"
            ? j.erectedTons
            : (j[sort] ?? "");
    return [...(q.data ?? [])].sort((a, b) => {
      const av = key(a),
        bv = key(b);
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return (descending ? -result : result) || a.id - b.id;
    });
  }, [q.data, sort, descending, userName, companyName]);
  function header(key: Sort, label: string) {
    return (
      <button
        className="inline-flex items-center gap-1 whitespace-nowrap"
        onClick={() => {
          setSort(key);
          setDescending(key === sort ? !descending : false);
        }}
      >
        {label}
        {sort === key &&
          (descending ? (
            <ArrowDown className="size-3" />
          ) : (
            <ArrowUp className="size-3" />
          ))}
      </button>
    );
  }
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Portfolio control"
        title="Jobs"
        subtitle="Steel erection · fabrication by others"
        actions={
          <>
            {canGlobal("project.create") && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!rows.length || reforecast.isPending}
                  onClick={() =>
                    reforecast.mutate({ ids: rows.map(r => r.id) })
                  }
                >
                  <RefreshCw className="size-3.5" />
                  Reforecast visible
                </Button>
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" />
                  New Job
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ks-rule)] px-5 py-3">
        {Object.entries(PROJECT_STATES).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={states.includes(key) ? "secondary" : "outline"}
            className={
              states.includes(key) ? "ring-1 ring-inset ring-[var(--ks-accent-ink)]" : ""
            }
            aria-pressed={states.includes(key)}
            onClick={() =>
              setStates(s =>
                s.includes(key) ? s.filter(k => k !== key) : [...s, key]
              )
            }
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto w-44">
          <SimpleSelect
            value={workspace}
            onChange={setWorkspace}
            options={(ref?.workspaces ?? []).map(w => ({
              value: String(w.id),
              label: w.name,
            }))}
            allowNone
            noneLabel="All workspaces"
            size="sm"
          />
        </div>
        <Input
          aria-label="Search jobs"
          className="h-8 w-60 bg-[var(--ks-paper)]"
          placeholder="Search job # or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="num text-[12px] text-muted-foreground">
          {rows.length} jobs
        </span>
      </div>
      {q.isLoading ? (
        <Loading label="Loading jobs…" />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !rows.length ? (
        <EmptyState
          title="No matching jobs"
          body="Change the filters or create an erection job."
        />
      ) : (
        <div className="flex-1 overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>{header("code", "Job #")}</th>
                <th>{header("name", "Job")}</th>
                <th>{header("projectType", "Type")}</th>
                <th>{header("state", "State")}</th>
                <th>{header("manager", "PM")}</th>
                <th>{header("gc", "GC")}</th>
                <th>{header("fabricator", "Fabricator")}</th>
                <th>{header("percentComplete", "Complete")}</th>
                <th>{header("tons", "Erected / planned")}</th>
                <th>{header("scheduleHealth", "Schedule")}</th>
                <th>{header("costHealth", "Cost")}</th>
                <th>{header("deadline", "Deadline")}</th>
                <th>{header("projectedFinish", "Proj. finish")}</th>
                <th>{header("openLogs", "Open logs")}</th>
                <th>{header("delayedLogs", "Delayed logs")}</th>
                <th>{header("lateDeliveries", "Late loads")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(j => (
                <tr
                  key={j.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => navigate(`/jobs/${j.id}`)}
                  onKeyDown={e =>
                    e.key === "Enter" && navigate(`/jobs/${j.id}`)
                  }
                >
                  <td className="num font-medium">{j.code}</td>
                  <td className="min-w-56 font-semibold">{j.name}</td>
                  <td>{j.projectType || "—"}</td>
                  <td>
                    <Pill
                      tone={
                        j.state === "active"
                          ? "green"
                          : j.state === "on_hold"
                            ? "amber"
                            : j.state === "completed"
                              ? "blue"
                              : "gray"
                      }
                    >
                      {PROJECT_STATES[j.state as keyof typeof PROJECT_STATES] ??
                        j.state}
                    </Pill>
                  </td>
                  <td>{userName(j.managerId)}</td>
                  <td>{company(j, "gc")}</td>
                  <td>{company(j, "fabricator")}</td>
                  <td className="min-w-28">
                    <div className="num mb-1 text-right">
                      {fmtPct(j.percentComplete)}
                    </div>
                    <ProgressBar value={j.percentComplete} />
                  </td>
                  <td className="num whitespace-nowrap">
                    {fmtTons(j.erectedTons)} /{" "}
                    {fmtTons(j.totalTons || j.plannedTons)}
                  </td>
                  <td>
                    <ScheduleHealth value={j.scheduleHealth} />
                  </td>
                  <td>
                    {j.canFinancials ? (
                      <CostHealth value={j.costHealth} />
                    ) : (
                      <span className="text-muted-foreground">Restricted</span>
                    )}
                  </td>
                  <td className="num">{fmtDateShort(j.deadline)}</td>
                  <td
                    className={`num ${j.deadline && j.projectedFinish && j.projectedFinish > j.deadline ? "hazard text-[var(--ks-red-strong)]" : ""}`}
                  >
                    {fmtDateShort(j.projectedFinish)}
                  </td>
                  <td className="right num">{j.openLogs}</td>
                  <td
                    className={`right num ${j.delayedLogs ? "hazard text-[var(--ks-red-strong)]" : ""}`}
                  >
                    {j.delayedLogs}
                  </td>
                  <td
                    className={`right num ${j.lateDeliveries ? "hazard text-[var(--ks-red-strong)]" : ""}`}
                  >
                    {j.lateDeliveries}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <JobFormDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
