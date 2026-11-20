import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DateInput,
  NumberInput,
  RecordDrawer,
  SimpleSelect,
} from "@/components/ks/Controls";
import { Field } from "@/components/ks/Layout";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { TASK_KINDS } from "@shared/domain";

export function InlineCell({
  value,
  type = "text",
  label,
  disabled,
  min,
  max,
  onCommit,
}: {
  value: string | number | null;
  type?: "text" | "number" | "date";
  label: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  onCommit: (value: string) => Promise<unknown>;
}) {
  const original = value == null ? "" : String(value);
  const [draft, setDraft] = useState(original);
  const [pending, setPending] = useState(false);
  const cancelled = useRef(false);
  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft === original || disabled) return;
    if (
      type === "number" &&
      (!draft ||
        !Number.isFinite(Number(draft)) ||
        (min != null && Number(draft) < min) ||
        (max != null && Number(draft) > max))
    ) {
      setDraft(original);
      toast.error(`${label} is outside its allowed range.`);
      return;
    }
    if (type === "text" && !draft.trim()) {
      setDraft(original);
      return;
    }
    setPending(true);
    try {
      await onCommit(draft);
    } catch {
      setDraft(original);
    } finally {
      setPending(false);
    }
  }
  return (
    <input
      aria-label={label}
      type={type}
      value={draft}
      min={min}
      max={max}
      step={type === "number" ? "0.1" : undefined}
      disabled={disabled || pending}
      className={`h-7 w-full min-w-16 rounded-[3px] border border-transparent bg-transparent px-1 text-[12px] outline-none hover:border-[var(--ks-rule)] focus:border-[var(--ks-accent)] focus:bg-[var(--ks-paper)] disabled:hover:border-transparent ${type !== "text" ? "num" : ""}`}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(original);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
export type NewTaskTarget = {
  parentId: number | null;
  afterId?: number;
  kind: string;
};
export function CreateTaskDrawer({
  projectId,
  target,
  onClose,
  onCreated,
}: {
  projectId: number;
  target: NewTaskTarget;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(target.kind);
  const [duration, setDuration] = useState(target.kind === "sequence" ? 5 : 1);
  const [location, setLocation] = useState("");
  const [tons, setTons] = useState(0);
  const [pieces, setPieces] = useState(0);
  const [startDate, setStartDate] = useState<string | null>(null);
  const create = trpc.tasks.create.useMutation({
    onSuccess: r => {
      toast.success("Task added.");
      onCreated(r.id);
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      title="Add sequence / task"
      eyebrow={target.parentId ? "WBS / Child task" : "WBS / New task"}
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                projectId,
                parentId: target.parentId,
                afterId: target.afterId,
                name: name.trim(),
                kind,
                durationDays: kind === "milestone" ? 0 : duration,
                startDate,
                ...(kind === "sequence"
                  ? {
                      location: location || null,
                      plannedTons: tons,
                      plannedPieces: pieces,
                    }
                  : {}),
              })
            }
          >
            Add {kind === "sequence" ? "sequence" : kind}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *" className="sm:col-span-2">
          <Input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </Field>
        <Field label="Kind">
          <SimpleSelect
            value={kind}
            onChange={v => v && setKind(v)}
            options={TASK_KINDS}
          />
        </Field>
        <Field label="Duration (work days)">
          <NumberInput
            value={kind === "milestone" ? 0 : duration}
            disabled={kind === "milestone"}
            onChange={v => setDuration(v ?? 1)}
            min={0}
          />
        </Field>
        <Field label="Earliest start">
          <DateInput value={startDate} onChange={setStartDate} />
        </Field>
        {kind === "sequence" && (
          <>
            <Field label="Location / grid / level">
              <Input
                value={location}
                onChange={e => setLocation(e.target.value)}
              />
            </Field>
            <Field label="Planned tons">
              <NumberInput
                value={tons}
                onChange={v => setTons(v ?? 0)}
                step="0.1"
                min={0}
              />
            </Field>
            <Field label="Planned pieces">
              <NumberInput
                value={pieces}
                onChange={v => setPieces(v ?? 0)}
                step={1}
                min={0}
              />
            </Field>
          </>
        )}
      </div>
    </RecordDrawer>
  );
}
