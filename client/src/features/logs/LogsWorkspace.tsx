import { useState } from "react";
import { useLocation } from "wouter";
import { ListChecks, Plus } from "lucide-react";
import { SimpleSelect } from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
} from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LogTable } from "./LogTable";
import { LogItemDrawer } from "./LogItemDrawer";
import { NewLogDrawer } from "./NewLogDrawer";

export function LogsWorkspace({
  projectId,
  appKey,
  itemId,
  canCreate = true,
}: {
  projectId?: number;
  appKey?: string;
  itemId?: string;
  canCreate?: boolean;
}) {
  const { ref, isLoading, error } = useRefData();
  const [, navigate] = useLocation();
  const apps = (ref?.apps ?? []).filter(a => a.scope === "project");
  const selected = appKey ?? apps[0]?.key;
  const app = apps.find(a => a.key === selected);
  const summary = trpc.wf.summary.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: !!projectId }
  );
  const creationJobs = trpc.wf.creationJobs.useQuery(undefined, {
    enabled: !projectId,
  });
  const base = projectId ? `/jobs/${projectId}/logs` : "/logs";
  return (
    <>
      <PageHeader
        title={projectId ? "Job logs" : "Logs across jobs"}
        subtitle="RFIs, submittals, COs, delay notices and field issues. SLA clocks run against the job's contract notice window."
      />
      <div className="flex flex-col gap-4 p-5 lg:flex-row">
        <aside className="shrink-0 lg:w-52">
          <Panel title="Workflow logs" bodyClassName="flex flex-col">
            {isLoading ? (
              <Loading />
            ) : error ? (
              <ErrorState error={error} />
            ) : (
              apps.map(a => {
                const counts = summary.data?.find(s => s.appId === a.id);
                return (
                  <button
                    key={a.key}
                    onClick={() => navigate(`${base}/${a.key}`)}
                    className={cn(
                      "flex items-center gap-2 border-b border-[var(--tp-rule)] px-3 py-2.5 text-left last:border-0",
                      a.key === selected
                        ? "border-l-[3px] border-l-[var(--tp-accent)] bg-[var(--tp-accent-soft)] font-semibold"
                        : "hover:bg-[var(--tp-bone)]"
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: a.color }}
                    />
                    <span className="min-w-0 flex-1">{a.pluralName}</span>
                    {projectId && (
                      <span
                        className={cn(
                          "num text-xs",
                          counts?.delayed
                            ? "text-[var(--tp-red-strong)]"
                            : "text-muted-foreground"
                        )}
                        title={`${counts?.open ?? 0} open; ${counts?.atRisk ?? 0} at risk; ${counts?.delayed ?? 0} delayed`}
                      >
                        {counts?.open ?? 0}
                      </span>
                    )}
                  </button>
                );
              })
            )}
            {summary.error && <ErrorState error={summary.error} />}
          </Panel>
        </aside>
        <main className="min-w-0 flex-1">
          {isLoading ? (
            <Loading />
          ) : !apps.length ? (
            <EmptyState
              title="No job log apps configured."
              body="Ask an administrator to activate a workflow log app."
            />
          ) : !app ? (
            <ErrorState
              error={{ message: "Unknown or inactive job log app." }}
            />
          ) : (
            <LogRegister
              key={`${projectId ?? "all"}-${app.key}`}
              appKey={app.key}
              projectId={projectId}
              name={app.name}
              pluralName={app.pluralName}
              itemId={itemId}
              canCreate={projectId ? canCreate : !!creationJobs.data?.length}
              base={base}
            />
          )}
        </main>
      </div>
    </>
  );
}

