import { useState } from "react";
import { useLocation } from "wouter";
import { NewTicket } from "@/features/tm/NewTicket";
import { isStage } from "@shared/stages";
import { toast } from "sonner";
import { GateCancelled, withGate } from "@/features/tasks/gatePrompt";
import {
  ConfirmButton,
  DateInput,
  RecordDrawer,
  UserSelect,
} from "@/components/brand/Controls";
import { ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, fmtDate, fmtDateTime, fmtHours, fmtTons } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ReportAttachments } from "./ReportAttachments";
import { RecordPhotos } from "@/features/photos/RecordPhotos";
import { saveDaily, newClientKey, useSyncState, type DailySaveInput } from "@/features/offline/sync";
import { QueuedPhotos } from "@/features/offline/QueuedPhotos";
import { WeatherPanel } from "@/features/weather/WeatherPanel";
import {
  ReportLines,
  type CrewLine,
  type EquipmentLine,
  type ProgressLine,
} from "./ReportLines";

type ReportData = RouterOutputs["daily"]["get"];
/** A save kept on this device instead of reaching the server: not an error, but the form must not close as if posted. */
class SavedLocally extends Error {}

export const reportTone = (status: string) =>
  status === "final" ? "green" : "gray";

/** Outbox key of a report: its own clientKey while it only exists on this device, else one per stored report. */
export const reportKey = (reportId: number) => `r${reportId}`;

export function ReportEditor({
  projectId,
  reportId,
  localKey = null,
  canCreate,
  canUpload,
  onClose,
  onSaved,
  onSavedLocal,
  onChanged,
}: {
  projectId: number;
  reportId: number | null;
  /** clientKey of a report saved on this device that hasn't synced yet. */
  localKey?: string | null;
  canCreate: boolean;
  canUpload: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  onSavedLocal: (clientKey: string) => void;
  onChanged: () => void;
}) {
  const sync = useSyncState();
  const queued = sync.items.find(i => i.id === `daily:${localKey ?? (reportId ? reportKey(reportId) : "")}`);
  const q = trpc.daily.get.useQuery(
    { id: reportId ?? 0 },
    { enabled: !!reportId }
  );
  const wrongJob = q.data && q.data.report.projectId !== projectId;
  return (
    <RecordDrawer
      open
      width={1000}
      title={
        reportId
          ? `Daily report · ${q.data ? fmtDate(q.data.report.reportDate) : "Loading…"}`
          : queued
            ? `Daily report · ${fmtDate((queued.input as DailySaveInput).reportDate)} · on this device`
            : "New daily field report"
      }
      eyebrow="Field record"
      onOpenChange={open => !open && onClose()}
    >
      {localKey && !queued ? (
        <Loading />
      ) : reportId && q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : wrongJob ? (
        <ErrorState error={{ message: "Report belongs to another job." }} />
      ) : (
        <ReportForm
          key={`${reportId ?? localKey ?? "new"}-${q.data?.report.updatedAt?.toISOString() ?? ""}-${queued ? "q" : ""}`}
          projectId={projectId}
          data={q.data}
          queued={queued ? { input: queued.input as DailySaveInput, status: queued.status, error: queued.error } : null}
          localKey={localKey}
          onSavedLocal={onSavedLocal}
          canCreate={canCreate}
          canUpload={canUpload}
          onClose={onClose}
          onSaved={onSaved}
          onChanged={onChanged}
        />
      )}
    </RecordDrawer>
  );
}

