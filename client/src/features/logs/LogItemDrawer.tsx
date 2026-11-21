import { isBallInCourt } from "@shared/ballInCourt";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  ConfirmButton,
  DateInput,
  NumberInput,
  RecordDrawer,
} from "@/components/brand/Controls";
import { ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { RecordPhotos } from "@/features/photos/RecordPhotos";
import { DelayWeather } from "@/features/weather/DelayWeather";
import { SlaBadge, StateChip } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMsg, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { LogFields } from "./LogFields";
import { useLogsInvalidate, type LogDetail, type LogDraft } from "./model";

export function LogItemDrawer({
  id,
  appKey,
  projectId,
  onClose,
}: {
  id: number;
  appKey: string;
  projectId?: number;
  onClose: () => void;
}) {
  const q = trpc.wf.get.useQuery({ id });
  const mismatch =
    q.data &&
    (q.data.app.key !== appKey ||
      (projectId !== undefined && q.data.item.projectId !== projectId));
  return (
    <RecordDrawer
      open
      width={760}
      eyebrow={q.data?.item.label ?? "Workflow log"}
      title={q.data?.item.title ?? "Loading item…"}
      onOpenChange={open => !open && onClose()}
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : mismatch ? (
        <ErrorState
          error={{
            message: "This item does not belong to the selected log / job.",
          }}
        />
      ) : (
        q.data && (
          <ItemDetails
            key={`${q.data.item.id}-${q.data.item.updatedAt.toISOString()}`}
            data={q.data}
            onClose={onClose}
          />
        )
      )}
    </RecordDrawer>
  );
}

