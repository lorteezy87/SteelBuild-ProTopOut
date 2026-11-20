import { ScheduleHealth } from "@/components/ks/Status";
import { fmtDateShort, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, AlertTriangle, GripVertical } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { useWbsDrag } from "@/features/tasks/useWbsDrag";
import {
  GRID_COLUMN_WIDTHS,
  GRID_MIN_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  type GanttTask,
  type TaskRow,
} from "./model";

const COLS = GRID_COLUMN_WIDTHS.length;
function Columns() {
  return (
    <colgroup>
      {GRID_COLUMN_WIDTHS.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  );
}

export function WbsHeader({
  paneWidth,
  headerRef,
  gridRef,
}: {
  paneWidth: number;
  headerRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={headerRef}
      className="sticky left-0 z-30 shrink-0 overflow-x-auto border-r border-[var(--ks-rule)] bg-[var(--ks-rule-soft)]"
      style={{ width: paneWidth, height: HEADER_HEIGHT }}
      onScroll={event => {
        if (gridRef.current)
          gridRef.current.scrollLeft = event.currentTarget.scrollLeft;
      }}
    >
      <table
        className="ks-table"
        style={{ width: GRID_MIN_WIDTH, tableLayout: "fixed" }}
        aria-label="Schedule columns"
      >
        <Columns />
        <thead>
          <tr style={{ height: HEADER_HEIGHT - 16 }}>
            {[
              "",
              "WBS",
              "Task / sequence",
              "Crew",
              "Days",
              "Start",
              "Finish",
              "%",
              "Health",
            ].map((label, i) => (
              <th
                key={`${label}${i}`}
                className={i === 4 || i === 7 ? "right" : i === 0 ? "!px-0" : undefined}
                style={{ height: HEADER_HEIGHT - 16 }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
  );
}

export function WbsGrid({
  rows,
  startIndex,
  endIndex,
  paneWidth,
  selectedId,
  collapsed,
  headerRef,
  gridRef,
  onToggle,
  onOpen,
  editable,
  drag,
  crew,
}: {
  editable: boolean;
  drag: ReturnType<typeof useWbsDrag>;
  crew: (task: GanttTask) => ReactNode;
  rows: TaskRow[];
  startIndex: number;
  endIndex: number;
  paneWidth: number;
  selectedId: number | null;
  collapsed: Set<number>;
  headerRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  onToggle: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  return (
    <div
      className="sticky left-0 z-20 shrink-0 border-r border-[var(--ks-rule)] bg-[var(--ks-paper)]"
      style={{ width: paneWidth }}
    >
      <div
        ref={gridRef}
        className="overflow-x-hidden"
        onScroll={event => {
          if (headerRef.current)
            headerRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <table
          className="ks-table"
          style={{ width: GRID_MIN_WIDTH, tableLayout: "fixed" }}
          aria-label="Schedule WBS"
        >
          <Columns />
          <tbody>
            {startIndex > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={COLS}
                  style={{
                    padding: 0,
                    height: startIndex * ROW_HEIGHT,
                    border: 0,
                  }}
                />
              </tr>
            )}
            {rows
              .slice(startIndex, endIndex)
              .map(({ task, depth, summary }) => (
                <tr
                  key={task.id}
                  className={cn(
                    "cursor-pointer",
                    summary && "font-semibold",
                    selectedId === task.id && "is-selected",
                    drag.rowClass(task.id)
                  )}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => onOpen(task.id)}
                  {...drag.rowProps(task)}
                >
                  <td className="!px-0 !py-0" onClick={event => event.stopPropagation()}>
                    {editable && (
                      <span
                        {...drag.handleProps(task)}
                        role="button"
                        tabIndex={-1}
                        aria-label={`Drag ${task.name}`}
                        title="Drag to reorder, or drop onto a sequence"
                        className="ks-grip flex h-[36px] w-5 items-center justify-center"
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                    )}
                  </td>
                  <td
                    className="num !py-0 text-[11px]"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {task.wbs || "—"}
                  </td>
                  <td className="!py-0" style={{ height: ROW_HEIGHT }}>
                    <div
                      className="flex min-w-0 items-center gap-1"
                      style={{ paddingLeft: Math.min(depth, 8) * 12 }}
                    >
                      {summary ? (
                        <button
                          type="button"
                          className="flex size-5 shrink-0 items-center justify-center hover:text-[var(--ks-accent-ink)]"
                          aria-label={`${collapsed.has(task.id) ? "Expand" : "Collapse"} ${task.name}`}
                          aria-expanded={!collapsed.has(task.id)}
                          onClick={event => {
                            event.stopPropagation();
                            onToggle(task.id);
                          }}
                        >
                          {collapsed.has(task.id) ? (
                            <ChevronRight className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      <button
                        type="button"
                        className="truncate text-left text-[12px] hover:text-[var(--ks-accent-ink)]"
                        title={task.name}
                        onClick={event => {
                          event.stopPropagation();
                          onOpen(task.id);
                        }}
                      >
                        {task.name}
                      </button>
                      {task.constraintViolated && (
                        <AlertTriangle
                          className="size-3.5 shrink-0 text-[var(--ks-red-strong)]"
                          aria-label="Schedule constraint violated"
                        />
                      )}
                    </div>
                  </td>
                  <td className="!px-1 !py-0" onClick={event => event.stopPropagation()}>
                    {crew(task)}
                  </td>
                  <td className="num right !py-0 text-[11.5px]">
                    {fmtNum(task.durationDays, task.durationDays % 1 ? 1 : 0)}
                  </td>
                  <td className="num !py-0 text-[11px]">
                    {fmtDateShort(task.startDate)}
                  </td>
                  <td className="num !py-0 text-[11px]">
                    {fmtDateShort(task.finishDate)}
                  </td>
                  <td className="num right !py-0 text-[11.5px]">
                    {Math.round(task.percentComplete)}%
                  </td>
                  <td className="!px-1.5 !py-0">
                    <ScheduleHealth
                      value={task.scheduleHealth}
                      className="!gap-1 !px-1 !text-[10px]"
                    />
                  </td>
                </tr>
              ))}
            {endIndex < rows.length && (
              <tr aria-hidden>
                <td
                  colSpan={COLS}
                  style={{
                    padding: 0,
                    height: (rows.length - endIndex) * ROW_HEIGHT,
                    border: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
