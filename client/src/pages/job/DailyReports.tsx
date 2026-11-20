import { useState } from "react";
import { useLocation } from "wouter";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ks/Controls";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
} from "@/components/ks/Layout";
import { Pill } from "@/components/ks/Status";
import { ReportEditor, reportTone } from "@/features/daily/ReportEditor";
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
  const base = `/jobs/${projectId}/daily`;
  return (
    <>
      <PageHeader
        title="Daily field reports"
        subtitle="Crew time, crane standby and erection progress. Submitted reports require approval before posting."
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
                  submitted: "Submitted",
                  approved: "Approved",
                  rejected: "Rejected",
                }}
              />
            </div>
          }
        >
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : !rows.length ? (
            <EmptyState
              icon={<ClipboardList className="size-6" />}
              title="No field reports."
              body="Start a report to record the crew, equipment, tons and pieces erected today."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ks-table">
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
                  {rows.map(r => (
                    <tr
                      key={r.id}
                      className={id === r.id ? "is-selected" : "cursor-pointer"}
                      onClick={() => navigate(`${base}/${r.id}`)}
                    >
                      <td className="num">
                        <button
                          className="font-medium text-[var(--ks-accent-ink)]"
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
      </div>
      {(id || (newReport && can("dailyreport.create"))) && (
        <ReportEditor
          key={id ?? "new"}
          projectId={projectId}
          reportId={id}
          canCreate={can("dailyreport.create")}
          canUpload={can("document.upload")}
          onClose={() => navigate(base)}
          onSaved={rid => navigate(`${base}/${rid}`)}
          onChanged={() => void invalidate(projectId)}
        />
      )}
      {params.a && !id && !newReport && (
        <ErrorState error={{ message: "Invalid report id." }} />
      )}
    </>
  );
}
