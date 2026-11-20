import { useState } from "react";
import { toast } from "sonner";
import {
  CompanySelect,
  ConfirmButton,
  DateInput,
  NumberInput,
  RecordDrawer,
  SimpleSelect,
} from "@/components/ks/Controls";
import { Field } from "@/components/ks/Layout";
import { DeliveryRiskBadge } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errMsg } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { DELIVERY_STATUSES } from "@shared/domain";

type Load = RouterOutputs["deliveries"]["list"][number];
type Draft = {
  loadNumber: string;
  sequenceTaskId: number | null;
  fabricatorCompanyId: number | null;
  needDate: string | null;
  promisedDate: string | null;
  shippedDate: string | null;
  receivedDate: string | null;
  tons: number;
  pieces: number;
  ticketNumber: string;
  status: string;
  description: string;
  shortageNotes: string;
};

export function DeliveryDrawer({
  projectId,
  load,
  editable,
  onClose,
  onChanged,
}: {
  projectId: number;
  load: Load | null;
  editable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const tasks = trpc.tasks.list.useQuery({ projectId });
  const [draft, setDraft] = useState<Draft>({
    loadNumber: load?.loadNumber ?? "",
    sequenceTaskId: load?.sequenceTaskId ?? null,
    fabricatorCompanyId: load?.fabricatorCompanyId ?? null,
    needDate: load?.needDate ?? null,
    promisedDate: load?.promisedDate ?? null,
    shippedDate: load?.shippedDate ?? null,
    receivedDate: load?.receivedDate ?? null,
    tons: load?.tons ?? 0,
    pieces: load?.pieces ?? 0,
    ticketNumber: load?.ticketNumber ?? "",
    status: load?.status ?? "scheduled",
    description: load?.description ?? "",
    shortageNotes: load?.shortageNotes ?? "",
  });
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(d => ({ ...d, [key]: value }));
  const save = trpc.deliveries.upsert.useMutation({
    onSuccess: () => {
      toast.success("Load saved.");
      onChanged();
      onClose();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.deliveries.remove.useMutation({
    onSuccess: () => {
      toast.success("Load deleted.");
      onChanged();
      onClose();
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <RecordDrawer
      open
      onOpenChange={open => !open && onClose()}
      eyebrow="Fabricator load"
      title={load ? `Load ${load.loadNumber}` : "New load"}
      actions={load && <DeliveryRiskBadge value={load.risk} />}
      footer={
        editable && (
          <div className="flex items-center justify-between gap-2">
            {load ? (
              <ConfirmButton
                title="Delete this load?"
                destructive
                onConfirm={() => remove.mutate({ id: load.id })}
                disabled={remove.isPending}
              >
                Delete
              </ConfirmButton>
            ) : (
              <span />
            )}
            <Button
              disabled={!draft.loadNumber.trim() || save.isPending}
              onClick={() => save.mutate({ ...draft, projectId, id: load?.id })}
            >
              Save load
            </Button>
          </div>
        )
      }
    >
      <fieldset
        disabled={!editable || save.isPending}
        className="space-y-4 disabled:opacity-80"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Load #">
            <Input
              value={draft.loadNumber}
              maxLength={32}
              onChange={e => change("loadNumber", e.target.value)}
            />
          </Field>
          <Field label="Erection sequence">
            <SimpleSelect
              value={draft.sequenceTaskId ? String(draft.sequenceTaskId) : null}
              allowNone
              onChange={v => change("sequenceTaskId", v ? Number(v) : null)}
              options={(tasks.data?.tasks ?? [])
                .filter(t => t.kind === "sequence")
                .map(t => ({
                  value: String(t.id),
                  label: `${t.wbs} · ${t.name}`,
                }))}
            />
          </Field>
          <Field label="Fabricator">
            <CompanySelect
              type="fabricator"
              value={draft.fabricatorCompanyId}
              onChange={v => change("fabricatorCompanyId", v)}
            />
          </Field>
          <Field label="Status">
            <SimpleSelect
              value={draft.status}
              onChange={v => v && change("status", v)}
              options={DELIVERY_STATUSES}
            />
          </Field>
          <Field label="Need on site">
            <DateInput
              value={draft.needDate}
              onChange={v => change("needDate", v)}
            />
            {!load && (
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank for sequence start minus 2 work days.
              </p>
            )}
          </Field>
          <Field label="Promised">
            <DateInput
              value={draft.promisedDate}
              onChange={v => change("promisedDate", v)}
            />
          </Field>
          <Field label="Shipped">
            <DateInput
              value={draft.shippedDate}
              onChange={v => change("shippedDate", v)}
            />
          </Field>
          <Field label="Received">
            <DateInput
              value={draft.receivedDate}
              onChange={v => change("receivedDate", v)}
            />
          </Field>
          <Field label="Tons">
            <NumberInput
              min={0}
              step="0.01"
              value={draft.tons}
              onChange={v => change("tons", v ?? 0)}
            />
          </Field>
          <Field label="Pieces">
            <NumberInput
              min={0}
              step={1}
              value={draft.pieces}
              onChange={v => change("pieces", v ?? 0)}
            />
          </Field>
          <Field label="Delivery ticket #">
            <Input
              value={draft.ticketNumber}
              maxLength={64}
              onChange={e => change("ticketNumber", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            value={draft.description}
            maxLength={500}
            onChange={e => change("description", e.target.value)}
          />
        </Field>
        <Field label="Shortage / damage / field notes">
          <Textarea
            rows={4}
            value={draft.shortageNotes}
            maxLength={5000}
            onChange={e => change("shortageNotes", e.target.value)}
          />
        </Field>
      </fieldset>
    </RecordDrawer>
  );
}