function LogRegister({
  appKey,
  projectId,
  name,
  pluralName,
  itemId,
  canCreate,
  base,
}: {
  appKey: string;
  projectId?: number;
  name: string;
  pluralName: string;
  itemId?: string;
  canCreate: boolean;
  base: string;
}) {
  const [, navigate] = useLocation();
  const [category, setCategory] = useState("open");
  const [assignee, setAssignee] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { ref } = useRefData();
  const q = trpc.wf.list.useQuery({ appKey, projectId, includeClosed: true });
  const data = q.data;
  const items = data?.items ?? [];
  const jobs = Array.from(
    new Map(
      items
        .filter(i => i.projectId)
        .map(i => [
          i.projectId!,
          { id: i.projectId!, code: i.projectCode, name: i.projectName },
        ])
    ).values()
  ).sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  const rows = items.filter(i => {
    const closed =
      data?.states.find(s => s.id === i.stateId)?.category === "end";
    return (
      (category === "all" || (category === "closed" ? closed : !closed)) &&
      (assignee === "all" ||
        (assignee === "none"
          ? !i.assigneeId
          : String(i.assigneeId) === assignee)) &&
      (jobFilter === "all" || String(i.projectId) === jobFilter) &&
      `${i.label} ${i.title} ${i.projectCode ?? ""} ${Object.values(i.customFields).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  const id = itemId && /^\d+$/.test(itemId) ? Number(itemId) : null;
  const openCount = items.filter(
    i => data?.states.find(s => s.id === i.stateId)?.category !== "end"
  ).length;
  const delayedCount = items.filter(
    i =>
      i.slaStatus === "delayed" &&
      data?.states.find(s => s.id === i.stateId)?.category !== "end"
  ).length;
  return (
    <>
      <Panel
        title={pluralName}
        actions={
          <>
            <span className="num mr-2 text-xs text-muted-foreground">
              {openCount} open · {delayedCount} delayed
            </span>
            {canCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                New {name}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap gap-2 border-b border-[var(--tp-rule)] p-3">
          <div className="w-36">
            <SimpleSelect
              value={category}
              onChange={v => setCategory(v ?? "open")}
              options={{
                open: "Open states",
                closed: "Closed states",
                all: "All states",
              }}
            />
          </div>
          <div className="w-48">
            <SimpleSelect
              value={assignee}
              onChange={v => setAssignee(v ?? "all")}
              options={[
                { value: "all", label: "All assignees" },
                { value: "none", label: "Unassigned" },
                ...(ref?.users ?? [])
                  .filter(u => items.some(i => i.assigneeId === u.id))
                  .map(u => ({
                    value: String(u.id),
                    label: u.name ?? `User ${u.id}`,
                  })),
              ]}
            />
          </div>
          {!projectId && (
            <div className="w-64">
              <SimpleSelect
                value={jobFilter}
                onChange={v => setJobFilter(v ?? "all")}
                options={[
                  { value: "all", label: "All visible jobs" },
                  ...jobs.map(p => ({
                    value: String(p.id),
                    label: `${p.code} · ${p.name}`,
                  })),
                ]}
              />
            </div>
          )}
          <Input
            aria-label="Search log items"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Number, title, field value…"
            className="max-w-xs bg-[var(--tp-paper)]"
          />
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !rows.length ? (
          <EmptyState
            icon={<ListChecks className="size-6" />}
            title={`No ${pluralName.toLowerCase()} match.`}
            body="Clear the filters or create a new field record."
          />
        ) : (
          <LogTable
            items={rows}
            states={data?.states ?? []}
            defs={data?.fieldDefs ?? []}
            showJob={!projectId}
            selectedId={id}
            onSelect={rid => navigate(`${base}/${appKey}/${rid}`)}
          />
        )}
        <div className="flex justify-between border-t border-[var(--tp-rule)] px-3 py-2 text-xs text-muted-foreground">
          <span className="num">
            {rows.length} shown / {items.length} loaded
          </span>
          <span>
            {items.length >= 2000
              ? "Server limit: 2,000 items per app."
              : "Age stops when an item closes."}
          </span>
        </div>
      </Panel>
      {id && (
        <LogItemDrawer
          key={id}
          id={id}
          appKey={appKey}
          projectId={projectId}
          onClose={() => navigate(`${base}/${appKey}`)}
        />
      )}
      {itemId && !id && (
        <ErrorState error={{ message: "Invalid log item id." }} />
      )}
      {creating && (
        <NewLogDrawer
          appKey={appKey}
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={rid => {
            setCreating(false);
            navigate(`${base}/${appKey}/${rid}`);
          }}
        />
      )}
    </>
  );
}
