import { SimpleSelect } from "@/components/brand/Controls";
import {
  PriorityBadge,
  ProgressBar,
  ScheduleHealth,
} from "@/components/brand/Status";
import { fmtDate, fmtTons } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { cn } from "@/lib/utils";
import { TASK_KINDS, TASK_STATUSES } from "@shared/domain";
import { CalendarDays, GripVertical, Users } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

export type BoardTask = RouterOutputs["tasks"]["list"]["tasks"][number];
export type TaskStatus = keyof typeof TASK_STATUSES;
export const BOARD_DRAG_TYPE = "application/x-steelbuild-task";

export function TaskCard({
  task,
  editable,
  pending,
  dragging,
  selected,
  showPriority,
  onOpen,
  onStatus,
  onDragStart,
  onDragEnd,
  assign,
}: {
  /** Optional click-to-assign control that replaces the read-only crew line. */
  assign?: ReactNode;
  task: BoardTask;
  editable: boolean;
  pending: boolean;
  dragging: boolean;
  selected: boolean;
  showPriority: boolean;
  onOpen: () => void;
  onStatus: (status: TaskStatus) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const { userName, jobRoleName, equipmentName } = useRefData();
  const assignees = task.assignments.map(a =>
    a.userId
      ? userName(a.userId)
      : a.jobRoleId
        ? jobRoleName(a.jobRoleId)
        : equipmentName(a.equipmentId)
  );
  return (
    <article
      draggable={editable && !pending}
      onClick={event => {
        if (
          !(event.target as HTMLElement).closest(
            "button, input, select, [role='combobox'], [role='listbox']"
          )
        )
          onOpen();
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "relative rounded-[3px] border border-[var(--tp-rule)] bg-[var(--tp-paper)] p-3",
        selected && "border-[var(--tp-accent)]",
        dragging && "opacity-40",
        pending && "opacity-60"
      )}
      style={{
        borderLeftWidth: 3,
        borderLeftColor:
          task.kind === "sequence"
            ? "var(--tp-accent)"
            : "var(--tp-graphite-3)",
      }}
      aria-busy={pending}
      data-board-task={task.id}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
        <span className="num">{task.wbs || "—"}</span>
        <span className="ml-auto">
          {TASK_KINDS[task.kind as keyof typeof TASK_KINDS] ?? task.kind}
        </span>
        {editable && <GripVertical className="size-3.5" aria-hidden />}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mb-2 w-full text-left text-[13px] font-semibold leading-snug hover:text-[var(--tp-accent-ink)] focus-visible:outline-2 focus-visible:outline-[var(--tp-accent)]"
      >
        {task.name}
      </button>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ScheduleHealth value={task.scheduleHealth} />
        {showPriority && <PriorityBadge value={task.priority} />}
      </div>
      {assign ? (
        <div
          className="mb-1 flex items-center gap-1 text-[11.5px] text-muted-foreground"
          draggable={false}
          onDragStart={event => event.preventDefault()}
        >
          <Users className="size-3 shrink-0" />
          <div className="min-w-0 flex-1">{assign}</div>
        </div>
      ) : (
        <div
          className="mb-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
          title={assignees.join(", ")}
        >
          <Users className="size-3 shrink-0" />{" "}
          <span className="truncate">
            {assignees.length ? assignees.join(", ") : "Unassigned"}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11.5px]">
        <CalendarDays className="size-3 text-muted-foreground" />{" "}
        <span className="num">{fmtDate(task.finishDate)}</span>
        {task.kind === "sequence" && (
          <span
            className="num ml-auto text-[var(--tp-accent-ink)]"
            title="Erected / planned tons"
          >
            {fmtTons(task.erectedTons)} / {fmtTons(task.plannedTons)}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <ProgressBar
          value={task.percentComplete}
          tone={task.kind === "sequence" ? "orange" : "ink"}
        />
        <span className="num text-[10.5px] text-muted-foreground">
          {Math.round(task.percentComplete)}%
        </span>
      </div>
      {editable && (
        <div className="mt-2" title="Change status without dragging">
          <SimpleSelect
            value={task.status}
            options={TASK_STATUSES}
            size="sm"
            className="h-7 text-[11.5px]"
            disabled={pending}
            onChange={value => value && onStatus(value as TaskStatus)}
          />
        </div>
      )}
    </article>
  );
}