function ItemDetails({
  data,
  onClose,
}: {
  data: LogDetail;
  onClose: () => void;
}) {
  const { item, app, states } = data;
  const state = states.find(s => s.id === item.stateId);
  const { userName } = useRefData();
  const [, navigate] = useLocation();
  const invalidate = useLogsInvalidate();
  const [draft, setDraft] = useState<LogDraft>({
    title: item.title,
    description: item.description,
    priority: item.priority,
    assigneeId: item.assigneeId,
    responsibleParty: item.responsibleParty,
    ballInCourt: isBallInCourt(item.ballInCourt) ? item.ballInCourt : "us",
    dueDate: item.dueDate,
    linkedTaskId: item.linkedTaskId,
    linkedDeliveryId: item.linkedDeliveryId,
    customFields: data.customFields,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transitionComment, setTransitionComment] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [conversion, setConversion] = useState({
    code: "",
    name: item.title,
    startDate: null as string | null,
    deadline: null as string | null,
    sequenceCount: 4,
  });
  const update = trpc.wf.update.useMutation();
  const transition = trpc.wf.transition.useMutation();
  const remove = trpc.wf.remove.useMutation();
  const convert = trpc.wf.convertBid.useMutation();
  const saveIfDirty = async () => {
    if (!dirty) return;
    if (!draft.title.trim()) throw new Error("Enter a title.");
    await update.mutateAsync({ id: item.id, ...draft });
    setDirty(false);
  };
  const perform = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      await invalidate(item.projectId);
      toast.success(message);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  const policy =
    data.policies.find(
      p => p.stateId === item.stateId && p.priority === item.priority
    ) ?? data.policies.find(p => p.stateId === item.stateId && !p.priority);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StateChip
          name={state?.name ?? "Unknown state"}
          color={state?.color}
          category={state?.category}
        />
        {item.slaDueAt && <SlaBadge value={item.slaStatus} />}
        <div className="ml-auto">
        </div>
      </div>
      {data.project && (
        <Link
          href={`/jobs/${data.project.id}/logs/${app.key}/${item.id}`}
          className="block text-xs text-[var(--tp-accent-ink)]"
        >
          {data.project.code} · {data.project.name}
        </Link>
      )}
      <div className="grid gap-3 border-y border-[var(--tp-rule)] py-3 sm:grid-cols-3">
        <Field label="Requestor">{userName(item.requestorId)}</Field>
        <Field label="Created">{fmtDateTime(item.createdAt)}</Field>
        <Field label="State entered">{fmtDateTime(item.stateEnteredAt)}</Field>
        <Field label="Schedule impact">
          <span className="num">{fmtNum(item.scheduleImpactDays)} days</span>
        </Field>
        {data.canFinancials && (
          <Field label="Cost impact">
            <span className="num">{fmtMoney(item.costImpact)}</span>
          </Field>
        )}
        {item.score !== null && (
          <Field label="Weighted score">
            <span className="num">{fmtNum(item.score, 1)}</span>
          </Field>
        )}
      </div>
      <LogFields
        draft={draft}
        onChange={next => {
          setDraft(next);
          setDirty(true);
        }}
        defs={data.fieldDefs}
        projectId={item.projectId}
        editable={data.canEdit && !busy}
        dueDateLabel={app.dueDateLabel}
      />
      {data.canEdit && (
        <div className="flex items-center justify-between gap-2">
          <ConfirmButton
            title={`Delete ${item.label}?`}
            body="This deletes the workflow record and state history."
            destructive
            disabled={busy}
            onConfirm={() =>
              void perform(async () => {
                await remove.mutateAsync({ id: item.id });
                onClose();
              }, "Log item deleted.")
            }
          >
            Delete
          </ConfirmButton>
          <Button
            size="sm"
            disabled={!dirty || !draft.title.trim() || busy}
            onClick={() => void perform(saveIfDirty, "Log item saved.")}
          >
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      )}
      {data.canTransition && data.availableTransitions.length > 0 && (
        <Panel title="Available workflow actions" bodyClassName="space-y-3 p-3">
          <Input
            aria-label="Workflow action comment"
            maxLength={5000}
            placeholder="Action note (optional)…"
            value={transitionComment}
            onChange={e => setTransitionComment(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {data.availableTransitions.map(t => (
              <Button
                key={t.id}
                variant="outline"
                size="sm"
                disabled={busy || !draft.title.trim()}
                onClick={() =>
                  void perform(async () => {
                    await saveIfDirty();
                    await transition.mutateAsync({
                      id: item.id,
                      transitionId: t.id,
                      comment: transitionComment || null,
                    });
                    setTransitionComment("");
                  }, `${item.label} · ${t.name}.`)
                }
              >
                {t.name}
              </Button>
            ))}
          </div>
          {dirty && (
            <p className="text-xs text-muted-foreground">
              Changes will be saved before the workflow action.
            </p>
          )}
        </Panel>
      )}
      {data.canConvert && (
        <Panel title="Awarded bid → job" bodyClassName="space-y-3 p-3">
          {!convertOpen ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => setConvertOpen(true)}
            >
              Convert to Job
            </Button>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Creates a draft erection job with this bid's GC, location, tons,
                value and margin-based budget. Closes this bid as Converted.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Job number (optional)">
                  <Input
                    value={conversion.code}
                    maxLength={32}
                    onChange={e =>
                      setConversion(c => ({ ...c, code: e.target.value }))
                    }
                    placeholder="Auto-number if blank"
                  />
                </Field>
                <Field label="Job name">
                  <Input
                    value={conversion.name}
                    maxLength={255}
                    onChange={e =>
                      setConversion(c => ({ ...c, name: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Start">
                  <DateInput
                    value={conversion.startDate}
                    onChange={v => setConversion(c => ({ ...c, startDate: v }))}
                  />
                </Field>
                <Field label="Deadline">
                  <DateInput
                    value={conversion.deadline}
                    onChange={v => setConversion(c => ({ ...c, deadline: v }))}
                  />
                </Field>
                <Field label="Erection sequences (1–40)">
                  <NumberInput
                    value={conversion.sequenceCount}
                    min={1}
                    step={1}
                    onChange={v =>
                      setConversion(c => ({ ...c, sequenceCount: v ?? 4 }))
                    }
                  />
                </Field>
              </div>
              <ConfirmButton
                title="Create a job from this awarded bid?"
                confirmLabel="Convert to job"
                disabled={
                  busy ||
                  !conversion.name.trim() ||
                  conversion.sequenceCount < 1 ||
                  conversion.sequenceCount > 40
                }
                onConfirm={() =>
                  void perform(async () => {
                    await saveIfDirty();
                    const result = await convert.mutateAsync({
                      ...conversion,
                      code: conversion.code || null,
                      id: item.id,
                    });
                    navigate(`/jobs/${result.projectId}`);
                  }, "Bid converted to job.")
                }
              >
                Create job & close bid
              </ConfirmButton>
            </>
          )}
        </Panel>
      )}
      <Panel title="SLA clock" bodyClassName="p-3">
        {item.slaDueAt ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deadline">
              <span className="num">{fmtDateTime(item.slaDueAt)}</span>
            </Field>
            <Field label="At risk from">
              <span className="num">{fmtDateTime(item.slaAtRiskAt)}</span>
            </Field>
            <Field label="Status">
              <SlaBadge value={item.slaStatus} />
            </Field>
            <Field label="Policy">
              {policy?.source === "project_notice"
                ? `Contract notice · ${data.project?.noticeHours ?? 72} hours from creation`
                : policy?.source === "due_date"
                  ? `${app.dueDateLabel} · end of day`
                  : `${policy?.hours ?? "—"} hours in state`}
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              At risk at {policy?.atRiskPct ?? 75}% of the notice window.{" "}
              {policy?.action === "transition"
                ? "Automatic transition on timeout."
                : "Marked Delayed on timeout."}{" "}
              Clock checked by the server every 5 minutes.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {state?.category === "end"
              ? "Closed state. SLA clock stopped."
              : "No active SLA deadline in this state. Set the required response date when the policy uses due date."}
          </p>
        )}
      </Panel>
      {(data.linkedTask || data.linkedDelivery) && (
        <Panel title="Linked field records" bodyClassName="space-y-2 p-3">
          {data.linkedTask && (
            <Link
              className="block text-[var(--tp-accent-ink)] underline"
              href={`/jobs/${item.projectId}/tasks?task=${data.linkedTask.id}`}
            >
              {data.linkedTask.wbs} · {data.linkedTask.name}
            </Link>
          )}
          {data.linkedDelivery && (
            <Link
              className="block text-[var(--tp-accent-ink)] underline"
              href={`/jobs/${item.projectId}/deliveries/${data.linkedDelivery.id}`}
            >
              Fabricator load {data.linkedDelivery.loadNumber} · Ticket{" "}
              {data.linkedDelivery.ticketNumber ?? "—"}
            </Link>
          )}
        </Panel>
      )}
      {item.projectId != null && app.key === "delay" && (
        <DelayWeather projectId={item.projectId} eventDate={typeof draft.customFields?.event_date === "string" ? draft.customFields.event_date : null} />
      )}
      {item.projectId != null && (
        <Panel title="Photos" bodyClassName="p-3">
          <RecordPhotos projectId={item.projectId} entityType="logItem" entityId={item.id} canUpload />
        </Panel>
      )}
      <Panel title="Workflow history" bodyClassName="p-3">
        <ol className="space-y-3">
          {data.events.map(({ ev, userName: name }) => (
            <li key={ev.id} className="border-l-2 border-[var(--tp-rule)] pl-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="num text-muted-foreground">
                  {fmtDateTime(ev.createdAt)}
                </span>
                <span className="font-medium">
                  {ev.isAuto ? "Automatic SLA action" : (name ?? "System")}
                </span>
                <span>
                  {ev.fromStateId
                    ? `${states.find(s => s.id === ev.fromStateId)?.name ?? "—"} → `
                    : "Created → "}
                  {states.find(s => s.id === ev.toStateId)?.name ?? "—"}
                </span>
              </div>
              {ev.comment && (
                <p className="mt-1 whitespace-pre-wrap">{ev.comment}</p>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
