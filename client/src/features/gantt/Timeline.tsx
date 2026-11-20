import { addDays, diffDays, fmtDate, fmtTons, parseDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useId, useMemo, type PointerEvent, type RefObject } from "react";
import {
  barGeometry,
  dependencyPath,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  rulerSegments,
  type Dependency,
  type GanttTask,
  type TaskList,
  type TaskRow,
  type Zoom,
} from "./model";

export type GestureMode = "move" | "resize" | "link";
export type DragPreview = {
  taskId: number;
  mode: GestureMode;
  start: string;
  finish: string;
  duration: number;
  x: number;
  y: number;
  targetId: number | null;
  changed: boolean;
  /** Summary drag: per-task previewed dates (work-calendar shift; started tasks unchanged). */
  shift?: { dates: Map<number, { start: string; finish: string }>; workDays: number };
};
export type TimelineProps = {
  rows: TaskRow[];
  dependencies: Dependency[];
  external: TaskList["external"];
  baseline: TaskList["baseline"];
  first: string;
  days: number;
  dayWidth: number;
  today: string;
  zoom: Zoom;
  visibleDayStart: number;
  visibleDayEnd: number;
  startIndex: number;
  endIndex: number;
  selectedId: number | null;
  selectedDependency: number | null;
  critical: boolean;
  showBaseline: boolean;
  editable: boolean;
  busy: boolean;
  preview: DragPreview | null;
  bodyRef: RefObject<HTMLDivElement | null>;
  onOpen: (id: number) => void;
  onSelectDependency: (id: number) => void;
  onBegin: (
    event: PointerEvent<HTMLElement>,
    task: GanttTask,
    mode: GestureMode
  ) => void;
  onMove: (event: PointerEvent<HTMLElement>) => void;
  onEnd: (event: PointerEvent<HTMLElement>) => void;
  onCancel: () => void;
};

export function TimelineRuler({
  first,
  days,
  dayWidth,
  zoom,
  visibleDayStart,
  visibleDayEnd,
  today,
}: Pick<
  TimelineProps,
  | "first"
  | "days"
  | "dayWidth"
  | "zoom"
  | "visibleDayStart"
  | "visibleDayEnd"
  | "today"
>) {
  const segments = rulerSegments(
    first,
    days,
    zoom,
    visibleDayStart,
    visibleDayEnd
  );
  const todayX = (diffDays(first, today) + 0.5) * dayWidth;
  return (
    <div
      className="ruler-ticks relative shrink-0 border-b border-[var(--tp-rule)] bg-[var(--tp-rule-soft)]"
      style={{
        width: days * dayWidth,
        height: HEADER_HEIGHT,
        backgroundSize: `${dayWidth}px 10px`,
        backgroundRepeat: "repeat-x",
        backgroundPosition: "left bottom",
      }}
    >
      {segments.map(segment => (
        <div
          key={segment.index}
          className="absolute inset-y-0 border-l border-[var(--tp-rule)] px-1.5 pt-1.5"
          style={{
            left: segment.index * dayWidth,
            width: segment.length * dayWidth,
          }}
        >
          {zoom === "day" && (
            <div className="text-[9px] text-muted-foreground">
              {parseDay(segment.day).toLocaleDateString("en-US", {
                weekday: "short",
                timeZone: "UTC",
              })}
            </div>
          )}
          <div
            className="num truncate text-[11px]"
            title={fmtDate(segment.day, { year: true })}
          >
            {segment.label}
          </div>
          {zoom === "week" && (
            <div className="mt-0.5 text-[9px] text-muted-foreground">
              Week of
            </div>
          )}
        </div>
      ))}
      {todayX >= 0 && todayX < days * dayWidth && (
        <div
          className="absolute bottom-0 z-10 h-4 border-l-2 border-[var(--tp-accent)]"
          style={{ left: todayX }}
          title={`Today: ${today}`}
        >
          <span className="absolute -top-3 -translate-x-1/2 bg-primary px-1 text-[9px] text-white">
            TODAY
          </span>
        </div>
      )}
    </div>
  );
}

