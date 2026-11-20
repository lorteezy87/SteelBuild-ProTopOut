import { useState } from "react";
import { Link } from "wouter";
import { Plus, Star, Play, Trash2, FileBarChart2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useRefData } from "@/lib/ref";
import { errMsg, fmtDateTime } from "@/lib/format";
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  EmptyState,
  TabStrip,
} from "@/components/ks/Layout";
import { ConfirmButton, RecordDrawer } from "@/components/ks/Controls";
import { Pill } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPORT_SOURCES, type SourceKey } from "@shared/reports";
import { ReportResult } from "@/features/reports/ReportResult";
import { exportCsv, normalizeConfig } from "@/features/reports/model";

export default function Reports() {
  const { canGlobal, isAdmin } = useRefData();
  const utils = trpc.useUtils();
  const q = trpc.reports.list.useQuery();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [runId, setRunId] = useState<number | null>(null);
  const run = trpc.reports.runSaved.useQuery(
    { id: runId ?? 1 },
    { enabled: !!runId, staleTime: 0 }
  );
  const star = trpc.reports.star.useMutation({
    onSuccess: () => utils.reports.list.invalidate(),
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.reports.remove.useMutation({
    onSuccess: () => {
      void utils.reports.list.invalidate();
      void utils.reports.dashboards.invalidate();
      toast.success("Report deleted");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const rows = (q.data ?? []).filter(
    r =>
      (tab === "mine"
        ? r.mine
        : tab === "shared"
          ? r.isShared
          : tab === "starred"
            ? r.starred
            : true) &&
      `${r.name} ${r.description ?? ""} ${r.ownerName ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  return (
    <div>
      <PageHeader
        eyebrow="Reporting"
        title="Report library"
        subtitle="Saved views of jobs, field production and commercial exposure."
        actions={
          <>
            <Link href="/dashboards">
              <Button variant="outline" size="sm">
                Dashboards
              </Button>
            </Link>
            {canGlobal("report.create") && (
              <Link href="/reports/new">
                <Button size="sm">
                  <Plus className="size-3.5" />
                  New report
                </Button>
              </Link>
            )}
          </>
        }
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabStrip
            active={tab}
            onSelect={setTab}
            tabs={[
              { key: "all", label: "All reports" },
              { key: "mine", label: "My reports" },
              { key: "shared", label: "Shared" },
              { key: "starred", label: "Starred" },
            ]}
          />
          <Input
            aria-label="Search reports"
            placeholder="Find report…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-64 bg-[var(--ks-paper)]"
          />
        </div>
        <Panel>
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : !rows.length ? (
            <EmptyState
              icon={<FileBarChart2 className="size-6" />}
              title="No reports in this view"
              body="Choose another view or build a report from a source."
            />
          ) : (
            <div className="overflow-auto">
              <table className="ks-table">
                <thead>
                  <tr>
                    <th className="w-10">Star</th>
                    <th>Report</th>
                    <th>Source</th>
                    <th>Output</th>
                    <th>Owner / visibility</th>
                    <th>Updated</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td>
                        <button
                          aria-label={
                            r.starred ? `Unstar ${r.name}` : `Star ${r.name}`
                          }
                          disabled={star.isPending}
                          onClick={() =>
                            star.mutate({ id: r.id, starred: !r.starred })
                          }
                        >
                          <Star
                            className={`size-4 ${r.starred ? "fill-[var(--ks-accent)] text-[var(--ks-accent-ink)]" : "text-muted-foreground"}`}
                          />
                        </button>
                      </td>
                      <td>
                        <Link
                          href={`/reports/${r.id}`}
                          className="font-semibold hover:underline"
                        >
                          {r.name}
                        </Link>
                        {r.description && (
                          <div className="max-w-md truncate text-xs text-muted-foreground">
                            {r.description}
                          </div>
                        )}
                      </td>
                      <td>
                        {REPORT_SOURCES[r.config.source as SourceKey]?.label ??
                          r.config.source}
                        {r.config.appKey && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            / {r.config.appKey}
                          </span>
                        )}
                      </td>
                      <td className="capitalize">{r.config.output}</td>
                      <td>
                        {r.ownerName ?? "—"}
                        <div className="mt-1">
                          <Pill>{r.isShared ? "Shared" : "Private"}</Pill>
                          {r.mine && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              Mine
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap text-xs">
                        {fmtDateTime(r.updatedAt)}
                      </td>
                      <td className="right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRunId(r.id)}
                          >
                            <Play className="size-3.5" />
                            Run
                          </Button>
                          {(r.mine || isAdmin) && (
                            <ConfirmButton
                              title={`Delete ${r.name}?`}
                              body="Dashboards using this report will show it as unavailable."
                              confirmLabel="Delete"
                              destructive
                              disabled={remove.isPending}
                              onConfirm={() => remove.mutate({ id: r.id })}
                            >
                              <Trash2 className="size-3.5" />
                            </ConfirmButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <RecordDrawer
        width={1000}
        open={!!runId}
        onOpenChange={open => {
          if (!open) setRunId(null);
        }}
        eyebrow="Saved report / live run"
        title={run.data?.report.name ?? "Running report…"}
        actions={
          run.data && (
            <>
              <Link href={`/reports/${run.data.report.id}`}>
                <Button size="sm" variant="outline">
                  Open builder
                </Button>
              </Link>
              {run.data.result.output === "table" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run.data && exportCsv(run.data.result, run.data.report.name)
                  }
                >
                  Export CSV
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={run.isFetching}
                onClick={() => void run.refetch()}
              >
                Run again
              </Button>
            </>
          )
        }
      >
        {run.isLoading ? (
          <Loading />
        ) : run.error ? (
          <ErrorState error={run.error} />
        ) : (
          run.data && (
            <ReportResult
              result={run.data.result}
              config={normalizeConfig(run.data.report.config)}
            />
          )
        )}
      </RecordDrawer>
    </div>
  );
}
