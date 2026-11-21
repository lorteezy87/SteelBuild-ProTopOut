import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
} from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { ReportEditor, reportKey, reportTone } from "@/features/daily/ReportEditor";
import { outboxStore, useSyncState, type DailySaveInput } from "@/features/offline/sync";
import { WeatherDays } from "@/features/weather/WeatherDays";
import { fmtDate, fmtHours, fmtTons } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useJob, useJobInvalidate } from "./JobContext";

export default function DailyReports() {
  const { projectId, params, can } = useJob();
  const { userName } = useRefData();
  const [, navigate] = useLocation();
  const invalidate = useJobInvalidate();
  const q = trpc.daily.list.useQuery({ projectId });
  const [status, setStatus] = useState("all");
  const rows = (q.data ?? []).filter(
    r => status === "all" || r.status === status
  );
  const newReport = params.a === "new";
  const id = params.a && /^\d+$/.test(params.a) ? Number(params.a) : null;
  const localKey = params.a?.startsWith("local-") ? params.a.slice(6) : null;
  const base = `/jobs/${projectId}/daily`;
  const sync = useSyncState();
  const queued = sync.items.filter(i => i.kind === "dailySave" && i.projectId === projectId);
  const localRows = queued.filter(i => !(i.input as DailySaveInput).id);
  const queuedFor = new Map(queued.map(i => [i.id, i]));
  const localGone = !!localKey && !queued.some(i => i.clientKey === localKey);
  // Once a report made on this device syncs, its page moves to the stored report.
  useEffect(() => {
    if (!localKey || !localGone) return;
    void outboxStore.getMap(localKey).then(rid => navigate(rid ? `${base}/${rid}` : base, { replace: true }));
  }, [localKey, localGone, base, navigate]);
  return (
    <>
      <PageHeader
        title="Daily field reports"
        subtitle="Crew time, crane standby and erection progress. Finalizing a report posts its hours and tons."
        actions={
          can("dailyreport.create") && (
            <Button size="sm" onClick={() => navigate(`${base}/new`)}>
              <Plus className="size-4" />
              New report
            </Button>
          )
        }
      />
      <div className="p-5">
        <Panel
          title="Field report register"
          actions={
            <div className="w-44">
              <SimpleSelect
                value={status}
                onChange={v => setStatus(v ?? "all")}
                options={{
                  all: "All reports",
                  draft: "Draft",
                  final: "Final",
                }}
              />
            </div>
          }
        >
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : !rows.length && !localRows.length ? (
            <EmptyState
              icon={<ClipboardList className="size-6" />}
              title="No field reports."
              body="Start a report to record the crew, equipment, tons and pieces erected today."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Foreman</th>
                    <th>Status</th>
                    <th className="right">Crew</th>
                    <th className="right">Crew hours</th>
                    <th className="right">Tons erected</th>
                    <th className="right">Pieces set</th>
                    <th>Weather</th>
                  </tr>
                </thead>
                <tbody>
                  {localRows.map(i => {
                    const r = i.input as DailySaveInput;
                    return (
                      <tr key={i.id} className={localKey === i.clientKey ? "is-selected" : "cursor-pointer"} onClick={() => navigate(`${base}/local-${i.clientKey}`)}>
                        <td className="num">
                          <button className="font-medium text-[var(--tp-accent-ink)]">{fmtDate(r.reportDate)}</button>
                        </td>
                        <td>{userName(r.foremanId ?? null)}</td>
                        <td>
                          <Pill tone="amber">{i.status === "conflict" || i.status === "failed" ? "Not synced — needs attention" : "On this device"}</Pill>
                        </td>
                        <td className="right num">{r.crew.length}</td>
                        <td className="right num">{fmtHours(r.crew.reduce((n, c) => n + c.stHours + c.otHours, 0))}</td>
                        <td className="right num">{fmtTons(r.progress.filter(p => (p.stage ?? "set") === "set").reduce((n, p) => n + p.tons, 0))}</td>
                        <td className="right num">{r.progress.filter(p => (p.stage ?? "set") === "set").reduce((n, p) => n + p.pieces, 0)}</td>
                        <td>{r.weather || "—"}</td>
                      </tr>
                    );
                  })}
                  {rows.map(r => (
                    <tr
                      key={r.id}
                      className={id === r.id ? "is-selected" : "cursor-pointer"}
                      onClick={() => navigate(`${base}/${r.id}`)}
                    >
                      <td className="num">
                        <button
                          className="font-medium text-[var(--tp-accent-ink)]"
                          onClick={() => navigate(`${base}/${r.id}`)}
                        >
                          {fmtDate(r.reportDate)}
                        </button>
                      </td>
                      <td>{userName(r.foremanId)}</td>
                      <td>
                        <Pill tone={reportTone(r.status)}>
                          {r.status[0].toUpperCase() + r.status.slice(1)}
                        </Pill>
                        {queuedFor.has(`daily:${reportKey(r.id)}`) && (
                          <Pill tone="amber">Unsynced changes</Pill>
                        )}
                      </td>
                      <td className="right num">{r.crewCount}</td>
                      <td className="right num">{fmtHours(r.crewHours)}</td>
                      <td className="right num">{fmtTons(r.tons)}</td>
                      <td className="right num">{r.pieces}</td>
                      <td>{r.weather || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <WeatherDays projectId={projectId} onOpen={rid => navigate(`${base}/${rid}`)} />
      </div>
      {(id || localKey || (newReport && can("dailyreport.create"))) && (
        <ReportEditor
          key={id ?? (localKey ? `local-${localKey}` : "new")}
          projectId={projectId}
          reportId={id}
          localKey={localKey}
          onSavedLocal={key => navigate(`${base}/local-${key}`)}
          canCreate={can("dailyreport.create")}
          canUpload={can("document.upload")}
          onClose={() => navigate(base)}
          onSaved={rid => navigate(`${base}/${rid}`)}
          onChanged={() => void invalidate(projectId)}
        />
      )}
      {params.a && !id && !localKey && !newReport && (
        <ErrorState error={{ message: "Invalid report id." }} />
      )}
    </>
  );
}
