import {
  ConfirmButton,
  NumberInput,
  SimpleSelect,
} from "@/components/ks/Controls";
import { EmptyState, ErrorState, Loading } from "@/components/ks/Layout";
import { Button } from "@/components/ui/button";
import { TaskDrawer } from "@/features/tasks/TaskDrawer";
import { AssignCell, buildRollups } from "@/features/tasks/AssignPopover";
import { useTaskOps } from "@/features/tasks/useTaskOps";
import { useWbsDrag } from "@/features/tasks/useWbsDrag";
import {
  Timeline,
  TimelineRuler,
  type DragPreview,
  type GestureMode,
} from "@/features/gantt/Timeline";
import { WbsGrid, WbsHeader } from "@/features/gantt/WbsGrid";
import {
  ancestorIds,
  DAY_WIDTH,
  DIVIDER_WIDTH,
  durationThrough,
  finishFor,
  HEADER_HEIGHT,
  nextWorkDay,
  ROW_HEIGHT,
  taskTree,
  timelineRange,
  shiftPreview,
  workDayDelta,
  type GanttTask,
  type Zoom,
} from "@/features/gantt/model";
import { addDays, diffDays, errMsg, fmtDate } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { DEP_TYPES } from "@shared/domain";
import {
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  GitBranch,
  Layers,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { useJob, useJobInvalidate, useSearchParam } from "./JobContext";

type Gesture = {
  task: GanttTask;
  mode: GestureMode;
  pointerId: number;
  initialX: number;
  moved: boolean;
  preview: DragPreview;
};
type LinkType = keyof typeof DEP_TYPES;

export default function Schedule() {
  const { projectId, data: job, can } = useJob();
  const { today } = useRefData();
  const query = trpc.tasks.list.useQuery({ projectId });
  const invalidate = useJobInvalidate();
  const taskParam = useSearchParam("task");
  const editable = can("task.edit");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [zoom, setZoom] = useState<Zoom>("week");
  const [critical, setCritical] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [paneWidth, setPaneWidth] = useState(600);
  const [savingDates, setSavingDates] = useState(false);
  const [viewport, setViewport] = useState({
    top: 0,
    left: 0,
    width: 1100,
    height: 500,
  });
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [selectedDependency, setSelectedDependency] = useState<number | null>(
    null
  );
  const [linkType, setLinkType] = useState<LinkType>("FS");
  const [lag, setLag] = useState<number | null>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridHeaderRef = useRef<HTMLDivElement>(null);
  const gridBodyRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const resizeRef = useRef<{ x: number; width: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const pendingFocus = useRef<number | null>(null);
  const handledTaskParam = useRef<string | null>(null);
  const initializedProject = useRef<number | null>(null);
  const allTasks = query.data?.tasks;
  const rows = useMemo(
    () => taskTree(allTasks ?? [], collapsed),
    [allTasks, collapsed]
  );
  const summaryIds = useMemo(
    () =>
      new Set(
        (allTasks ?? [])
          .filter(t => t.isSummary || allTasks?.some(k => k.parentId === t.id))
          .map(t => t.id)
      ),
    [allTasks]
  );
  const range = useMemo(
    () =>
      timelineRange(
        allTasks ?? [],
        query.data?.baseline ?? [],
        today,
        job.project.startDate,
        job.project.deadline
      ),
    [
      allTasks,
      query.data?.baseline,
      today,
      job.project.startDate,
      job.project.deadline,
    ]
  );
  const dayWidth = DAY_WIDTH[zoom];
  const timelineWidth = range.days * dayWidth;
  const contentWidth = paneWidth + DIVIDER_WIDTH + timelineWidth;
  const startIndex = Math.max(
    0,
    Math.floor((viewport.top - HEADER_HEIGHT) / ROW_HEIGHT) - 6
  );
  const endIndex = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height - HEADER_HEIGHT) / ROW_HEIGHT) + 6
  );
  const visibleDayStart = Math.max(0, Math.floor(viewport.left / dayWidth));
  const visibleDayEnd = Math.min(
    range.days,
    Math.ceil(
      (viewport.left + Math.max(180, viewport.width - paneWidth)) / dayWidth
    )
  );
  const activeBaseline =
    !!job.project.activeBaselineId && !!query.data?.baseline.length;
  const selectedLink = query.data?.dependencies.find(
    d => d.id === selectedDependency
  );
  const taskNames = useMemo(
    () =>
      new Map([
        ...(allTasks ?? []).map(
          t => [t.id, `${t.wbs ?? ""} ${t.name}`] as const
        ),
        ...(query.data?.external ?? []).map(
          t => [t.id, `${t.projectName} / ${t.name}`] as const
        ),
      ]),
    [allTasks, query.data?.external]
  );
  const move = trpc.tasks.moveDates.useMutation({
    onError: error => toast.error(errMsg(error)),
  });
  const addLink = trpc.tasks.addDependency.useMutation({
    onError: error => toast.error(errMsg(error)),
    onSuccess: async () => {
      await invalidate(projectId);
      toast.success("Finish → Start link added.");
    },
  });
  const removeLink = trpc.tasks.removeDependency.useMutation({
    onError: error => toast.error(errMsg(error)),
    onSuccess: async () => {
      setSelectedDependency(null);
      await invalidate(projectId);
      toast.success("Dependency removed.");
    },
  });
  const updateLink = trpc.tasks.updateDependency.useMutation({
    onError: error => toast.error(errMsg(error)),
    onSuccess: async () => {
      await invalidate(projectId);
      toast.success("Dependency updated.");
    },
  });
  const ops = useTaskOps({
    projectId,
    tasks: allTasks ?? [],
    dependencies: query.data?.dependencies ?? [],
    onChanged: () => invalidate(projectId),
  });
  const rollups = useMemo(() => buildRollups(allTasks ?? []), [allTasks]);
  const noSelection = useMemo(() => new Set<number>(), []);
  const busy =
    ops.pending ||
    savingDates ||
    move.isPending ||
    addLink.isPending ||
    removeLink.isPending ||
    updateLink.isPending;

  useEffect(() => {
    setTaskId(null);
    setSelectedDependency(null);
    setCollapsed(new Set());
    gestureRef.current = null;
    pendingFocus.current = null;
    setPreview(null);
  }, [projectId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setViewport(v => ({
        ...v,
        width: node.clientWidth,
        height: node.clientHeight,
        top: node.scrollTop,
        left: node.scrollLeft,
      }));
      setPaneWidth(width =>
        Math.max(300, Math.min(width, Math.max(300, node.clientWidth - 180)))
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [query.isLoading, !!query.data, rows.length > 0]);

  useEffect(() => {
    if (!allTasks) return;
    const id = Number(taskParam);
    const key = taskParam ? `${projectId}:${taskParam}` : null;
    if (handledTaskParam.current === key) return;
    handledTaskParam.current = key;
    if (taskParam && Number.isInteger(id) && id > 0) {
      setTaskId(id);
      pendingFocus.current = id;
      const ancestors = ancestorIds(allTasks, id);
      setCollapsed(current => {
        if (!ancestors.some(parent => current.has(parent))) return current;
        const next = new Set(current);
        ancestors.forEach(parent => next.delete(parent));
        return next;
      });
    }
  }, [taskParam, allTasks, projectId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !allTasks) return;
    const focusId = pendingFocus.current;
    if (focusId) {
      const index = rows.findIndex(r => r.task.id === focusId);
      if (index >= 0) {
        const task = rows[index].task;
        node.scrollTop = Math.max(0, index * ROW_HEIGHT - ROW_HEIGHT);
        node.scrollLeft = task.startDate
          ? Math.max(0, diffDays(range.first, task.startDate) * dayWidth - 64)
          : 0;
        pendingFocus.current = null;
        initializedProject.current = projectId;
      }
    } else if (initializedProject.current !== projectId) {
      const dates = allTasks
        .map(t => t.startDate)
        .filter((d): d is string => !!d)
        .sort();
      node.scrollLeft = Math.max(
        0,
        diffDays(range.first, dates[0] ?? today) * dayWidth - 40
      );
      initializedProject.current = projectId;
    }
    setViewport(v => ({ ...v, top: node.scrollTop, left: node.scrollLeft }));
  }, [rows, allTasks, range.first, projectId, dayWidth, today]);

  useEffect(() => {
    if (selectedLink) {
      setLinkType(selectedLink.type as LinkType);
      setLag(selectedLink.lagDays);
    }
  }, [selectedLink?.id, selectedLink?.type, selectedLink?.lagDays]);

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        gestureRef.current = null;
        setPreview(null);
        setSelectedDependency(null);
      }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  function openTask(id: number) {
    if (Date.now() < suppressClickUntil.current) return;
    setSelectedDependency(null);
    setTaskId(id);
  }
  function closeDrawer() {
    setTaskId(null);
    if (taskParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("task");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    }
  }
  function toggleRow(id: number) {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function changeZoom(value: Zoom) {
    const node = scrollRef.current;
    const half = Math.max(0, viewport.width - paneWidth) / 2;
    const centerDay = ((node?.scrollLeft ?? 0) + half) / dayWidth;
    setZoom(value);
    requestAnimationFrame(() => {
      if (node) {
        node.scrollLeft = Math.max(0, centerDay * DAY_WIDTH[value] - half);
        setViewport(v => ({ ...v, left: node.scrollLeft }));
      }
    });
  }
  function goToday() {
    const node = scrollRef.current;
    if (node)
      node.scrollLeft = Math.max(
        0,
        (diffDays(range.first, today) + 0.5) * dayWidth -
          (node.clientWidth - paneWidth) / 2
      );
  }

  const rowDrag = useWbsDrag({
    tasks: allTasks ?? [],
    enabled: editable && !busy,
    selection: noSelection,
    expanded: id => !collapsed.has(id),
    onDrop: (ids, parentId, beforeId) => {
      ops.moveTasks(ids, parentId, beforeId);
    },
  });

  function begin(
    event: PointerEvent<HTMLElement>,
    task: GanttTask,
    mode: GestureMode
  ) {
    if (
      !editable ||
      busy ||
      (summaryIds.has(task.id) && mode !== "move") ||
      !task.startDate ||
      !task.finishDate ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const draft: DragPreview = {
      taskId: task.id,
      mode,
      start: task.startDate,
      finish: task.finishDate,
      duration: task.durationDays,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      targetId: null,
      changed: false,
      shift: summaryIds.has(task.id)
        ? { dates: new Map(), workDays: 0 }
        : undefined,
    };
    gestureRef.current = {
      task,
      mode,
      pointerId: event.pointerId,
      initialX: draft.x,
      moved: false,
      preview: draft,
    };
    setPreview(draft);
    setSelectedDependency(null);
  }
  function drag(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    const data = query.data;
    const rect = bodyRef.current?.getBoundingClientRect();
    if (
      !gesture ||
      gesture.pointerId !== event.pointerId ||
      !data ||
      !rect ||
      !gesture.task.startDate ||
      !gesture.task.finishDate
    )
      return;
    const node = scrollRef.current;
    const scrollRect = node?.getBoundingClientRect();
    if (node && scrollRect) {
      if (event.clientX > scrollRect.right - 30) node.scrollLeft += dayWidth;
      else if (
        event.clientX < scrollRect.left + paneWidth + 25 &&
        node.scrollLeft > 0
      )
        node.scrollLeft -= dayWidth;
      if (event.clientY > scrollRect.bottom - 25) node.scrollTop += ROW_HEIGHT;
      else if (
        event.clientY < scrollRect.top + HEADER_HEIGHT + 25 &&
        node.scrollTop > 0
      )
        node.scrollTop -= ROW_HEIGHT;
    }
    const currentRect = bodyRef.current?.getBoundingClientRect() ?? rect;
    const x = event.clientX - currentRect.left;
    const y = event.clientY - currentRect.top;
    const delta = Math.round((x - gesture.initialX) / dayWidth);
    gesture.moved ||= Math.abs(x - gesture.initialX) > 3;
    const draft = { ...gesture.preview, x, y, changed: delta !== 0 };
    if (gesture.mode === "link") {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-gantt-task]");
      const targetId = Number(target?.dataset.ganttTask);
      draft.targetId =
        targetId && targetId !== gesture.task.id && !summaryIds.has(targetId)
          ? targetId
          : null;
      draft.changed = gesture.moved;
    } else if (gesture.mode === "move" && draft.shift) {
      // Summary / sequence bar: shift every detail task by whole work days.
      const n = workDayDelta(
        gesture.task.startDate,
        addDays(gesture.task.startDate, delta),
        data.calendar
      );
      if (n !== draft.shift.workDays || (n !== 0 && !draft.shift.dates.size)) {
        const dates = shiftPreview(data.tasks, gesture.task.id, n, data.calendar);
        const own = dates.get(gesture.task.id);
        dates.delete(gesture.task.id);
        draft.start = own?.start ?? gesture.task.startDate;
        draft.finish = own?.finish ?? gesture.task.finishDate;
        draft.shift = { dates, workDays: n };
      }
      draft.duration = gesture.task.durationDays;
      draft.changed = n !== 0;
    } else if (gesture.mode === "move") {
      draft.start = nextWorkDay(
        addDays(gesture.task.startDate, delta),
        data.calendar
      );
      draft.finish =
        gesture.task.kind === "milestone"
          ? draft.start
          : finishFor(draft.start, gesture.task.durationDays, data.calendar);
    } else {
      draft.duration = durationThrough(
        gesture.task.startDate,
        addDays(gesture.task.finishDate, delta),
        data.calendar
      );
      draft.finish = finishFor(
        gesture.task.startDate,
        draft.duration,
        data.calendar
      );
      draft.changed = draft.duration !== gesture.task.durationDays;
    }
    gesture.preview = draft;
    setPreview(draft);
  }
  function end(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.moved || gesture.preview.changed || gesture.mode !== "move")
      suppressClickUntil.current = Date.now() + 350;
    if (!editable || busy) return;
    const draft = gesture.preview;
    if (gesture.mode === "link") {
      if (draft.targetId)
        addLink.mutate({
          predecessorId: gesture.task.id,
          successorId: draft.targetId,
          type: "FS",
          lagDays: 0,
        });
      else if (gesture.moved)
        toast.message(
          "Drop the end handle onto another detail bar to link tasks."
        );
    } else if (draft.changed && draft.shift)
      void commitShift(draft.shift.workDays, gesture.task.id);
    else if (draft.changed) void commitDates(gesture.task, draft);
  }
  async function commitShift(workDays: number, id: number) {
    setSavingDates(true);
    try {
      await ops.shift([id], workDays);
      await query.refetch();
    } finally {
      setSavingDates(false);
    }
  }
  async function commitDates(task: GanttTask, draft: DragPreview) {
    setSavingDates(true);
    try {
      await move.mutateAsync({
        id: task.id,
        startDate: draft.start,
        ...(draft.mode === "resize" ? { durationDays: draft.duration } : {}),
      });
      await invalidate(projectId);
      const result = await query.refetch();
      const saved = result.data?.tasks.find(t => t.id === task.id);
      if (saved?.constraintViolated)
        toast.warning(
          "Schedule updated. This task violates its finish constraint; inspect the task dates."
        );
      else if (saved?.startDate && saved.startDate !== draft.start)
        toast.message(
          `Dependencies moved the start to ${fmtDate(saved.startDate)}.`,
          {
            description:
              "Automatic scheduling keeps predecessor limits in force.",
          }
        );
      else
        toast.success(
          draft.mode === "resize"
            ? "Duration updated. Schedule recalculated."
            : "Task moved. Schedule recalculated."
        );
    } catch {
      /* The mutation's onError displays the server's exact message. */
    } finally {
      setSavingDates(false);
    }
  }
  function cancelDrag() {
    gestureRef.current = null;
    setPreview(null);
    suppressClickUntil.current = Date.now() + 350;
  }

  if (query.isLoading) return <Loading label="Loading job schedule…" />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const rulerProps = {
    first: range.first,
    days: range.days,
    dayWidth,
    zoom,
    visibleDayStart,
    visibleDayEnd,
    today,
  };
  const externalCount = query.data.dependencies.filter(d =>
    query.data.external.some(
      t => t.id === d.predecessorId || t.id === d.successorId
    )
  ).length;

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <h2 className="label-caps text-[11px] text-[var(--ks-ink)]">
            Erection schedule
          </h2>
          <span className="num text-[11.5px] text-muted-foreground">
            {rows.length} / {allTasks?.length ?? 0} rows
          </span>
        </div>
        <div className="inline-flex" aria-label="Timeline zoom">
          {(["day", "week", "month"] as Zoom[]).map(value => (
            <Button
              key={value}
              size="sm"
              variant={zoom === value ? "secondary" : "outline"}
              className="h-8 rounded-none first:rounded-l-[3px] last:rounded-r-[3px]"
              aria-pressed={zoom === value}
              onClick={() => changeZoom(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          className="h-8"
          variant={critical ? "secondary" : "outline"}
          aria-pressed={critical}
          onClick={() => setCritical(v => !v)}
        >
          <GitBranch className="size-3.5" /> Critical path
        </Button>
        <Button
          size="sm"
          className="h-8"
          variant={showBaseline && activeBaseline ? "secondary" : "outline"}
          disabled={!activeBaseline}
          aria-pressed={showBaseline && activeBaseline}
          title={
            activeBaseline
              ? "Compare against the active baseline"
              : "Save and activate a baseline in the Baselines tab"
          }
          onClick={() => setShowBaseline(v => !v)}
        >
          <Layers className="size-3.5" /> Baseline
        </Button>
        <Button size="sm" className="h-8" variant="outline" onClick={goToday}>
          <Crosshair className="size-3.5" /> Today
        </Button>
        <Button
          size="sm"
          className="h-8 px-2"
          variant="outline"
          title="Expand all summary rows"
          aria-label="Expand all summary rows"
          onClick={() => setCollapsed(new Set())}
        >
          <ChevronsUpDown className="size-3.5" />
        </Button>
        <Button
          size="sm"
          className="h-8 px-2"
          variant="outline"
          title="Collapse all summary rows"
          aria-label="Collapse all summary rows"
          onClick={() => setCollapsed(new Set(summaryIds))}
        >
          <ChevronsDownUp className="size-3.5" />
        </Button>
      </div>
      {selectedLink && (
        <div className="mb-2 flex flex-wrap items-center gap-2 border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-3 py-2 text-[12px]">
          <GitBranch className="size-3.5 shrink-0 text-[var(--ks-accent-ink)]" />
          <span
            className="min-w-0 flex-1 truncate"
            title={`${taskNames.get(selectedLink.predecessorId)} → ${taskNames.get(selectedLink.successorId)}`}
          >
            {taskNames.get(selectedLink.predecessorId)} →{" "}
            {taskNames.get(selectedLink.successorId)}
          </span>
          {editable ? (
            <>
              <SimpleSelect
                value={linkType}
                options={DEP_TYPES}
                onChange={v => v && setLinkType(v)}
                className="h-7 w-[155px]"
                size="sm"
                disabled={busy}
              />
              <span className="label-caps">Lag days</span>
              <NumberInput
                value={lag}
                onChange={setLag}
                min={-365}
                className="h-7 w-[70px]"
                disabled={busy}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy || lag === null || lag < -365 || lag > 365}
                onClick={() =>
                  lag !== null &&
                  updateLink.mutate({
                    id: selectedLink.id,
                    type: linkType,
                    lagDays: lag,
                  })
                }
              >
                Apply
              </Button>
              <ConfirmButton
                title="Remove this dependency?"
                body="The successor schedule will be recalculated."
                destructive
                disabled={busy}
                confirmLabel="Remove link"
                onConfirm={() => removeLink.mutate({ id: selectedLink.id })}
              >
                <Trash2 className="size-3.5" /> Remove
              </ConfirmButton>
            </>
          ) : (
            <span className="num">
              {selectedLink.type} · {selectedLink.lagDays}d lag
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            aria-label="Close dependency details"
            onClick={() => setSelectedDependency(null)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      {!rows.length ? (
        <EmptyState
          title="No schedule tasks yet."
          body="Add tasks and erection sequences in Sequences & Tasks. Their dates and links will appear here."
        />
      ) : (
        <div
          ref={scrollRef}
          className="relative isolate h-[calc(100vh-345px)] min-h-[340px] max-h-[740px] overflow-auto border border-[var(--ks-rule)] bg-[var(--ks-paper)]"
          onScroll={event => {
            const node = event.currentTarget;
            setViewport(v => ({
              ...v,
              top: node.scrollTop,
              left: node.scrollLeft,
            }));
          }}
        >
          <div style={{ width: contentWidth }}>
            <div
              className="sticky top-0 z-40 flex"
              style={{ width: contentWidth, height: HEADER_HEIGHT }}
            >
              <WbsHeader
                paneWidth={paneWidth}
                headerRef={gridHeaderRef}
                gridRef={gridBodyRef}
              />
              <div
                className="sticky z-40 shrink-0 bg-[var(--ks-graphite-3)]"
                style={{ left: paneWidth, width: DIVIDER_WIDTH }}
              />
              <TimelineRuler {...rulerProps} />
            </div>
            <div className="flex items-start" style={{ width: contentWidth }}>
              <WbsGrid
                editable={editable}
                drag={rowDrag}
                crew={task => (
                  <AssignCell
                    ops={ops}
                    taskId={task.id}
                    title={`${task.wbs ?? ""} ${task.name}`}
                    rollup={rollups.get(task.id)}
                    editable={editable}
                    emptyLabel="Assign"
                  />
                )}
                rows={rows}
                startIndex={startIndex}
                endIndex={endIndex}
                paneWidth={paneWidth}
                selectedId={taskId}
                collapsed={collapsed}
                headerRef={gridHeaderRef}
                gridRef={gridBodyRef}
                onToggle={toggleRow}
                onOpen={openTask}
              />
              <div
                role="separator"
                tabIndex={0}
                aria-label="Resize WBS pane"
                aria-orientation="vertical"
                aria-valuemin={300}
                aria-valuemax={Math.max(300, viewport.width - 180)}
                aria-valuenow={paneWidth}
                className="sticky z-30 shrink-0 cursor-col-resize bg-[var(--ks-rule)] hover:bg-[var(--ks-accent)] focus:bg-[var(--ks-accent)]"
                style={{
                  left: paneWidth,
                  width: DIVIDER_WIDTH,
                  height: rows.length * ROW_HEIGHT + 17,
                  touchAction: "none",
                }}
                onPointerDown={event => {
                  resizeRef.current = { x: event.clientX, width: paneWidth };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  event.preventDefault();
                }}
                onPointerMove={event => {
                  if (resizeRef.current)
                    setPaneWidth(
                      Math.max(
                        300,
                        Math.min(
                          Math.max(300, viewport.width - 180),
                          resizeRef.current.width +
                            event.clientX -
                            resizeRef.current.x
                        )
                      )
                    );
                }}
                onPointerUp={event => {
                  resizeRef.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  resizeRef.current = null;
                }}
                onKeyDown={event => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setPaneWidth(w =>
                      Math.max(
                        300,
                        Math.min(
                          Math.max(300, viewport.width - 180),
                          w + (event.key === "ArrowRight" ? 24 : -24)
                        )
                      )
                    );
                  }
                }}
              />
              <Timeline
                {...rulerProps}
                rows={rows}
                dependencies={query.data.dependencies}
                external={query.data.external}
                baseline={query.data.baseline}
                startIndex={startIndex}
                endIndex={endIndex}
                selectedId={taskId}
                selectedDependency={selectedDependency}
                critical={critical}
                showBaseline={showBaseline && activeBaseline}
                editable={editable}
                busy={busy}
                preview={preview}
                bodyRef={bodyRef}
                onOpen={openTask}
                onSelectDependency={setSelectedDependency}
                onBegin={begin}
                onMove={drag}
                onEnd={end}
                onCancel={cancelDrag}
              />
            </div>
          </div>
        </div>
      )}
      <div
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground"
        aria-label="Schedule legend"
      >
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-5 border-b-[3px] border-x-[3px] border-[var(--ks-ink-2)]" />{" "}
          Summary
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 bg-[var(--ks-accent)]" /> Erection sequence
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 bg-[var(--ks-gantt-fill)]" /> Task
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rotate-45 border border-[var(--ks-ink-2)]" />{" "}
          Milestone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 border-2 border-[var(--ks-red-strong)]" />{" "}
          Critical
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hazard h-2.5 w-5 border border-[var(--ks-rule)]" />{" "}
          Delayed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 border border-dashed border-[var(--ks-muted)]" />{" "}
          Baseline
        </span>
        {!!externalCount && (
          <span className="num">{externalCount} cross-job links (EXT)</span>
        )}
        <span className="ml-auto">
          {busy
            ? "Recalculating schedule…"
            : editable
              ? "Drag bar: move · drag summary/sequence bar: shift its tasks · right edge: resize · end circle: FS link · grip ⠿: reorder rows · Esc: cancel"
              : "Read-only schedule"}
        </span>
      </div>
      <div className="mt-1 text-[10.5px] text-muted-foreground">
        Work-calendar duration. Automatic drags set Start No Earlier Than;
        manual drags shift dates. Dragging a summary shifts its unstarted
        detail tasks by whole work days; started tasks keep actual dates.
        {query.data.tasks.some(t => t.constraintViolated) && (
          <span className="ml-2 text-[var(--ks-red-strong)]">
            A task constraint is violated. Open the flagged task to inspect it.
          </span>
        )}
      </div>
      {ops.dialog}
      <TaskDrawer
        projectId={projectId}
        taskId={taskId}
        onClose={closeDrawer}
        onChanged={() => void invalidate(projectId)}
      />
    </div>
  );
}
