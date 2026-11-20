import { BALL_IN_COURT_LABELS, type BallInCourt } from "@shared/ballInCourt";
import { CfDisplay, CfForm, type CfDef } from "@/components/brand/CustomFields";
import { DateInput, SimpleSelect, UserSelect } from "@/components/brand/Controls";
import { ErrorState, Field } from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { PRIORITIES, RESPONSIBLE_PARTIES } from "@shared/domain";
import type { LogDraft } from "./model";

export function LogFields({
  draft,
  onChange,
  defs,
  projectId,
  editable,
  dueDateLabel,
}: {
  draft: LogDraft;
  onChange: (draft: LogDraft) => void;
  defs: CfDef[];
  projectId: number | null;
  editable: boolean;
  dueDateLabel: string;
}) {
  const { ref, isAdmin } = useRefData();
  const moduleAccess = isAdmin || ["full", "team_member"].includes(ref?.me.accessType ?? "");
  const tasks = trpc.tasks.list.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: !!projectId && editable && moduleAccess }
  );
  const deliveries = trpc.deliveries.list.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: !!projectId && editable && moduleAccess }
  );
  const set = <K extends keyof LogDraft>(key: K, value: LogDraft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <div className="space-y-4">
      <fieldset disabled={!editable} className="space-y-3">
        <Field label="Title">
          <Input
            value={draft.title}
            maxLength={255}
            onChange={e => set("title", e.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            rows={3}
            value={draft.description ?? ""}
            maxLength={20000}
            onChange={e => set("description", e.target.value || null)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority">
            <SimpleSelect
              value={draft.priority}
              onChange={v => v && set("priority", v)}
              options={PRIORITIES}
            />
          </Field>
          <Field label="Assignee">
            <UserSelect
              value={draft.assigneeId}
              onChange={v => set("assigneeId", v)}
            />
          </Field>
          <Field label="Ball in court">
            <SimpleSelect
              value={draft.ballInCourt}
              onChange={v => v && set("ballInCourt", v as BallInCourt)}
              options={BALL_IN_COURT_LABELS}
            />
          </Field>
          <Field label="Responsible party">
            <SimpleSelect
              value={draft.responsibleParty}
              allowNone
              onChange={v => set("responsibleParty", v)}
              options={RESPONSIBLE_PARTIES}
            />
          </Field>
          <Field label={dueDateLabel}>
            <DateInput
              value={draft.dueDate}
              onChange={v => set("dueDate", v)}
            />
          </Field>
          {projectId && editable && moduleAccess && (
            <>
              <Field label="Linked task / erection sequence">
                <SimpleSelect
                  value={draft.linkedTaskId ? String(draft.linkedTaskId) : null}
                  allowNone
                  onChange={v => set("linkedTaskId", v ? Number(v) : null)}
                  options={(tasks.data?.tasks ?? []).map(t => ({
                    value: String(t.id),
                    label: `${t.wbs} · ${t.name}`,
                  }))}
                />
                {tasks.error && <ErrorState error={tasks.error} />}
              </Field>
              <Field label="Linked fabricator load">
                <SimpleSelect
                  value={
                    draft.linkedDeliveryId
                      ? String(draft.linkedDeliveryId)
                      : null
                  }
                  allowNone
                  onChange={v => set("linkedDeliveryId", v ? Number(v) : null)}
                  options={(deliveries.data ?? []).map(d => ({
                    value: String(d.id),
                    label: `Load ${d.loadNumber}${d.sequence ? ` · ${d.sequence.name}` : ""}`,
                  }))}
                />
                {deliveries.error && <ErrorState error={deliveries.error} />}
              </Field>
            </>
          )}
        </div>
      </fieldset>
      <div className="border-t border-[var(--tp-rule)] pt-4">
        <div className="label-caps mb-3">Log fields</div>
        {editable ? (
          <CfForm
            defs={defs}
            values={draft.customFields}
            onChange={v => set("customFields", v)}
          />
        ) : (
          <CfDisplay defs={defs} values={draft.customFields} />
        )}
        {defs.some(d => d.fieldType === "formula") && (
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              Calculated fields · computed on save
            </summary>
            <div className="mt-2 space-y-1">
              {defs
                .filter(d => d.fieldType === "formula")
                .map(d => (
                  <div key={d.key}>
                    <span className="font-medium">{d.label}: </span>
                    <code>{d.formula}</code>
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>
      {editable && (
        <p className="text-xs text-muted-foreground">
          Save changes before leaving the record. Required fields must be filled
          before leaving the initial workflow state.
        </p>
      )}
    </div>
  );
}
