import { Link } from "wouter";
import { AlertTriangle, ClipboardList, Hourglass, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState, Kpi, Loading, PageHeader, Panel } from "@/components/brand/Layout";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";

type Row = { id: number; projectId: number; label: string; date: string | null };

function TodayPanel({
  title,
  icon,
  rows,
  jobLabel,
  href,
  dateLabel,
}: {
  title: string;
  icon: ReactNode;
  rows: Row[];
  jobLabel: (projectId: number) => string;
  href: (r: Row) => string;
  dateLabel: string;
}) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
      }
      actions={<span className="num text-xs text-muted-foreground">{rows.length}</span>}
    >
      {rows.length ? (
        <ul className="divide-y divide-[var(--tp-row-rule,var(--tp-rule))]">
          {rows.map(r => (
            <li key={`${r.projectId}-${r.id}`}>
              <Link href={href(r)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--tp-bone)]">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[var(--tp-ink)]">{r.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{jobLabel(r.projectId)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[13px]">{r.date ? fmtDate(r.date) : "No date"}</div>
                  <div className="text-[11px] text-muted-foreground">{dateLabel}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing needs you here.</p>
      )}
    </Panel>
  );
}

/** The PM's landing page: what is slipping, arriving, owed and about to lapse across active jobs. */
export default function Today() {
  const q = trpc.today.summary.useQuery();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const jobs = new Map(d.jobs.map(j => [j.id, `${j.code ? `${j.code} · ` : ""}${j.name}`]));
  const jobLabel = (id: number) => jobs.get(id) ?? `Job ${id}`;
  return (
    <>
      <PageHeader eyebrow={`Today · ${fmtDate(d.today)}`} title="What needs you" subtitle="Across every active job: slipping sequences, loads coming in, items in your court and notice deadlines." />
      <div className="space-y-5 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Sequences at risk" value={d.sequencesAtRisk.length} />
          <Kpi label="Loads due in 7 days" value={d.loadsDue7.length} />
          <Kpi label="Logs needing action" value={d.logsNeedingAction.length} />
          <Kpi label="Notice deadlines" value={d.noticeDeadlines.length} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <TodayPanel
            title="Sequences at risk"
            icon={<AlertTriangle className="size-4 text-[var(--tp-amber)]" />}
            rows={d.sequencesAtRisk}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/schedule`}
            dateLabel="Projected finish"
          />
          <TodayPanel
            title="Loads due in 7 days"
            icon={<Truck className="size-4" />}
            rows={d.loadsDue7}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/deliveries`}
            dateLabel="Promised / need"
          />
          <TodayPanel
            title="Logs needing action"
            icon={<ClipboardList className="size-4" />}
            rows={d.logsNeedingAction}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/logs`}
            dateLabel="Due"
          />
          <TodayPanel
            title="Delay-notice deadlines"
            icon={<Hourglass className="size-4 text-[var(--tp-red)]" />}
            rows={d.noticeDeadlines}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/logs`}
            dateLabel="Notice due"
          />
        </div>
      </div>
    </>
  );
}
