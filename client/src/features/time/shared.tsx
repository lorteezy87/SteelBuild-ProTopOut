import { DateInput, RecordDrawer } from "@/components/brand/Controls";
import { Field } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addDays, fmtDate, weekStart } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export type WeekData = RouterOutputs["time"]["week"];
export type TimeEntry = WeekData["entries"][number];
export const editableState = (state: string) => state === "saved";
export function EntryState({ state }: { state: string }) {
  const tone = state === "recorded" ? "green" : state === "invoiced" ? "blue" : "gray";
  return (
    <Pill tone={tone}>{state.charAt(0).toUpperCase() + state.slice(1)}</Pill>
  );
}
export function WeekPicker({
  value,
  today,
  onChange,
  disabled,
}: {
  value: string;
  today: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous week"
        disabled={disabled}
        onClick={() => onChange(addDays(value, -7))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="w-36">
        <DateInput
          value={value}
          disabled={disabled}
          onChange={day => day && onChange(weekStart(day))}
        />
      </div>
      <span className="num text-xs text-muted-foreground">
        – {fmtDate(addDays(value, 6))}
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label="Next week"
        disabled={disabled}
        onClick={() => onChange(addDays(value, 7))}
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange(weekStart(today))}
      >
        This week
      </Button>
    </div>
  );
}
export function RejectDrawer({
  open,
  count,
  busy,
  onClose,
  onReject,
  maxLength = 500,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
  maxLength?: number;
}) {
  const [reason, setReason] = useState("");
  return (
    <RecordDrawer
      open={open}
      onOpenChange={o => !o && !busy && onClose()}
      title={`Reject ${count} record${count === 1 ? "" : "s"}`}
      eyebrow="Approval decision"
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() => onReject(reason.trim())}
          >
            Reject
          </Button>
        </div>
      }
    >
      <Field label="Reason required">
        <Textarea
          autoFocus
          rows={5}
          maxLength={maxLength}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="State what must be corrected before resubmission."
        />
      </Field>
    </RecordDrawer>
  );
}
export type GridRow = {
  key: string;
  projectId: number;
  taskId: number | null;
  wfItemId: number | null;
  timeCodeId: number | null;
  editable: boolean;
  source: string;
  sourceId: number | null;
  notes: string;
  hours: number[];
  entries: TimeEntry[][];
};
export function gridRows(data: WeekData): GridRow[] {
  const result = new Map<string, GridRow>();
  for (const entry of data.entries) {
    const monthLocked =
      !!data.timeLockedThrough && entry.entryDate <= data.timeLockedThrough;
    const editable =
      entry.source === "timesheet" &&
      editableState(entry.state) &&
      !monthLocked;
    const bucket = editable
      ? "editable"
      : `${entry.source}:${entry.sourceId ?? ""}:${entry.state}:${monthLocked ? "month-locked" : "posted"}`;
    const key = `${entry.projectId}:${entry.taskId ?? ""}:${entry.wfItemId ?? ""}:${entry.timeCodeId ?? ""}:${bucket}`;
    if (!result.has(key))
      result.set(key, {
        key,
        projectId: entry.projectId,
        taskId: entry.taskId,
        wfItemId: entry.wfItemId,
        timeCodeId: entry.timeCodeId,
        editable,
        source: entry.source,
        sourceId: entry.sourceId,
        notes: entry.notes ?? "",
        hours: Array(7).fill(0),
        entries: Array.from({ length: 7 }, () => []),
      });
    const row = result.get(key)!;
    const day = data.days.indexOf(entry.entryDate);
    if (day >= 0) {
      row.hours[day] += entry.hours;
      row.entries[day].push(entry);
    }
  }
  return Array.from(result.values());
}
export const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
