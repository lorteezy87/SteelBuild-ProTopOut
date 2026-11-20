import { addDays, diffDays, parseDay, weekStart } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";

export type TaskList = RouterOutputs["tasks"]["list"];
export type GanttTask = TaskList["tasks"][number];
export type Dependency = TaskList["dependencies"][number];
export type WorkCalendar = TaskList["calendar"];
export type Zoom = "day" | "week" | "month";
export type TaskRow = { task: GanttTask; depth: number; summary: boolean };
export const ROW_HEIGHT = 38;
export const HEADER_HEIGHT = 54;
export const DIVIDER_WIDTH = 6;
export const DAY_WIDTH: Record<Zoom, number> = { day: 36, week: 15, month: 5 };
/** grip · WBS · task · crew · days · start · finish · % · health */
export const GRID_COLUMN_WIDTHS = [20, 64, 214, 112, 50, 84, 84, 46, 100];
export const GRID_MIN_WIDTH = GRID_COLUMN_WIDTHS.reduce((a, b) => a + b, 0);

export function taskTree(
  tasks: GanttTask[],
  collapsed: Set<number>
): TaskRow[] {
  const children = new Map<number | null, GanttTask[]>();
  const ids = new Set(tasks.map(t => t.id));
  for (const t of tasks) {
    const parent = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(t);
    children.set(parent, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const rows: TaskRow[] = [];
  const visited = new Set<number>();
  function visit(parent: number | null, depth: number) {
    for (const task of children.get(parent) ?? []) {
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      const summary = task.isSummary || children.has(task.id);
      rows.push({ task, depth, summary });
      if (!collapsed.has(task.id)) visit(task.id, depth + 1);
    }
  }
  visit(null, 0);
  return rows;
}

export function ancestorIds(tasks: GanttTask[], id: number): number[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const result: number[] = [];
  let parent = byId.get(id)?.parentId;
  while (parent && !result.includes(parent)) {
    result.push(parent);
    parent = byId.get(parent)?.parentId;
  }
  return result;
}

export function timelineRange(
  tasks: GanttTask[],
  baseline: TaskList["baseline"],
  today: string,
  start?: string | null,
  finish?: string | null
) {
  const dates = [
    today,
    start,
    finish,
    ...tasks.flatMap(t => [t.startDate, t.finishDate]),
    ...baseline.flatMap(t => [t.startDate, t.finishDate]),
  ]
    .filter((d): d is string => !!d)
    .sort();
  const first = addDays(weekStart(dates[0] ?? today), -7);
  const last = addDays(dates[dates.length - 1] ?? today, 28);
  return { first, last, days: Math.max(56, diffDays(first, last) + 1) };
}

export function isWorkDay(day: string, calendar: WorkCalendar): boolean {
  // Same precedence as the server calendar: explicit exceptions beat weekday rules.
  if (calendar.workingDates?.includes(day)) return true;
  const wd = parseDay(day).getUTCDay() || 7;
  return (
    calendar.workDays.includes(wd) &&
    !calendar.holidays.some(h => h.date === day)
  );
}

export function nextWorkDay(day: string, calendar: WorkCalendar): string {
  let next = day;
  for (let i = 0; i < 370 && !isWorkDay(next, calendar); i++)
    next = addDays(next, 1);
  return next;
}

export function finishFor(
  start: string,
  duration: number,
  calendar: WorkCalendar
): string {
  let day = nextWorkDay(start, calendar);
  let remaining = Math.max(1, Math.ceil(duration)) - 1;
  for (let i = 0; remaining > 0 && i < 20000; i++) {
    day = addDays(day, 1);
    if (isWorkDay(day, calendar)) remaining--;
  }
  return day;
}

/**
 * Preview of a summary shift, matching tasks.shiftDates: unstarted detail tasks move
 * n work days on the job calendar, started/complete tasks stay, summaries re-roll up.
 */
export function shiftPreview(
  tasks: GanttTask[],
  rootId: number,
  n: number,
  calendar: WorkCalendar
): Map<number, { start: string; finish: string }> {
  const kids = new Map<number, GanttTask[]>();
  for (const t of tasks)
    if (t.parentId != null) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const out = new Map<number, { start: string; finish: string }>();
  const seen = new Set<number>();
  const visit = (id: number): { start: string | null; finish: string | null } => {
    const t = byId.get(id);
    if (!t || seen.has(id)) return { start: null, finish: null };
    seen.add(id);
    const children = kids.get(id) ?? [];
    if (!children.length) {
      if (!t.startDate || !t.finishDate) return { start: t.startDate, finish: t.finishDate };
      const started = !!t.actualStart || t.status === "done" || t.percentComplete >= 100;
      const r =
        started || n === 0
          ? { start: t.startDate, finish: t.finishDate }
          : {
              start: addWorkDays(t.startDate, n, calendar),
              finish: addWorkDays(t.finishDate, n, calendar),
            };
      out.set(id, r);
      return r;
    }
    let start: string | null = null;
    let finish: string | null = null;
    for (const c of children) {
      const r = visit(c.id);
      if (r.start && (!start || r.start < start)) start = r.start;
      if (r.finish && (!finish || r.finish > finish)) finish = r.finish;
    }
    if (start && finish) out.set(id, { start, finish });
    return { start, finish };
  };
  visit(rootId);
  return out;
}

/** Same rule as the server calendar: roll to a work day, then step n work days. */
export function addWorkDays(
  day: string,
  n: number,
  calendar: WorkCalendar
): string {
  let d = nextWorkDay(day, calendar);
  let left = Math.abs(Math.trunc(n));
  const step = n > 0 ? 1 : -1;
  for (let i = 0; left > 0 && i < 20000; i++) {
    d = addDays(d, step);
    if (isWorkDay(d, calendar)) left--;
  }
  return d;
}

/** Signed work days from `from` to `to` (both rolled forward to work days). */
export function workDayDelta(
  from: string,
  to: string,
  calendar: WorkCalendar
): number {
  const a = nextWorkDay(from, calendar);
  const b = nextWorkDay(to, calendar);
  if (a === b) return 0;
  const sign = b > a ? 1 : -1;
  let d = a;
  let n = 0;
  for (let i = 0; d !== b && i < 20000; i++) {
    d = addDays(d, sign);
    if (isWorkDay(d, calendar)) n += sign;
  }
  return n;
}

/** Resize uses working duration, not the number of calendar-day pixels. */
export function durationThrough(
  start: string,
  finish: string,
  calendar: WorkCalendar
): number {
  const count = Math.max(0, Math.min(20000, diffDays(start, finish)));
  let duration = 0;
  for (let i = 0; i <= count; i++)
    if (isWorkDay(addDays(start, i), calendar)) duration++;
  return Math.max(1, Math.min(2000, duration));
}

export type BarGeometry = {
  x: number;
  width: number;
  startX: number;
  finishX: number;
};
export function barGeometry(
  start: string,
  finish: string,
  first: string,
  dayWidth: number,
  milestone = false
): BarGeometry {
  const x = diffDays(first, start) * dayWidth;
  if (milestone) {
    const center = x + dayWidth / 2;
    return {
      x: center - 7,
      width: 14,
      startX: center - 7,
      finishX: center + 7,
    };
  }
  const width = Math.max(8, (diffDays(start, finish) + 1) * dayWidth);
  return { x, width, startX: x, finishX: x + width };
}

/** Endpoint letters select the correct side for FS, SS, FF and SF. */
export function dependencyPath(
  type: string,
  from: BarGeometry,
  fromY: number,
  to: BarGeometry,
  toY: number
) {
  const sourceFinish = type[0] !== "S";
  const targetFinish = type[1] === "F";
  const sx = sourceFinish ? from.finishX : from.startX;
  const tx = targetFinish ? to.finishX : to.startX;
  const leave = sx + (sourceFinish ? 12 : -12);
  const enter = tx + (targetFinish ? 12 : -12);
  const middleY = fromY + (toY > fromY ? ROW_HEIGHT / 2 : -ROW_HEIGHT / 2);
  return {
    path: `M ${sx} ${fromY} H ${leave} V ${middleY} H ${enter} V ${toY} H ${tx}`,
    labelX: leave + 3,
    labelY: middleY - 3,
  };
}

export function rulerSegments(
  first: string,
  days: number,
  zoom: Zoom,
  fromIndex: number,
  toIndex: number
) {
  const segments: {
    index: number;
    length: number;
    day: string;
    label: string;
  }[] = [];
  let index = Math.max(0, fromIndex - (zoom === "month" ? 32 : 8));
  if (zoom === "week")
    index = Math.max(
      0,
      index - ((parseDay(addDays(first, index)).getUTCDay() + 6) % 7)
    );
  if (zoom === "month")
    index = Math.max(
      0,
      index - parseDay(addDays(first, index)).getUTCDate() + 1
    );
  while (index < Math.min(days, toIndex + 32)) {
    const day = addDays(first, index);
    const date = parseDay(day);
    const nextMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    );
    const length =
      zoom === "day"
        ? 1
        : zoom === "week"
          ? 7
          : diffDays(day, nextMonth.toISOString().slice(0, 10));
    const label =
      zoom === "month"
        ? date.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })
        : zoom === "week"
          ? day.slice(5).replace("-", "/")
          : String(date.getUTCDate());
    segments.push({
      index,
      length: Math.min(length, days - index),
      day,
      label,
    });
    index += Math.max(1, length);
  }
  return segments;
}