export function Timeline(props: TimelineProps) {
  const { rows, first, days, dayWidth, startIndex, endIndex, preview } = props;
  const width = days * dayWidth;
  const height = rows.length * ROW_HEIGHT;
  const markerId = useId().replace(/:/g, "");
  const baselineById = useMemo(
    () => new Map(props.baseline.map(b => [b.taskId, b])),
    [props.baseline]
  );
  const rowById = useMemo(
    () => new Map(rows.map((r, index) => [r.task.id, { ...r, index }])),
    [rows]
  );
  const externalById = useMemo(
    () => new Map(props.external.map(t => [t.id, t])),
    [props.external]
  );
  const shadeDays = [];
  for (
    let index = Math.max(0, props.visibleDayStart - 8);
    index < Math.min(days, props.visibleDayEnd + 8);
    index++
  ) {
    const day = addDays(first, index);
    const wd = parseDay(day).getUTCDay();
    if (wd === 0 || wd === 6) shadeDays.push(index);
  }
  function geometry(task: GanttTask) {
    const shifted = preview?.shift?.dates.get(task.id);
    if (shifted) {
      return barGeometry(
        shifted.start,
        shifted.finish,
        first,
        dayWidth,
        task.kind === "milestone"
      );
    }
    const start =
      preview?.taskId === task.id && preview.mode !== "link"
        ? preview.start
        : task.startDate;
    const finish =
      preview?.taskId === task.id && preview.mode !== "link"
        ? preview.finish
        : task.finishDate;
    return start && finish
      ? barGeometry(start, finish, first, dayWidth, task.kind === "milestone")
      : null;
  }
  const connectors = props.dependencies.flatMap(dep => {
    const from = rowById.get(dep.predecessorId);
    const to = rowById.get(dep.successorId);
    if (from && to) {
      if (
        Math.max(from.index, to.index) < startIndex ||
        Math.min(from.index, to.index) >= endIndex
      )
        return [];
      const fromBar = geometry(from.task);
      const toBar = geometry(to.task);
      if (!fromBar || !toBar) return [];
      return [
        {
          dep,
          ...dependencyPath(
            dep.type,
            fromBar,
            from.index * ROW_HEIGHT + 17,
            toBar,
            to.index * ROW_HEIGHT + 17
          ),
          externalName: "",
        },
      ];
    }
    const local = to ?? from;
    const external = externalById.get(to ? dep.predecessorId : dep.successorId);
    if (
      !local ||
      !external ||
      local.index < startIndex ||
      local.index >= endIndex
    )
      return [];
    const bar = geometry(local.task);
    if (!bar) return [];
    const y = local.index * ROW_HEIGHT + 17;
    const x = to
      ? dep.type[1] === "F"
        ? bar.finishX
        : bar.startX
      : dep.type[0] === "S"
        ? bar.startX
        : bar.finishX;
    const stub = to ? Math.max(2, x - 44) : x + 44;
    return [
      {
        dep,
        path: to
          ? `M ${stub} ${y - 12} H ${stub + 10} V ${y} H ${x}`
          : `M ${x} ${y} H ${stub - 10} V ${y - 12} H ${stub}`,
        labelX: stub - 5,
        labelY: y - 16,
        externalName: `${external.projectName}: ${external.name}`,
      },
    ];
  });

  return (
    <div
      ref={props.bodyRef}
      className="relative shrink-0 bg-[var(--tp-paper)]"
      style={{ width, height }}
    >
      {shadeDays.map(index => (
        <div
          key={index}
          className="pointer-events-none absolute inset-y-0 bg-[var(--tp-bone)]"
          style={{ left: index * dayWidth, width: dayWidth }}
        />
      ))}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, transparent 37px, var(--tp-rule) 37px)",
          backgroundSize: `100% ${ROW_HEIGHT}px`,
        }}
      />
      {props.today >= first && diffDays(first, props.today) < days && (
        <div
          className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-[var(--tp-accent)] opacity-80"
          style={{ left: (diffDays(first, props.today) + 0.5) * dayWidth }}
        />
      )}
      <svg
        className="pointer-events-none absolute inset-0 z-[12] overflow-visible"
        width={width}
        height={height}
        aria-label="Task dependencies"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {connectors.map(({ dep, path, labelX, labelY, externalName }) => (
          <g
            key={dep.id}
            role="button"
            tabIndex={0}
            aria-label={`${dep.type} dependency${dep.lagDays ? `, ${dep.lagDays} day lag` : ""}${externalName ? ` — ${externalName}` : ""}. Open link details.`}
            onClick={() => props.onSelectDependency(dep.id)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onSelectDependency(dep.id);
              }
            }}
            className="cursor-pointer"
          >
            <title>
              {externalName ? `${externalName} — ` : ""}
              {dep.type} · {dep.lagDays} day lag. Click to inspect
              {props.editable ? " or remove" : ""}.
            </title>
            <path
              d={path}
              stroke="transparent"
              strokeWidth="12"
              fill="none"
              style={{ pointerEvents: "stroke" }}
            />
            <path
              d={path}
              stroke={
                props.selectedDependency === dep.id
                  ? "var(--tp-accent)"
                  : "var(--tp-muted)"
              }
              strokeWidth={props.selectedDependency === dep.id ? 2 : 1.2}
              strokeDasharray={externalName ? "3 2" : undefined}
              fill="none"
              markerEnd={`url(#${markerId})`}
            />
            {(props.zoom === "day" ||
              props.selectedDependency === dep.id ||
              externalName) && (
              <text x={labelX} y={labelY} fontSize="9" fill="var(--tp-ink-2)">
                {externalName ? "EXT " : ""}
                {dep.type}
                {dep.lagDays
                  ? ` ${dep.lagDays > 0 ? "+" : ""}${dep.lagDays}d`
                  : ""}
              </text>
            )}
          </g>
        ))}
        {preview?.mode === "link" &&
          (() => {
            const source = rowById.get(preview.taskId);
            const bar = source ? geometry(source.task) : null;
            if (!source || !bar) return null;
            return (
              <path
                d={`M ${bar.finishX} ${source.index * ROW_HEIGHT + 17} H ${bar.finishX + 12} V ${preview.y} H ${preview.x}`}
                stroke="var(--tp-accent)"
                strokeWidth="2"
                strokeDasharray="4 3"
                fill="none"
                markerEnd={`url(#${markerId})`}
              />
            );
          })()}
      </svg>
      {rows.slice(startIndex, endIndex).map(({ task, summary }, offset) => {
        const index = startIndex + offset;
        const top = index * ROW_HEIGHT;
        const bar = geometry(task);
        const baseline = props.showBaseline
          ? baselineById.get(task.id)
          : undefined;
        const ghost =
          baseline?.startDate && baseline.finishDate
            ? barGeometry(
                baseline.startDate,
                baseline.finishDate,
                first,
                dayWidth,
                task.kind === "milestone"
              )
            : null;
        const highlight = props.critical && task.isCritical;
        const canDrag = props.editable && !props.busy && !!bar;
        const editable = canDrag && !summary;
        const activePreview =
          preview?.taskId === task.id && preview.mode !== "link";
        const start = activePreview ? preview.start : task.startDate;
        const finish = activePreview ? preview.finish : task.finishDate;
        const pct = Math.max(0, Math.min(100, task.percentComplete));
        const tone =
          task.kind === "sequence"
            ? "var(--tp-accent)"
            : "var(--tp-gantt-fill)";
        return (
          <div
            key={task.id}
            className={cn(
              "absolute inset-x-0 h-[38px]",
              props.selectedId === task.id && "bg-[var(--tp-accent-soft)]/50"
            )}
            style={{ top }}
          >
            {ghost && (
              <div
                className="pointer-events-none absolute rounded-[3px] border border-dashed border-[var(--tp-muted)] bg-[var(--tp-muted)]/20"
                style={{
                  left: ghost.x,
                  width: ghost.width,
                  top: 29,
                  height: 5,
                }}
                title={`Baseline: ${fmtDate(baseline?.startDate)} — ${fmtDate(baseline?.finishDate)}`}
              />
            )}
            {!bar ? (
              <button
                type="button"
                className="absolute left-4 top-2 text-[11px] italic text-muted-foreground"
                onClick={() => props.onOpen(task.id)}
              >
                Unscheduled — open task
              </button>
            ) : (
              <div
                data-gantt-task={task.id}
                data-summary={summary ? "true" : undefined}
                className={cn(
                  "group absolute z-20 select-none rounded-[4px] focus-visible:outline-2 focus-visible:outline-[var(--tp-accent)]",
                  canDrag && "cursor-grab active:cursor-grabbing",
                  !canDrag && "cursor-pointer",
                  preview?.targetId === task.id &&
                    "outline-2 outline-offset-4 outline-[var(--tp-accent)]"
                )}
                role="button"
                tabIndex={0}
                aria-label={`${task.wbs ?? ""} ${task.name}, ${start} to ${finish}, ${Math.round(pct)}% complete${task.isCritical ? ", critical" : ""}`}
                style={{
                  left: bar.x,
                  width: bar.width,
                  top: summary ? 10 : 7,
                  height: 20,
                  touchAction: canDrag ? "none" : "auto",
                  outline: highlight
                    ? "2px solid var(--tp-red-strong)"
                    : undefined,
                  outlineOffset: highlight ? 2 : undefined,
                }}
                title={`${task.name}\n${fmtDate(start)} — ${fmtDate(finish)} · ${Math.round(pct)}%\n${summary ? (props.editable ? "Summary: drag to shift every task under it by work days." : "Summary: dates roll up from detail tasks.") : task.schedulingMode === "manual" ? "Manual: drag shifts start and finish." : "Automatic: drag sets Start No Earlier Than; dependencies still apply."}${task.constraintViolated ? "\nSchedule constraint violated." : ""}`}
                onClick={() => props.onOpen(task.id)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onOpen(task.id);
                  }
                }}
                onPointerDown={event =>
                  canDrag && props.onBegin(event, task, "move")
                }
                onPointerMove={props.onMove}
                onPointerUp={props.onEnd}
                onPointerCancel={props.onCancel}
              >
                {summary ? (
                  <svg
                    width={bar.width}
                    height="20"
                    className="pointer-events-none overflow-visible"
                  >
                    <path
                      d={`M0 0 H${bar.width} V4 L${Math.max(0, bar.width - 5)} 11 V5 H5 V11 L0 4 Z`}
                      fill="var(--tp-ink-2)"
                    />
                    <rect
                      x="0"
                      y="0"
                      width={(bar.width * pct) / 100}
                      height="3"
                      fill="var(--tp-accent)"
                    />
                  </svg>
                ) : task.kind === "milestone" ? (
                  <div
                    className={cn(
                      "pointer-events-none absolute left-[2px] top-[3px] size-[11px] rotate-45 border border-[var(--tp-ink-2)]",
                      task.scheduleHealth === "delayed" && "hazard"
                    )}
                    style={{
                      backgroundColor:
                        pct === 100 ? "var(--tp-ink-2)" : "var(--tp-paper)",
                    }}
                  />
                ) : (
                  <div
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-[4px] border"
                    style={{
                      borderColor: tone,
                      backgroundColor:
                        task.kind === "sequence"
                          ? "var(--tp-accent-soft)"
                          : "var(--tp-gray-soft)",
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 opacity-80"
                      style={{ width: `${pct}%`, backgroundColor: tone }}
                    />
                    {task.scheduleHealth === "delayed" && (
                      <div className="hazard absolute inset-0" />
                    )}
                    {bar.width > 70 && (
                      <span
                        className="num absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-[var(--tp-paper)] px-1 text-[10px] text-[var(--tp-ink)]"
                      >
                        {Math.round(pct)}%
                      </span>
                    )}
                  </div>
                )}
                {task.kind === "sequence" && !summary && (
                  <span className="num pointer-events-none absolute left-full top-0 ml-5 whitespace-nowrap text-[10px] text-[var(--tp-ink-2)]">
                    {fmtTons(task.erectedTons)} / {fmtTons(task.plannedTons)}
                  </span>
                )}
                {editable && (
                  <>
                    {task.kind !== "milestone" && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Resize ${task.name}; use task drawer for keyboard date edits`}
                        title="Drag to resize duration"
                        className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize border-x border-[var(--tp-graphite)]/40 bg-[var(--tp-graphite)]/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            props.onOpen(task.id);
                          }
                        }}
                        onPointerDown={event => {
                          event.stopPropagation();
                          props.onBegin(event, task, "resize");
                        }}
                      />
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Link ${task.name} to a successor; use task drawer for keyboard dependency edits`}
                      title="Drag onto another detail bar to create Finish → Start"
                      className="absolute -right-3 top-1.5 size-[8px] cursor-crosshair rounded-full border border-[var(--tp-accent)] bg-[var(--tp-paper)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.stopPropagation();
                          props.onOpen(task.id);
                        }
                      }}
                      onPointerDown={event => {
                        event.stopPropagation();
                        props.onBegin(event, task, "link");
                      }}
                    />
                  </>
                )}
              </div>
            )}
            {activePreview && (
              <div
                className="num pointer-events-none absolute z-30 whitespace-nowrap border border-[var(--tp-graphite)] bg-[var(--tp-paper)] px-2 py-0.5 text-[10px]"
                style={{ left: Math.max(0, bar?.x ?? 0), top: -15 }}
              >
                {preview.shift ? (
                  <>
                    Shift {preview.shift.workDays > 0 ? "+" : ""}
                    {preview.shift.workDays} work days ·{" "}
                    {fmtDate(preview.start)} → {fmtDate(preview.finish)}
                  </>
                ) : (
                  <>
                    {fmtDate(preview.start)} → {fmtDate(preview.finish)} ·{" "}
                    {preview.duration} work days
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
