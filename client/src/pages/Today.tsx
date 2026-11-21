import { Link } from "wouter";
import { AlertTriangle, BadgeCheck, ClipboardList, CloudLightning, PhoneCall, Hourglass, ShieldAlert, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState, Kpi, Loading, PageHeader, Panel } from "@/components/brand/Layout";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";

type Row = { id: number; projectId: number | null; label: string; date: string | null; status?: string };

function TodayPanel({
  title,
  icon,
  rows,
  jobLabel,
  href,
  dateLabel,
  dateText,
  empty,
}: {
  title: string;
  icon: ReactNode;
  rows: Row[];
  jobLabel: (projectId: number) => string;
  href: (r: Row) => string;
  dateLabel: string | ((r: Row) => string);
  /** Replaces the date line, e.g. a status that carries its own date. */
  dateText?: (r: Row) => string;
  empty?: string;
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
            <li key={`${r.projectId ?? "crew"}-${r.id}`}>
              <Link href={href(r)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--tp-bone)]">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[var(--tp-ink)]">{r.label}</div>
                  {r.projectId != null && <div className="truncate text-xs text-muted-foreground">{jobLabel(r.projectId)}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[13px]">{dateText ? dateText(r) : r.date ? fmtDate(r.date) : "No date"}</div>
                  <div className="text-[11px] text-muted-foreground">{typeof dateLabel === "function" ? dateLabel(r) : dateLabel}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty ?? "Nothing needs you here."}</p>
      )}
    </Panel>
  );
}

/** The PM's landing page: what is slipping, arriving, owed and about to lapse across active jobs. */
export default function Today() {
  const q = trpc.today.summary.useQuery();
  const outlook = trpc.weather.outlook.useQuery({ projectIds: (q.data?.jobs ?? []).map(j => j.id) }, { enabled: !!q.data?.jobs.length, staleTime: 30 * 60_000, retry: false });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const jobs = new Map(d.jobs.map(j => [j.id, `${j.code ? `${j.code} · ` : ""}${j.name}`]));
  const jobLabel = (id: number) => jobs.get(id) ?? `Job ${id}`;
  return (
    <>
      <PageHeader eyebrow={`Today · ${fmtDate(d.today)}`} title="What needs you" subtitle="Across every active job: slipping sequences, loads coming in, items in your court, notice deadlines, sequences not ready to erect, certifications coming due and rentals to call off." />
      <div className="space-y-5 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Sequences at risk" value={d.sequencesAtRisk.length} />
          <Kpi label="Loads due in 7 days" value={d.loadsDue7.length} />
          <Kpi label="Logs needing action" value={d.logsNeedingAction.length} />
          <Kpi label="Notice deadlines" value={d.noticeDeadlines.length} />
          <Kpi label="Not ready to erect" value={d.sequencesNotReady.length} />
          <Kpi label="Certifications due" value={d.certsDue.length} />
          <Kpi label="Rentals to call off" value={d.rentalsToCallOff.length} />
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
          <TodayPanel
            title="Not ready to erect"
            icon={<ShieldAlert className="size-4 text-[var(--tp-amber)]" />}
            rows={d.sequencesNotReady}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/tasks`}
            dateLabel="Planned start"
          />
          <TodayPanel
            title="Certifications due"
            icon={<BadgeCheck className="size-4 text-[var(--tp-amber)]" />}
            rows={d.certsDue.map(c => ({ ...c, projectId: null }))}
            jobLabel={jobLabel}
            href={() => "/admin/certifications"}
            dateLabel={r => (r.status === "expired" ? "Expired" : r.status === "unknown" ? "Enter the expiry date" : "Expires")}
            dateText={r => (r.status === "unknown" ? "Expiry unknown" : fmtDate(r.date))}
            empty="No certifications expired, expiring within 30 days, or missing an expiry date."
          />
          <TodayPanel
            title="Rentals to call off"
            icon={<PhoneCall className="size-4 text-[var(--tp-amber)]" />}
            rows={d.rentalsToCallOff}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/rentals`}
            dateLabel={r => (r.status === "overdue" ? "Overdue — still on rent" : r.status === "call_off_now" ? "Call off today" : "Call off by")}
            empty="No rentals due to be called off in the next few days."
          />
          <TodayPanel
            title="Weather risk — next 3 days"
            icon={<CloudLightning className="size-4 text-[var(--tp-amber)]" />}
            rows={outlook.data?.flagged ?? []}
            jobLabel={jobLabel}
            href={r => `/jobs/${r.projectId}/daily`}
            dateLabel="NWS forecast"
            empty={
              outlook.isLoading
                ? "Checking the forecast…"
                : outlook.error
                  ? "Forecast needs a connection."
                  : [
                      "No forecast days over your weather limits.",
                      outlook.data?.noLocation.length ? `${outlook.data.noLocation.length} active job${outlook.data.noLocation.length === 1 ? " has" : "s have"} no site location.` : "",
                      outlook.data?.unavailable.length ? `Forecast unavailable for ${outlook.data.unavailable.length} job${outlook.data.unavailable.length === 1 ? "" : "s"}.` : "",
                    ].filter(Boolean).join(" ")
            }
          />
        </div>
      </div>
    </>
  );
}
