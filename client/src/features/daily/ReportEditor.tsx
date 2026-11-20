import { useState } from "react";
import { toast } from "sonner";
import { CommentsPanel } from "@/components/ks/Collab";
import {
  ConfirmButton,
  DateInput,
  RecordDrawer,
  UserSelect,
} from "@/components/ks/Controls";
import { ErrorState, Field, Loading, Panel } from "@/components/ks/Layout";
import { Pill } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, fmtDate, fmtDateTime, fmtHours, fmtTons } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ReportAttachments } from "./ReportAttachments";
import {
  ReportLines,
  type CrewLine,
  type EquipmentLine,
  type ProgressLine,
} from "./ReportLines";

type ReportData = RouterOutputs["daily"]["get"];
export const reportTone = (status: string) =>
  status === "approved"
    ? "green"
    : status === "submitted"
      ? "blue"
      : status === "rejected"
        ? "red"
        : "gray";

export function ReportEditor({
  projectId,
  reportId,
  canCreate,
  canUpload,
  onClose,
  onSaved,
  onChanged,
}: {
  projectId: number;
  reportId: number | null;
  canCreate: boolean;
  canUpload: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  onChanged: () => void;
}) {
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
          : "New daily field report"
      }
      eyebrow="Field record"
      onOpenChange={open => !open && onClose()}
    >
      {reportId && q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : wrongJob ? (
        <ErrorState error={{ message: "Report belongs to another job." }} />
      ) : (
        <ReportForm
          key={`${reportId ?? "new"}-${q.data?.report.updatedAt?.toISOString() ?? ""}`}
          projectId={projectId}
          data={q.data}
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
  canCreate,
  canUpload,
  onClose,
  onSaved,
  onChanged,
}: {
  projectId: number;
  data?: ReportData;
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
  const editable = data ? data.canEdit : canCreate;
  const [head, setHead] = useState({
    reportDate: report?.reportDate ?? today,
    foremanId: report?.foremanId ?? ref?.me.id ?? null,
    weather: report?.weather ?? "",
    temperature: report?.temperature ?? "",
    workPerformed: report?.workPerformed ?? "",
    safetyNotes: report?.safetyNotes ?? "",
    delayNotes: report?.delayNotes ?? "",
  });
  const [crew, setCrew] = useState<CrewLine[]>(
    (data?.crew ?? []).map(c => ({
      userId: c.userId ?? 0,
      jobRoleId: c.jobRoleId,
      taskId: c.taskId,
      stHours: c.stHours,
      otHours: c.otHours,
    }))
  );
  const [equipment, setEquipment] = useState<EquipmentLine[]>(
    (data?.equipment ?? []).map(e => ({
      equipmentId: e.equipmentId,
      operatingHours: e.operatingHours,
      standbyHours: e.standbyHours,
    }))
  );
  const [progress, setProgress] = useState<ProgressLine[]>(
    (data?.progress ?? []).map(p => ({
      taskId: p.taskId,
      tons: p.tons,
      pieces: p.pieces,
      note: p.note,
    }))
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = trpc.daily.save.useMutation();
  const submit = trpc.daily.submit.useMutation();
  const approve = trpc.daily.approve.useMutation();
  const reject = trpc.daily.reject.useMutation();
  const reopen = trpc.daily.reopen.useMutation();
  const remove = trpc.daily.remove.useMutation();
  const refresh = async () => {
    await Promise.all([
      utils.daily.list.invalidate({ projectId }),
      utils.daily.pending.invalidate(),
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
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  const saveReport = async (andSubmit: boolean) => {
    if (!head.reportDate) throw new Error("Enter a report date.");
    if (
      crew.some(c => !c.userId) ||
      equipment.some(e => !e.equipmentId) ||
      progress.some(p => !p.taskId)
    )
      throw new Error(
        "Choose a person, equipment or sequence on every line, or remove empty lines."
      );
    const result = await save.mutateAsync({
      id: report?.id,
      projectId,
      ...head,
      crew,
      equipment,
      progress,
    });
    if (andSubmit) await submit.mutateAsync({ id: result.id });
    onSaved(result.id);
  };
  const status = report?.status ?? "draft";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={reportTone(status)}>
          {status[0].toUpperCase() + status.slice(1)}
        </Pill>
        <span className="num text-xs text-muted-foreground">
          {fmtHours(crew.reduce((s, c) => s + c.stHours + c.otHours, 0))} crew ·{" "}
          {fmtTons(progress.reduce((s, p) => s + p.tons, 0))} erected
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
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void perform(
                    () => saveReport(true),
                    "Report submitted for approval."
                  )
                }
              >
                Submit
              </Button>
            </>
          )}
          {status === "submitted" && data?.canApprove && (
            <ConfirmButton
              title="Approve and post this report?"
              body="Approval posts ST / OT crew hours to approved time entries, equipment cost to this job, and erected tons / pieces to sequences. Review the field lines before posting."
              confirmLabel="Approve & post"
              disabled={busy}
              onConfirm={() =>
                void perform(
                  () => approve.mutateAsync({ id: report!.id }),
                  "Report approved. Hours and progress posted."
                )
              }
            >
              Approve
            </ConfirmButton>
          )}
          {status === "approved" && data?.canApprove && (
            <ConfirmButton
              title="Reopen approved report?"
              body="This reverses posted crew time and sequence progress. Invoiced hours cannot be reopened."
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
          {report && canCreate && ["draft", "rejected"].includes(status) && (
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
      <div
        className={`border border-[var(--ks-rule)] px-3 py-2 text-xs ${status === "approved" ? "bg-[var(--ks-green-soft)]" : "bg-[var(--ks-bone)]"}`}
      >
        {status === "approved"
          ? `Posted to time entries and sequences · Approved by ${userName(report?.approvedBy)} ${fmtDateTime(report?.approvedAt)}`
          : "Approval posts crew hours to time entries, equipment cost to the job, and tons / pieces erected to sequences. Draft and submitted reports do not post progress."}
      </div>
      {report?.rejectReason && (
        <div className="border border-[color-mix(in_srgb,var(--ks-red)_35%,var(--ks-rule))] bg-[var(--ks-red-soft)] p-3">
          <div className="label-caps">Returned for correction</div>
          <p className="mt-1 whitespace-pre-wrap">{report.rejectReason}</p>
        </div>
      )}
      {status === "submitted" && data?.canApprove && (
        <div className="flex gap-2">
          <Input
            aria-label="Reason for rejecting report"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={1000}
            placeholder="Reason for returning this report…"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!reason.trim() || busy}
            onClick={() =>
              void perform(
                () =>
                  reject.mutateAsync({ id: report!.id, reason: reason.trim() }),
                "Report returned to foreman."
              )
            }
          >
            Reject with reason
          </Button>
        </div>
      )}
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
            includePassive
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
      {taskQuery.error && <ErrorState error={taskQuery.error} />}
      <ReportLines
        crew={crew}
        equipment={equipment}
        progress={progress}
        tasks={taskQuery.data?.tasks ?? []}
        editable={editable && !busy}
        posted={status === "approved"}
        onCrew={setCrew}
        onEquipment={setEquipment}
        onProgress={setProgress}
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
          <Panel title="Photos & attachments" bodyClassName="p-3">
            <ReportAttachments
              projectId={projectId}
              reportId={report.id}
              canUpload={canUpload}
            />
          </Panel>
          <Panel title="Comments" bodyClassName="p-3">
            <CommentsPanel entityType="dailyReport" entityId={report.id} />
          </Panel>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Save the report to attach field photos and add comments.
        </p>
      )}
    </div>
  );
}