function ReportForm({
  projectId,
  data,
  queued,
  localKey,
  canCreate,
  canUpload,
  onClose,
  onSaved,
  onSavedLocal,
  onChanged,
}: {
  projectId: number;
  data?: ReportData;
  /** A copy saved on this device and not yet synced: the form opens from it, not from the server's. */
  queued: { input: DailySaveInput; status: string; error: string | null } | null;
  localKey: string | null;
  onSavedLocal: (clientKey: string) => void;
  canCreate: boolean;
  canUpload: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  onChanged: () => void;
}) {
  const { today, ref, userName } = useRefData();
  const taskQuery = trpc.tasks.list.useQuery({ projectId });
  const utils = trpc.useUtils();
  const report = data?.report;
  const q0 = queued?.input;
  const editable = data ? data.canEdit : canCreate;
  const sync = useSyncState();
  const [clientKey] = useState(() => localKey ?? (report ? reportKey(report.id) : newClientKey()));
  const [ticketFor, setTicketFor] = useState(false);
  const [, navigate] = useLocation();
  const [head, setHead] = useState({
    reportDate: q0?.reportDate ?? report?.reportDate ?? today,
    foremanId: (q0 ? q0.foremanId : report?.foremanId) ?? ref?.me.id ?? null,
    weather: (q0 ? q0.weather : report?.weather) ?? "",
    temperature: (q0 ? q0.temperature : report?.temperature) ?? "",
    workPerformed: (q0 ? q0.workPerformed : report?.workPerformed) ?? "",
    safetyNotes: (q0 ? q0.safetyNotes : report?.safetyNotes) ?? "",
    delayNotes: (q0 ? q0.delayNotes : report?.delayNotes) ?? "",
    weatherDelay: ((q0 ? q0.weatherDelay : report?.weatherDelay) ?? null) as "none" | "partial" | "full" | null,
  });
  const [crew, setCrew] = useState<CrewLine[]>(
    q0 ? q0.crew.map(c => ({ ...c, jobRoleId: c.jobRoleId ?? null, taskId: c.taskId ?? null })) : (data?.crew ?? []).map(c => ({
      userId: c.userId ?? 0,
      jobRoleId: c.jobRoleId,
      taskId: c.taskId,
      stHours: c.stHours,
      otHours: c.otHours,
    }))
  );
  const [equipment, setEquipment] = useState<EquipmentLine[]>(
    q0 ? q0.equipment : (data?.equipment ?? []).map(e => ({
      equipmentId: e.equipmentId,
      operatingHours: e.operatingHours,
      standbyHours: e.standbyHours,
    }))
  );
  const [progress, setProgress] = useState<ProgressLine[]>(
    q0 ? q0.progress.map(p => ({ ...p, note: p.note ?? null, stage: p.stage ?? "set" })) : (data?.progress ?? []).map(p => ({
      taskId: p.taskId,
      tons: p.tons,
      pieces: p.pieces,
      note: p.note,
      stage: isStage(p.stage) ? p.stage : "set",
    }))
  );
  const [busy, setBusy] = useState(false);
  const finalize = trpc.daily.finalize.useMutation();
  const reopen = trpc.daily.reopen.useMutation();
  const remove = trpc.daily.remove.useMutation();
  const refresh = async () => {
    await Promise.all([
      utils.daily.list.invalidate({ projectId }),
      utils.daily.get.invalidate(),
      utils.tasks.list.invalidate({ projectId }),
      utils.time.week.invalidate(),
      utils.resources.workload.invalidate(),
      utils.financials.summary.invalidate({ projectId }),
    ]);
    onChanged();
  };
  const perform = async (
    fn: () => Promise<unknown>,
    message: string,
    close = false
  ) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(message);
      if (close) onClose();
    } catch (error) {
      if (error instanceof SavedLocally) toast.warning(error.message);
      else toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  const saveReport = async (andFinalize: boolean) => {
    if (!head.reportDate) throw new Error("Enter a report date.");
    if (
      crew.some(c => !c.userId) ||
      equipment.some(e => !e.equipmentId) ||
      progress.some(p => !p.taskId)
    )
      throw new Error(
        "Choose a person, equipment or sequence on every line, or remove empty lines."
      );
    const result = await saveDaily(
      { projectId, ...head, crew, equipment, progress },
      { base: report ? { id: report.id, updatedAt: report.updatedAt } : null, clientKey, label: `Daily report ${head.reportDate}` }
    );
    if (result.queued) {
      if (!report) onSavedLocal(result.clientKey);
      throw new SavedLocally(
        result.conflict
          ? "This report was changed on another device. Your copy is kept on this device — open Sync to choose which to keep."
          : andFinalize
            ? "Saved on this device. Finalizing needs a connection — finalize after it syncs."
            : "Saved on this device. It will sync when you're back online."
      );
    }
    onSaved(result.id);
    if (andFinalize) {
      // A sequence starting with its ready-to-erect gate open needs a reason; withGate asks and retries.
      try {
        await withGate(gateReasons => finalize.mutateAsync({ id: result.id, ...(gateReasons ? { gateReasons } : {}) }));
      } catch (e) {
        if (e instanceof GateCancelled) throw new Error("Saved as a draft — not finalized (a gate reason is needed).");
        throw e;
      }
    }
  };
  const status = report?.status ?? "draft";
  return (
    <div className="space-y-4">
      {ticketFor && report && (
        <NewTicket
          projectId={projectId}
          fromDailyReportId={report.id}
          defaultDate={report.reportDate}
          onClose={() => setTicketFor(false)}
          onCreated={id => navigate(`/jobs/${projectId}/tickets?ticket=${id}`)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={reportTone(status)}>
          {status[0].toUpperCase() + status.slice(1)}
        </Pill>
        <span className="num text-xs text-muted-foreground">
          {fmtHours(crew.reduce((s, c) => s + c.stHours + c.otHours, 0))} crew ·{" "}
          {fmtTons(progress.filter(p => p.stage === "set").reduce((s, p) => s + p.tons, 0))} set
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void perform(() => saveReport(false), "Report saved.")
                }
              >
                Save
              </Button>
              <ConfirmButton
                title="Finalize and post this report?"
                body="Finalizing posts ST / OT crew hours to time entries, equipment cost to this job, and erected tons / pieces to sequences. Review the field lines first; you can reopen it later."
                confirmLabel="Finalize & post"
                disabled={busy || !sync.online}
                onConfirm={() =>
                  void perform(() => saveReport(true), "Report finalized. Hours and progress posted.")
                }
              >
                Finalize
              </ConfirmButton>
            </>
          )}
          {status === "final" && report && canCreate && (
            <Button size="sm" variant="outline" onClick={() => setTicketFor(true)}>
              Create T&M ticket
            </Button>
          )}
          {status === "final" && (
            <ConfirmButton
              title="Reopen this final report?"
              body="This reverses posted crew time and sequence progress so the report can be corrected."
              disabled={busy}
              onConfirm={() =>
                void perform(
                  () => reopen.mutateAsync({ id: report!.id }),
                  "Report reopened. Posted hours and progress reversed."
                )
              }
            >
              Reopen
            </ConfirmButton>
          )}
          {report && canCreate && status === "draft" && (
            <ConfirmButton
              destructive
              title="Delete this daily report?"
              disabled={busy}
              onConfirm={() =>
                void perform(
                  () => remove.mutateAsync({ id: report.id }),
                  "Report deleted.",
                  true
                )
              }
            >
              Delete
            </ConfirmButton>
          )}
        </div>
      </div>
      {queued && (
        <div className="border border-[var(--tp-amber)] bg-[var(--tp-amber-soft)] px-3 py-2 text-xs">
          {queued.status === "conflict"
            ? `Not synced — ${queued.error ?? "changed on another device"} Open Sync in the top bar to keep yours or discard it.`
            : queued.status === "failed"
              ? `Not synced — the server refused it: ${queued.error}. Open Sync in the top bar.`
              : "Saved on this device and waiting to sync. Keep editing — the latest copy is what syncs."}
        </div>
      )}
      <div
        className={`border border-[var(--tp-rule)] px-3 py-2 text-xs ${status === "final" ? "bg-[var(--tp-green-soft)]" : "bg-[var(--tp-bone)]"}`}
      >
        {status === "final"
          ? `Posted to time entries and sequences · Finalized ${fmtDateTime(report?.approvedAt)}`
          : "Finalizing posts crew hours to time entries, equipment cost to the job, and tons / pieces erected to sequences. Draft reports do not post progress."}
      </div>
      <fieldset
        disabled={!editable || busy}
        className="grid gap-3 sm:grid-cols-4"
      >
        <Field label="Report date">
          <DateInput
            value={head.reportDate}
            onChange={v => setHead(h => ({ ...h, reportDate: v ?? "" }))}
          />
        </Field>
        <Field label="Foreman">
          <UserSelect
            value={head.foremanId}
            onChange={v => setHead(h => ({ ...h, foremanId: v }))}
          />
        </Field>
        <Field label="Weather">
          <Input
            value={head.weather}
            maxLength={128}
            onChange={e => setHead(h => ({ ...h, weather: e.target.value }))}
            placeholder="Clear, windy…"
          />
        </Field>
        <Field label="Temperature">
          <Input
            value={head.temperature}
            maxLength={32}
            onChange={e =>
              setHead(h => ({ ...h, temperature: e.target.value }))
            }
            placeholder="85°F"
          />
        </Field>
      </fieldset>
      <WeatherPanel
        projectId={projectId}
        date={head.reportDate}
        editable={editable && !busy}
        weatherDelay={head.weatherDelay}
        onWeatherDelay={v => setHead(h => ({ ...h, weatherDelay: v }))}
        onFill={t => setHead(h => ({ ...h, weather: t.weather, temperature: t.temperature }))}
      />
      {taskQuery.error && <ErrorState error={taskQuery.error} />}
      <ReportLines
        crew={crew}
        equipment={equipment}
        progress={progress}
        tasks={taskQuery.data?.tasks ?? []}
        editable={editable && !busy}
        posted={status === "final"}
        onCrew={setCrew}
        onEquipment={setEquipment}
        onProgress={setProgress}
        certGaps={data?.certGaps}
      />
      <fieldset disabled={!editable || busy} className="space-y-3">
        <Field label="Work performed">
          <Textarea
            rows={4}
            maxLength={20000}
            value={head.workPerformed}
            onChange={e =>
              setHead(h => ({ ...h, workPerformed: e.target.value }))
            }
          />
        </Field>
        <Field label="Safety notes">
          <Textarea
            rows={3}
            maxLength={20000}
            value={head.safetyNotes}
            onChange={e =>
              setHead(h => ({ ...h, safetyNotes: e.target.value }))
            }
          />
        </Field>
        <Field label="Delay / standby notes">
          <Textarea
            rows={3}
            maxLength={20000}
            value={head.delayNotes}
            onChange={e => setHead(h => ({ ...h, delayNotes: e.target.value }))}
          />
        </Field>
      </fieldset>
      {report ? (
        <>
          <Panel title="Photos" bodyClassName="p-3">
            <RecordPhotos projectId={projectId} entityType="dailyReport" entityId={report.id} canUpload={canUpload} />
          </Panel>
          <Panel title="Attachments" bodyClassName="p-3">
            <ReportAttachments
              projectId={projectId}
              reportId={report.id}
              canUpload={canUpload}
              excludePhotos
            />
          </Panel>
        </>
      ) : localKey ? (
        <Panel title="Photos" bodyClassName="p-3">
          <QueuedPhotos projectId={projectId} parentKey={localKey} canUpload={canUpload} />
        </Panel>
      ) : (
        <p className="text-xs text-muted-foreground">
          Save the report to attach field photos.
        </p>
      )}
    </div>
  );
}
