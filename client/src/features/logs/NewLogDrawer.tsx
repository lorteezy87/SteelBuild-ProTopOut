import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RecordDrawer, SimpleSelect } from "@/components/ks/Controls";
import { ErrorState, Field, Loading } from "@/components/ks/Layout";
import { Button } from "@/components/ui/button";
import { errMsg } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { LogFields } from "./LogFields";
import { newLogDraft, useLogsInvalidate } from "./model";

export function NewLogDrawer({
  appKey,
  projectId,
  onClose,
  onCreated,
}: {
  appKey: string;
  projectId?: number;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { canGlobal } = useRefData();
  const app = trpc.wf.app.useQuery({ key: appKey });
  const jobs = trpc.wf.creationJobs.useQuery(undefined, {
    enabled: !projectId && appKey !== "bid",
  });
  const [chosenJob, setChosenJob] = useState<number | null>(projectId ?? null);
  const [draft, setDraft] = useState(newLogDraft);
  const job = trpc.projects.get.useQuery(
    { id: chosenJob ?? 0 },
    { enabled: !!chosenJob }
  );
  const global = app.data?.app.scope === "global";
  const canCreate = global
    ? canGlobal("bid.manage")
    : !!job.data?.privileges.includes("log.create");
  const canFinancial = global
    ? canGlobal("bid.manage")
    : !!job.data?.canFinancials;
  const defs = (app.data?.fieldDefs ?? []).filter(
    d => !d.isFinancial || canFinancial
  );
  const invalidate = useLogsInvalidate();
  const create = trpc.wf.create.useMutation({
    onSuccess: async r => {
      await invalidate(chosenJob);
      toast.success(`${r.label} created.`);
      onCreated(r.id);
    },
    onError: e => toast.error(errMsg(e)),
  });
  useEffect(() => {
    if (!projectId && !chosenJob && jobs.data?.length)
      setChosenJob(jobs.data[0].id);
  }, [jobs.data, projectId, chosenJob]);
  const missing = defs.filter(
    d =>
      d.required &&
      d.fieldType !== "formula" &&
      (draft.customFields[d.key] == null || draft.customFields[d.key] === "")
  );
  return (
    <RecordDrawer
      open
      onOpenChange={open => !open && onClose()}
      eyebrow="Workflow log"
      title={`New ${app.data?.app.name ?? appKey}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              !canCreate ||
              !draft.title.trim() ||
              create.isPending ||
              missing.length > 0
            }
            onClick={() =>
              create.mutate({
                ...draft,
                appKey,
                projectId: global ? null : chosenJob,
              })
            }
          >
            Create {app.data?.app.name ?? "item"}
          </Button>
        </div>
      }
    >
      {app.isLoading ? (
        <Loading />
      ) : app.error ? (
        <ErrorState error={app.error} />
      ) : (
        <div className="space-y-4">
          {!projectId && !global && (
            <Field label="Job">
              <SimpleSelect
                value={chosenJob ? String(chosenJob) : null}
                onChange={v => {
                  setChosenJob(v ? Number(v) : null);
                  setDraft(d => ({
                    ...d,
                    linkedTaskId: null,
                    linkedDeliveryId: null,
                  }));
                }}
                options={(jobs.data ?? []).map(p => ({
                  value: String(p.id),
                  label: `${p.code} · ${p.name}`,
                }))}
              />
              {jobs.error && <ErrorState error={jobs.error} />}
            </Field>
          )}
          {job.error && <ErrorState error={job.error} />}
          {!canCreate && !job.isLoading && (
            <p className="border border-[var(--ks-rule)] bg-[var(--ks-bone)] p-3 text-muted-foreground">
              Choose a job where you have log creation privileges.
            </p>
          )}
          {app.data?.app.description && (
            <p className="text-xs text-muted-foreground">
              {app.data.app.description}
            </p>
          )}
          <LogFields
            draft={draft}
            onChange={setDraft}
            defs={defs}
            editable={canCreate && !create.isPending}
            projectId={global ? null : chosenJob}
            dueDateLabel={app.data?.app.dueDateLabel ?? "Due date"}
          />
          {!!missing.length && (
            <p className="text-xs text-muted-foreground">
              Required: {missing.map(d => d.label).join(", ")}.
            </p>
          )}
        </div>
      )}
    </RecordDrawer>
  );
}
