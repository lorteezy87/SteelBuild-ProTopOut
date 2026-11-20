import { useState } from "react";
import { Link } from "wouter";
import { RefreshCw, Activity as ActivityIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { fmtAgo, fmtDateTime, initials } from "@/lib/format";
import { useJob } from "./JobContext";
import { Panel, Loading, ErrorState, EmptyState } from "@/components/ks/Layout";
import { SimpleSelect } from "@/components/ks/Controls";
import { Pill } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/lib/ref";

type Event = RouterOutputs["collab"]["activity"][number];
function eventLink(event: Event, projectId: number): string {
  switch (event.entityType) {
    case "task":
      return `/jobs/${projectId}/tasks?task=${event.entityId}`;
    case "dailyReport":
      return `/jobs/${projectId}/daily/${event.entityId}`;
    case "delivery":
      return `/jobs/${projectId}/deliveries/${event.entityId}`;
    case "document":
      return `/jobs/${projectId}/documents?document=${event.entityId}`;
    case "drawingSheet":
      return `/jobs/${projectId}/drawings?sheet=${event.entityId}`;
    case "drawingSet":
      return `/jobs/${projectId}/drawings?set=${event.entityId}`;
    case "logItem":
      return event.appKey ? `/jobs/${projectId}/logs/${event.appKey}/${event.entityId}` : `/jobs/${projectId}/logs`;
    default:
      return `/jobs/${projectId}`;
  }
}
const recordLabels: Record<string, string> = {
  project: "Job",
  task: "Task",
  dailyReport: "Daily report",
  delivery: "Load",
  document: "Document",
  logItem: "Log item",
  timeEntry: "Time entry",
  expense: "Expense",
  baseline: "Baseline",
  drawingSheet: "Drawing",
  drawingSet: "Drawing set",
};
export default function Activity() {
  const { projectId } = useJob();
  const [actor, setActor] = useState<string | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState("100");
  const q = trpc.collab.activity.useQuery({ projectId, limit: Number(limit) });
  const data = q.data ?? [];
  const actors = [
    ...new Map(
      data.map(e => [String(e.userId ?? "system"), e.userName ?? "System"])
    ).entries(),
  ].map(([value, label]) => ({ value, label }));
  const records = [...new Set(data.map(e => e.entityType))].map(value => ({
    value,
    label: recordLabels[value] ?? value,
  }));
  const actions = [...new Set(data.map(e => e.action))].map(value => ({
    value,
    label: value.replaceAll("_", " "),
  }));
  const rows = data.filter(
    e =>
      (!actor || String(e.userId ?? "system") === actor) &&
      (!record || e.entityType === record) &&
      (!action || e.action === action) &&
      `${e.summary} ${e.userName ?? "System"}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Job activity</h2>
          <p className="text-xs text-muted-foreground">
            Newest first · changes, comments and document revisions.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search activity…"
          aria-label="Search activity"
          className="w-60 bg-[var(--ks-paper)]"
        />
        <div className="w-40">
          <SimpleSelect
            value={actor}
            onChange={setActor}
            options={actors}
            allowNone
            noneLabel="All people"
          />
        </div>
        <div className="w-36">
          <SimpleSelect
            value={record}
            onChange={setRecord}
            options={records}
            allowNone
            noneLabel="All records"
          />
        </div>
        <div className="w-36">
          <SimpleSelect
            value={action}
            onChange={setAction}
            options={actions}
            allowNone
            noneLabel="All actions"
          />
        </div>
        <div className="w-36">
          <SimpleSelect
            value={limit}
            onChange={v => setLimit(v ?? "100")}
            options={{
              "60": "Latest 60",
              "100": "Latest 100",
              "200": "Latest 200",
            }}
          />
        </div>
        {(actor || record || action || search) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setActor(null);
              setRecord(null);
              setAction(null);
              setSearch("");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      <Panel title={`Activity / ${rows.length} shown`}>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !rows.length ? (
          <EmptyState
            icon={<ActivityIcon className="size-6" />}
            title="No activity in this view"
            body={
              data.length
                ? "Clear filters to see recent events."
                : "Job changes and collaboration will appear here."
            }
          />
        ) : (
          <ol>
            {rows.map(e => (
              <li
                key={e.id}
                className="flex gap-3 border-b border-[var(--ks-rule)] px-4 py-3 last:border-0"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-[3px] bg-[var(--ks-graphite)] text-[11px] font-semibold text-white">
                  {initials(e.userName ?? "System")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[13px]">
                      {e.userName ?? "System"}
                    </strong>
                    <Pill>{recordLabels[e.entityType] ?? e.entityType}</Pill>
                    <span className="label-caps">
                      {e.action.replaceAll("_", " ")}
                    </span>
                    <time
                      className="num ml-auto text-[11px] text-muted-foreground"
                      title={fmtDateTime(e.createdAt)}
                    >
                      {fmtAgo(e.createdAt)}
                    </time>
                  </div>
                  <Link
                    href={eventLink(e, projectId)}
                    className="mt-1 block text-[13px] hover:text-[var(--ks-accent-ink)] hover:underline"
                  >
                    {e.summary}
                  </Link>
                  <div className="num mt-1 text-[10px] text-muted-foreground">
                    {fmtDateTime(e.createdAt)} · record {e.entityId}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {data.length >= Number(limit) && (
          <div className="border-t border-[var(--ks-rule)] px-4 py-2 text-xs text-muted-foreground">
            Showing the latest {limit} events. Filters apply to these events
            only.
            {limit !== "200" && (
              <button
                onClick={() => setLimit("200")}
                className="ml-2 underline"
              >
                Load latest 200
              </button>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
