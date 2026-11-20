import {
  ConfirmButton,
  RecordDrawer,
  SimpleSelect,
} from "@/components/brand/Controls";
import { EmptyState, Field, Kpi, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, dow, errMsg, fmtDate, fmtHours } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { LockKeyhole, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  EntryState,
  gridRows,
  sum,
  type GridRow,
  type WeekData,
} from "./shared";

export function TimesheetEditor({
  data,
  start,
  onDirty,
  onBusy,
}: {
  data: WeekData;
  start: string;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [rows, setRows] = useState(() => gridRows(data));
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = trpc.time.saveWeek.useMutation();
  const record = trpc.time.recordWeek.useMutation();
  const lockedDays = data.days.map(
    day => !!data.timeLockedThrough && day <= data.timeLockedThrough
  );
  const allDaysLocked = lockedDays.every(Boolean);
  const lockedUnsubmitted = data.entries.some(
    entry =>
      !!data.timeLockedThrough &&
      entry.entryDate <= data.timeLockedThrough &&
      entry.source === "timesheet" &&
      entry.state === "saved"
  );
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  const totals = data.days.map((_, i) =>
    rows.reduce((n, row) => n + row.hours[i], 0)
  );
  const total = sum(totals),
    capacity = sum(data.capacity);
  const valid =
    rows.filter(row => row.editable).length <= 60 &&
    totals.every(hours => Number.isFinite(hours) && hours <= 24 && hours >= 0);
  const editableHours = rows
    .filter(row => row.editable)
    .reduce((n, row) => n + sum(row.hours), 0);
  function update(next: GridRow[]) {
    setRows(next);
    setDirty(true);
  }
  async function persist(recordWeek: boolean) {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (dirty)
        await save.mutateAsync({
          weekStart: start,
          rows: rows
            .filter(row => row.editable)
            .map(row => ({
              projectId: row.projectId,
              taskId: row.taskId,
              wfItemId: row.wfItemId,
              timeCodeId: row.timeCodeId,
              notes: row.notes || null,
              hours: row.hours,
            })),
        });
      if (recordWeek) await record.mutateAsync({ weekStart: start });
      setDirty(false);
      onDirty(false);
      toast.success(recordWeek ? "Week recorded." : "Hours saved.");
      await Promise.all([
        utils.time.week.invalidate({ weekStart: start }),
        utils.financials.summary.invalidate(),
        utils.projects.get.invalidate(),
        utils.dashboard.portfolio.invalidate(),
      ]);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  function keyboard(
    event: KeyboardEvent<HTMLInputElement>,
    row: number,
    day: number
  ) {
    let nextRow = row,
      nextDay = day;
    if (event.key === "Enter" || (event.key === "ArrowRight" && event.altKey))
      nextDay++;
    else if (event.key === "ArrowLeft" && event.altKey) nextDay--;
    else if (event.key === "ArrowDown" && event.altKey) nextRow++;
    else if (event.key === "ArrowUp" && event.altKey) nextRow--;
    else return;
    event.preventDefault();
    if (nextDay > 6) {
      nextDay = 0;
      nextRow++;
    }
    if (nextDay < 0) {
      nextDay = 6;
      nextRow--;
    }
    const input = document.getElementById(
      `hours-${nextRow}-${nextDay}`
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }
  return (
    <div className="space-y-4 p-6">
      {data.timeLockedThrough && (
        <div
          role="status"
          className="flex items-start gap-2 border border-[var(--tp-rule)] bg-[var(--tp-amber-soft)] p-3 text-xs"
        >
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
          <div>
            Time locked through{" "}
            <span className="num font-semibold">
              {fmtDate(data.timeLockedThrough)}
            </span>
            . Closed-period cells are read-only. Invoicing remains available.
            {lockedUnsubmitted && (
              <div className="mt-1">
                This week contains saved hours in a closed period. Unlock the
                period in Settings before recording the week.
              </div>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Week total"
          value={fmtHours(total)}
          sub={`${fmtDate(start)} – ${fmtDate(addDays(start, 6))}`}
          tone={total > capacity ? "amber" : "gray"}
        />
        <Kpi
          label="Calendar capacity"
          value={fmtHours(capacity)}
          sub="Includes working-day exceptions and holidays"
        />
        <Kpi
          label="Remaining capacity"
          value={fmtHours(capacity - total)}
          tone={total > capacity ? "amber" : "green"}
          sub={dirty ? "Unsaved changes" : "All changes saved"}
        />
      </div>
      <Panel
        title="Weekly entry grid"
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                allDaysLocked ||
                rows.filter(r => r.editable).length >= 60
              }
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" />
              Add row
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty || !valid || busy}
              onClick={() => persist(false)}
            >
              <Save className="size-3.5" />
              Save
            </Button>
            <ConfirmButton
              title="Record this week?"
              body="Saved hours are locked and count as job cost. Recorded hours can be marked invoiced from Financials."
              confirmLabel="Record week"
              variant="default"
              disabled={
                !valid || busy || lockedUnsubmitted || editableHours <= 0
              }
              onConfirm={() => persist(true)}
            >
              <Send className="size-3.5" />
              Record week
            </ConfirmButton>
          </>
        }
      >
        {!valid && (
          <div
            role="alert"
            className="border-b bg-[var(--tp-red-soft)] p-3 text-[var(--tp-red-strong)]"
          >
            Each day must total 24 hours or less. Maximum 60 editable rows.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="tp-table min-w-[1050px]">
            <thead>
              <tr>
                <th className="min-w-64">Job / task / log item</th>
                <th>Time code</th>
                {data.days.map(day => (
                  <th key={day} className="right min-w-24">
                    {dow(day)}
                    <div className="num text-[10px]">{fmtDate(day)}</div>
                    {!!data.timeLockedThrough &&
                      day <= data.timeLockedThrough && (
                        <span className="text-[10px]">Locked</span>
                      )}
                  </th>
                ))}
                <th className="right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const job = data.projects.find(job => job.id === row.projectId);
                const task =
                  data.loggableTasks.find(task => task.id === row.taskId) ??
                  data.tasks.find(task => task.id === row.taskId);
                const item =
                  data.loggableItems.find(item => item.id === row.wfItemId) ??
                  data.items.find(item => item.id === row.wfItemId);
                return (
                  <tr key={row.key}>
                    <td>
                      <div className="font-semibold">
                        {job?.code ? `${job.code} · ` : ""}
                        {job?.name ?? `Job ${row.projectId}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {task
                          ? `${task.wbs} · ${task.name}`
                          : item
                            ? `#${item.number} · ${item.title}`
                            : "Job-level time"}
                      </div>
                      {row.source === "daily_report" ? (
                        <Link
                          className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--tp-blue)]"
                          href={`/jobs/${row.projectId}/daily/${row.sourceId}`}
                        >
                          <LockKeyhole className="size-3" />
                          Daily report · read-only
                        </Link>
                      ) : row.editable ? (
                        <Input
                          className="mt-1 h-6 border-0 bg-transparent px-0 text-xs"
                          aria-label="Row notes"
                          maxLength={500}
                          placeholder="Notes (optional)"
                          disabled={busy}
                          value={row.notes}
                          onChange={e =>
                            update(
                              rows.map(r =>
                                r.key === row.key
                                  ? { ...r, notes: e.target.value }
                                  : r
                              )
                            )
                          }
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Locked
                        </span>
                      )}
                    </td>
                    <td>
                      {data.codes.find(code => code.id === row.timeCodeId)
                        ?.name ?? "Uncoded"}
                    </td>
                    {row.hours.map((hours, di) => (
                      <td
                        key={di}
                        className={`right align-top ${lockedDays[di] ? "bg-[var(--tp-gray-soft)]" : ""}`}
                      >
                        {row.editable && !lockedDays[di] ? (
                          <Input
                            id={`hours-${ri}-${di}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={24}
                            step="0.25"
                            className="num h-8 w-20 text-right"
                            aria-label={`${job?.name ?? "Job"}, ${dow(data.days[di])} hours`}
                            disabled={busy}
                            value={hours || ""}
                            onFocus={e => e.target.select()}
                            onKeyDown={e => keyboard(e, ri, di)}
                            onChange={e => {
                              const value =
                                e.target.value === ""
                                  ? 0
                                  : Number(e.target.value);
                              if (
                                Number.isFinite(value) &&
                                value >= 0 &&
                                value <= 24
                              )
                                update(
                                  rows.map(r =>
                                    r.key === row.key
                                      ? {
                                          ...r,
                                          hours: r.hours.map((h, i) =>
                                            i === di ? value : h
                                          ),
                                        }
                                      : r
                                  )
                                );
                            }}
                          />
                        ) : (
                          <span className="num inline-block py-1.5">
                            {hours ? fmtHours(hours) : "—"}
                          </span>
                        )}
                        <div className="mt-1 flex flex-col items-end gap-1">
                          {Array.from(
                            new Set(row.entries[di].map(entry => entry.state))
                          ).map(state => (
                            <EntryState key={state} state={state} />
                          ))}
                          {row.entries[di]
                            .filter(entry => entry.rejectReason)
                            .map(entry => (
                              <span
                                key={entry.id}
                                className="max-w-24 text-left text-[10px] text-[var(--tp-red-strong)]"
                              >
                                {entry.rejectReason}
                              </span>
                            ))}
                        </div>
                      </td>
                    ))}
                    <td className="right num font-semibold">
                      {fmtHours(sum(row.hours))}
                    </td>
                    <td>
                      {row.editable && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove row"
                          disabled={busy}
                          onClick={() =>
                            update(rows.filter(r => r.key !== row.key))
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-[var(--tp-bone)]">
                <td colSpan={2} className="font-semibold">
                  Day totals / capacity
                </td>
                {totals.map((hours, i) => (
                  <td key={i} className="right num">
                    <div
                      className={
                        hours > 24 ? "text-[var(--tp-red-strong)]" : ""
                      }
                    >
                      {fmtHours(hours)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      / {fmtHours(data.capacity[i])}
                    </div>
                  </td>
                ))}
                <td className="right num font-semibold">{fmtHours(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="No hours in this week."
            body="Add a job, task or log item, then enter daily ST or OT hours."
          />
        )}
      </Panel>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Pill>Entry</Pill>Tab moves between cells. Enter moves to the next day.
        Alt + arrow keys move through the grid. Field-report hours are already
        posted; do not enter them again.
      </div>
      {adding && (
        <AddTimeRow
          data={data}
          onClose={() => setAdding(false)}
          onAdd={row => {
            const existing = rows.find(
              r =>
                r.editable &&
                r.projectId === row.projectId &&
                r.taskId === row.taskId &&
                r.wfItemId === row.wfItemId &&
                r.timeCodeId === row.timeCodeId
            );
            if (existing) {
              toast.info("This row already exists.");
              return;
            }
            update([...rows, row]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
function AddTimeRow({
  data,
  onAdd,
  onClose,
}: {
  data: WeekData;
  onAdd: (row: GridRow) => void;
  onClose: () => void;
}) {
  const [project, setProject] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>("job");
  const [code, setCode] = useState<string | null>(
    data.codes[0] ? String(data.codes[0].id) : null
  );
  const tasks = data.loggableTasks.filter(
    task => task.projectId === Number(project)
  );
  const items = data.loggableItems.filter(
    item => item.projectId === Number(project)
  );
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      title="Add timesheet row"
      eyebrow="Loggable work"
      width={520}
      footer={
        <Button
          disabled={!project || !target}
          onClick={() =>
            onAdd({
              key: `new:${crypto.randomUUID()}`,
              projectId: Number(project),
              taskId: target?.startsWith("task:")
                ? Number(target.slice(5))
                : null,
              wfItemId: target?.startsWith("item:")
                ? Number(target.slice(5))
                : null,
              timeCodeId: code ? Number(code) : null,
              editable: true,
              source: "timesheet",
              sourceId: null,
              notes: "",
              hours: Array(7).fill(0),
              entries: Array.from({ length: 7 }, () => []),
            })
          }
        >
          Add row
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Job">
          <SimpleSelect
            value={project}
            onChange={value => {
              setProject(value);
              setTarget("job");
            }}
            options={data.projects.map(job => ({
              value: String(job.id),
              label: `${job.code ?? ""} · ${job.name}`,
            }))}
          />
        </Field>
        <Field label="Task or log item">
          <SimpleSelect
            value={target}
            onChange={setTarget}
            disabled={!project}
            options={[
              { value: "job", label: "Job-level time" },
              ...tasks.map(task => ({
                value: `task:${task.id}`,
                label: `${task.wbs} · ${task.name}`,
              })),
              ...items.map(item => ({
                value: `item:${item.id}`,
                label: `${item.prefix}-${String(item.number).padStart(3, "0")} · ${item.title}`,
              })),
            ]}
          />
        </Field>
        <Field label="Time code">
          <SimpleSelect
            value={code}
            onChange={setCode}
            allowNone
            options={data.codes.map(code => ({
              value: String(code.id),
              label: `${code.name} · ${code.multiplier}×`,
            }))}
          />
        </Field>
      </div>
    </RecordDrawer>
  );
}
