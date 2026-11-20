import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { StageCell } from "@/features/tasks/StageCell";
import { useLocation, useSearch } from "wouter";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Diamond,
  FolderTree,
  GripVertical,
  Indent,
  Layers,
  ListChecks,
  MoreHorizontal,
  Outdent,
  Plus,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmButton, SimpleSelect } from "@/components/brand/Controls";
import { EmptyState, ErrorState, Loading } from "@/components/brand/Layout";
import { Pill, ProgressBar, ScheduleHealth } from "@/components/brand/Status";
import {
  CreateTaskDrawer,
  InlineCell,
  type NewTaskTarget,
} from "@/features/tasks/GridControls";
import { TaskDrawer } from "@/features/tasks/TaskDrawer";
import {
  AssignCell,
  AssignPopover,
  buildRollups,
  rollupFor,
  type Rollup,
} from "@/features/tasks/AssignPopover";
import { MoveToDialog, ShiftDialog } from "@/features/tasks/BulkDialogs";
import { useTaskOps } from "@/features/tasks/useTaskOps";
import { useWbsDrag } from "@/features/tasks/useWbsDrag";
import { errMsg, fmtDateShort, fmtHours, fmtTons } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import {
  CONSTRAINT_TYPES,
  SCHEDULE_HEALTH,
  TASK_KINDS,
  TASK_STATUSES,
} from "@shared/domain";
import { leafIds } from "@shared/taskOps";
import { useJob, useJobInvalidate } from "./JobContext";

type Task = RouterOutputs["tasks"]["list"]["tasks"][number];
export default function Tasks() {
  const { projectId, data, can } = useJob();
  const invalidate = useJobInvalidate();
  const utils = trpc.useUtils();
  const { ref } = useRefData();
  const q = trpc.tasks.list.useQuery({ projectId });
  const [kind, setKind] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [critical, setCritical] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const urlSearch = useSearch();
  const queryTask = new URLSearchParams(urlSearch).get("task");
  const [taskId, setTaskId] = useState<number | null>(() =>
    queryTask && Number(queryTask) > 0 ? Number(queryTask) : null
  );
  const [creating, setCreating] = useState<NewTaskTarget | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const lastChecked = useRef<number | null>(null);
  const [moveIds, setMoveIds] = useState<number[] | null>(null);
  const [shiftIds, setShiftIds] = useState<number[] | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [location, navigate] = useLocation();
  useEffect(() => {
    setTaskId(queryTask && Number(queryTask) > 0 ? Number(queryTask) : null);
  }, [queryTask, projectId]);
  const changed = async () => {
    await Promise.all([
      invalidate(projectId),
      utils.tasks.get.invalidate(),
      utils.tasks.mine.invalidate(),
      utils.baselines.compare.invalidate(),
    ]);
  };
  const onError = (e: unknown) => toast.error(errMsg(e));
  const update = trpc.tasks.update.useMutation({ onSuccess: changed, onError });
  const dates = trpc.tasks.moveDates.useMutation({
    onSuccess: changed,
    onError,
  });
  const move = trpc.tasks.move.useMutation({ onSuccess: changed, onError });
  const indent = trpc.tasks.indent.useMutation({ onSuccess: changed, onError });
  const outdent = trpc.tasks.outdent.useMutation({
    onSuccess: changed,
    onError,
  });
  const remove = trpc.tasks.delete.useMutation({
    onSuccess: async () => {
      toast.success("Task deleted.");
      await changed();
    },
    onError,
  });
  const canEdit = can("task.edit");
  const canProgress = canEdit || can("task.progress");
  const all = q.data?.tasks ?? [];
  const filtering = !!(
    kind ||
    status ||
    health ||
    assignee ||
    critical ||
    search
  );
  const rows = useMemo(() => {
    const tasks = q.data?.tasks ?? [];
    const byId = new Map(tasks.map(t => [t.id, t]));
    const matches = new Set(
      tasks
        .filter(
          t =>
            (!kind || t.kind === kind) &&
            (!status || t.status === status) &&
            (!health || t.scheduleHealth === health) &&
            (!assignee ||
              t.assignments.some(a => a.userId === Number(assignee))) &&
            (!critical || (t.isCritical && !t.isSummary)) &&
            (!search ||
              `${t.wbs} ${t.name} ${t.location ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase()))
        )
        .map(t => t.id)
    );
    const included = new Set(matches);
    if (filtering)
      for (const id of matches) {
        let parent = byId.get(id)?.parentId;
        const seen = new Set<number>();
        while (parent && !seen.has(parent)) {
          seen.add(parent);
          included.add(parent);
          parent = byId.get(parent)?.parentId;
        }
      }
    const children = new Map<number | null, Task[]>();
    for (const t of tasks) {
      const parent = t.parentId && byId.has(t.parentId) ? t.parentId : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(t);
    }
    for (const siblings of children.values())
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const result: { task: Task; depth: number; context: boolean }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const t of children.get(parent) ?? []) {
        if (filtering && !included.has(t.id)) continue;
        result.push({
          task: t,
          depth,
          context: filtering && !matches.has(t.id),
        });
        if (filtering || !collapsed.has(t.id)) walk(t.id, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  }, [
    q.data,
    kind,
    status,
    health,
    assignee,
    critical,
    search,
    filtering,
    collapsed,
  ]);
  const ops = useTaskOps({
    projectId,
    tasks: all,
    dependencies: q.data?.dependencies ?? [],
    onChanged: changed,
  });
  const rollups = useMemo(() => buildRollups(all), [all]);
  useEffect(() => {
    setChecked(new Set());
    lastChecked.current = null;
  }, [projectId]);
  useEffect(() => {
    // Drop checked ids that no longer exist (deleted or moved to another job).
    setChecked(prev => {
      if (!prev.size) return prev;
      const ids = new Set(all.map(t => t.id));
      const next = new Set(Array.from(prev).filter(id => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [all]);
  const checkedIds = useMemo(() => Array.from(checked), [checked]);
  const selectionRollup = useMemo<Rollup>(() => {
    const leaves = leafIds(all, checkedIds);
    const byId = new Map(all.map(t => [t.id, t]));
    return rollupFor(byId, leaves, leaves.length !== 1 || checkedIds.length !== 1);
  }, [all, checkedIds]);
  function checkRow(id: number, index: number, event: MouseEvent) {
    event.stopPropagation();
    setChecked(prev => {
      const next = new Set(prev);
      const on = !prev.has(id);
      if (event.shiftKey && lastChecked.current != null) {
        const from = rows.findIndex(r => r.task.id === lastChecked.current);
        const [a, b] = from < 0 ? [index, index] : [Math.min(from, index), Math.max(from, index)];
        for (let i = a; i <= b; i++) {
          if (on) next.add(rows[i].task.id);
          else next.delete(rows[i].task.id);
        }
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    lastChecked.current = id;
  }
  const allVisibleChecked = rows.length > 0 && rows.every(r => checked.has(r.task.id));
  const someVisibleChecked = rows.some(r => checked.has(r.task.id));
  const drag = useWbsDrag({
    tasks: all,
    enabled: canEdit && !filtering && !ops.pending,
    selection: checked,
    expanded: id => !collapsed.has(id),
    onDrop: (ids, parentId, beforeId) => {
      ops.moveTasks(ids, parentId, beforeId);
    },
  });
  function rowKeys(event: KeyboardEvent<HTMLTableRowElement>, t: Task) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      open(t.id);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setChecked(prev => {
        const next = new Set(prev);
        next.has(t.id) ? next.delete(t.id) : next.add(t.id);
        return next;
      });
      lastChecked.current = t.id;
      return;
    }
    if (!event.altKey || !canEdit || structurePending || ops.pending) return;
    const sibs = siblings(t);
    const index = sibs.findIndex(x => x.id === t.id);
    if (event.key === "ArrowUp" && index > 0) moveRow(t, -1);
    else if (event.key === "ArrowDown" && index < sibs.length - 1) moveRow(t, 1);
    else if (event.key === "ArrowRight" && index > 0) indent.mutate({ id: t.id });
    else if (event.key === "ArrowLeft" && t.parentId) outdent.mutate({ id: t.id });
    else return;
    event.preventDefault();
  }
  function toggle(id: number) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function open(id: number) {
    setTaskId(id);
    navigate(`${location.split("?")[0]}?task=${id}`);
  }
  function close() {
    setTaskId(null);
    navigate(location.split("?")[0]);
  }
  function add(t: Task, kind: string, child: boolean) {
    setCreating({
      parentId: child ? t.id : t.parentId,
      afterId: child ? undefined : t.id,
      kind,
    });
  }
  function siblings(t: Task) {
    return all
      .filter(s => (s.parentId ?? null) === (t.parentId ?? null))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  function moveRow(t: Task, delta: number) {
    const index = siblings(t).findIndex(s => s.id === t.id);
    move.mutate({
      id: t.id,
      parentId: t.parentId,
      position: Math.max(0, index + delta),
    });
  }
  const structurePending =
    move.isPending || indent.isPending || outdent.isPending || remove.isPending;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--tp-rule)] bg-[var(--tp-paper)] px-5 py-3">
        <div className="label-caps mr-2">Sequences & Tasks</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCollapsed(new Set())}
        >
          Expand all
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setCollapsed(new Set(all.filter(t => t.isSummary).map(t => t.id)))
          }
        >
          Collapse all
        </Button>
        <div className="ml-auto text-[12px] text-muted-foreground">
          {canEdit
            ? filtering
              ? "Clear filters to drag rows. Check rows for bulk move, assign or shift."
              : "Drag ⠿ to reorder or drop onto a sequence. Check rows for bulk actions. Alt+arrows move the focused row."
            : "Inline edits save on blur. Automatic dates follow constraints."}
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setCreating({ parentId: null, kind: "sequence" })}
          >
            <Plus className="size-3.5" />
            Add sequence / task
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--tp-rule)] px-5 py-2">
        <div className="w-40">
          <SimpleSelect
            value={kind}
            onChange={setKind}
            options={TASK_KINDS}
            allowNone
            noneLabel="All kinds"
            size="sm"
          />
        </div>
        <div className="w-36">
          <SimpleSelect
            value={status}
            onChange={setStatus}
            options={TASK_STATUSES}
            allowNone
            noneLabel="All statuses"
            size="sm"
          />
        </div>
        <div className="w-36">
          <SimpleSelect
            value={health}
            onChange={setHealth}
            options={SCHEDULE_HEALTH}
            allowNone
            noneLabel="All health"
            size="sm"
          />
        </div>
        <div className="w-44">
          <SimpleSelect
            value={assignee}
            onChange={setAssignee}
            options={(ref?.users ?? []).map(u => ({
              value: String(u.id),
              label: u.name || `User ${u.id}`,
            }))}
            allowNone
            noneLabel="All assignees"
            size="sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[12px]">
          <Checkbox
            checked={critical}
            onCheckedChange={v => setCritical(v === true)}
          />
          Critical only
        </label>
        <Input
          className="ml-auto h-8 w-52 bg-[var(--tp-paper)]"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Task, WBS or location…"
          aria-label="Search tasks"
        />
        <span className="num text-[11px] text-muted-foreground">
          {rows.length} rows
        </span>
      </div>
      {canEdit && checked.size > 0 && (
        <div
          className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-[var(--tp-graphite)] bg-[var(--tp-solid)] px-5 py-2 text-white"
          role="toolbar"
          aria-label="Bulk actions for checked rows"
        >
          <span className="num text-[12.5px] font-semibold">
            {checked.size} row{checked.size === 1 ? "" : "s"} checked
          </span>
          <span className="num text-[11.5px] text-white/70">
            · {selectionRollup.leafIds.length} detail task{selectionRollup.leafIds.length === 1 ? "" : "s"}
          </span>
          <div className="ml-3 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              disabled={ops.pending}
              onClick={() => setMoveIds(checkedIds)}
            >
              <ArrowRightLeft className="size-3.5" /> Move to…
            </Button>
            <AssignPopover
              ops={ops}
              taskIds={checkedIds}
              rollup={selectionRollup}
              title={`${checked.size} checked row${checked.size === 1 ? "" : "s"}`}
              open={bulkAssignOpen}
              onOpenChange={setBulkAssignOpen}
            >
              <Button size="sm" variant="secondary" className="h-7" disabled={ops.pending || !selectionRollup.leafIds.length}>
                <UserPlus className="size-3.5" /> Assign…
              </Button>
            </AssignPopover>
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              disabled={ops.pending || !selectionRollup.leafIds.length}
              onClick={() => setShiftIds(checkedIds)}
            >
              <CalendarClock className="size-3.5" /> Shift dates…
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-white hover:bg-[var(--tp-solid-ink)]/10 hover:text-white"
            onClick={() => setChecked(new Set())}
          >
            <X className="size-3.5" /> Clear
          </Button>
        </div>
      )}
      {q.isLoading ? (
        <Loading label="Loading WBS…" />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !rows.length ? (
        <EmptyState
          icon={<FolderTree className="size-8" />}
          title={all.length ? "No matching tasks" : "No tasks planned"}
          body={
            all.length
              ? "Change the filters to show more tasks."
              : "Add the pre-construction tasks and erection sequences for this job."
          }
        />
      ) : (
        <div className="flex-1 overflow-x-auto">
          <table className="tp-table">
            <thead>
              <tr>
                <th className="w-[56px] !pr-0">
                  <span className="flex items-center gap-1">
                    <Checkbox
                      aria-label="Check all visible rows"
                      checked={allVisibleChecked ? true : someVisibleChecked ? "indeterminate" : false}
                      onCheckedChange={() =>
                        setChecked(prev => {
                          const next = new Set(prev);
                          if (allVisibleChecked) rows.forEach(r => next.delete(r.task.id));
                          else rows.forEach(r => next.add(r.task.id));
                          return next;
                        })
                      }
                    />
                  </span>
                </th>
                <th>WBS</th>
                <th>Sequence / task</th>
                <th>Location</th>
                <th className="right">Duration</th>
                <th className="right">Effort</th>
                <th>Start</th>
                <th>Finish</th>
                <th>Constraint</th>
                <th>Predecessors</th>
                <th>Assignments</th>
                <th>Complete</th>
                <th>Status</th>
                <th>Schedule</th>
                <th>CP</th>
                <th>Tons by stage / planned</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task: t, depth, context }, rowIndex) => {
                const sibs = siblings(t),
                  index = sibs.findIndex(s => s.id === t.id);
                const predecessors = (q.data?.dependencies ?? []).filter(
                  d => d.successorId === t.id
                );
                const Icon = t.isSummary
                  ? FolderTree
                  : t.kind === "sequence"
                    ? Layers
                    : t.kind === "milestone"
                      ? Diamond
                      : ListChecks;
                return (
                  <tr
                    key={t.id}
                    tabIndex={0}
                    aria-label={`${t.wbs ?? ""} ${t.name}`}
                    className={`${taskId === t.id ? "is-selected" : checked.has(t.id) ? "is-checked" : ""} ${context ? "text-muted-foreground" : ""} ${drag.rowClass(t.id)} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--tp-accent)]`}
                    onClick={() => open(t.id)}
                    onKeyDown={e => rowKeys(e, t)}
                    {...drag.rowProps(t)}
                  >
                    <td className="!pr-0" onClick={e => e.stopPropagation()}>
                      <span className="flex items-center gap-1">
                        <Checkbox
                          aria-label={`Check ${t.wbs ?? ""} ${t.name}`}
                          checked={checked.has(t.id)}
                          onClick={e => checkRow(t.id, rowIndex, e)}
                          onKeyDown={e => {
                            if (e.key === " ") e.stopPropagation();
                          }}
                        />
                        {canEdit && (
                          <span
                            {...drag.handleProps(t)}
                            role="button"
                            tabIndex={-1}
                            className={`tp-grip flex h-6 w-4 items-center justify-center ${filtering || ops.pending ? "pointer-events-none opacity-30" : ""}`}
                            title={
                              filtering
                                ? "Clear filters to drag rows"
                                : checked.has(t.id) && checked.size > 1
                                  ? `Drag ${checked.size} checked rows`
                                  : "Drag to reorder, or drop onto a sequence"
                            }
                            aria-label={`Drag ${t.name}`}
                          >
                            <GripVertical className="size-3.5" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num">
                      <button
                        className="font-medium hover:text-[var(--tp-accent-ink)]"
                        onClick={e => {
                          e.stopPropagation();
                          open(t.id);
                        }}
                      >
                        {t.wbs}
                      </button>
                    </td>
                    <td className="min-w-80">
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: depth * 16 }}
                      >
                        {t.isSummary ? (
                          <button
                            aria-label={
                              collapsed.has(t.id)
                                ? "Expand task"
                                : "Collapse task"
                            }
                            onClick={e => {
                              e.stopPropagation();
                              toggle(t.id);
                            }}
                          >
                            {!filtering && collapsed.has(t.id) ? (
                              <ChevronRight className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </button>
                        ) : (
                          <span className="w-3.5" />
                        )}
                        <Icon
                          className={`size-3.5 shrink-0 ${t.kind === "sequence" ? "text-[var(--tp-accent-ink)]" : "text-muted-foreground"}`}
                        />
                        <div
                          className={`min-w-40 flex-1 ${t.isSummary ? "font-semibold" : ""}`}
                        >
                          <InlineCell
                            key={`name:${t.name}`}
                            label={`Name for ${t.wbs}`}
                            value={t.name}
                            disabled={!canEdit}
                            onCommit={name =>
                              update.mutateAsync({ id: t.id, name })
                            }
                          />
                        </div>
                      </div>
                    </td>
                    <td className="text-[12px]">{t.location || "—"}</td>
                    <td className="w-20">
                      <InlineCell
                        key={`duration:${t.durationDays}`}
                        label={`Duration for ${t.wbs}`}
                        value={t.durationDays}
                        type="number"
                        min={0}
                        max={2000}
                        disabled={
                          !canEdit || t.isSummary || t.kind === "milestone"
                        }
                        onCommit={v =>
                          update.mutateAsync({
                            id: t.id,
                            durationDays: Number(v),
                          })
                        }
                      />
                    </td>
                    <td className="right num">{fmtHours(t.effortHours)}</td>
                    <td className="min-w-32">
                      {t.isSummary || !canEdit ? (
                        <span className="num">{fmtDateShort(t.startDate)}</span>
                      ) : (
                        <InlineCell
                          key={`start:${t.startDate}`}
                          label={`Start for ${t.wbs}`}
                          value={t.startDate}
                          type="date"
                          onCommit={v =>
                            t.schedulingMode === "auto" && v
                              ? dates.mutateAsync({ id: t.id, startDate: v })
                              : update.mutateAsync({
                                  id: t.id,
                                  startDate: v || null,
                                })
                          }
                        />
                      )}
                    </td>
                    <td className="min-w-32">
                      {t.schedulingMode === "manual" &&
                      canEdit &&
                      !t.isSummary ? (
                        <InlineCell
                          key={`finish:${t.finishDate}`}
                          label={`Finish for ${t.wbs}`}
                          value={t.finishDate}
                          type="date"
                          onCommit={v =>
                            update.mutateAsync({
                              id: t.id,
                              finishDate: v || null,
                            })
                          }
                        />
                      ) : (
                        <span className="num">
                          {fmtDateShort(t.finishDate)}
                        </span>
                      )}
                    </td>
                    <td
                      title={
                        CONSTRAINT_TYPES[
                          t.constraintType as keyof typeof CONSTRAINT_TYPES
                        ]
                      }
                      className={
                        t.constraintViolated
                          ? "hazard text-[var(--tp-red-strong)]"
                          : ""
                      }
                    >
                      <span className="num text-[11px]">
                        {t.constraintType.toUpperCase()}
                        {t.constraintDate
                          ? ` · ${fmtDateShort(t.constraintDate)}`
                          : ""}
                      </span>
                    </td>
                    <td
                      className="max-w-44 text-[11px]"
                      title={predecessors
                        .map(
                          d =>
                            `${all.find(p => p.id === d.predecessorId)?.name ?? q.data?.external.find(p => p.id === d.predecessorId)?.name ?? `Task ${d.predecessorId}`} ${d.type} ${d.lagDays}d`
                        )
                        .join("; ")}
                    >
                      <div className="truncate num">
                        {predecessors
                          .map(
                            d =>
                              `${all.find(p => p.id === d.predecessorId)?.wbs ?? `#${d.predecessorId}`} ${d.type}${d.lagDays ? `${d.lagDays > 0 ? "+" : ""}${d.lagDays}d` : ""}`
                          )
                          .join(", ") || "—"}
                      </div>
                    </td>
                    <td className="w-48 max-w-48" onClick={e => e.stopPropagation()}>
                      <AssignCell
                        ops={ops}
                        taskId={t.id}
                        title={`${t.wbs ?? ""} ${t.name}`}
                        rollup={rollups.get(t.id)}
                        editable={canEdit}
                      />
                    </td>
                    <td className="min-w-20">
                      <InlineCell
                        key={`pct:${t.percentComplete}`}
                        label={`Percent complete for ${t.wbs}`}
                        value={t.percentComplete}
                        type="number"
                        min={0}
                        max={100}
                        disabled={
                          !canProgress ||
                          t.isSummary ||
                          (t.kind === "sequence" &&
                            (data.project.progressMethod === "tonnage" ||
                              data.project.progressMethod === "pieces"))
                        }
                        onCommit={v =>
                          update.mutateAsync({
                            id: t.id,
                            percentComplete: Number(v),
                          })
                        }
                      />
                      <ProgressBar value={t.percentComplete} />
                    </td>
                    <td>
                      <Pill
                        tone={
                          t.status === "blocked"
                            ? "red"
                            : t.status === "done"
                              ? "blue"
                              : t.status === "in_progress"
                                ? "orange"
                                : "gray"
                        }
                      >
                        {TASK_STATUSES[
                          t.status as keyof typeof TASK_STATUSES
                        ] ?? t.status}
                      </Pill>
                    </td>
                    <td>
                      <ScheduleHealth value={t.scheduleHealth} />
                    </td>
                    <td>
                      {t.isCritical && !t.isSummary && (
                        <span
                          className="font-semibold text-[var(--tp-red-strong)]"
                          title={`Critical · ${t.totalFloat ?? 0} work days float`}
                        >
                          CP
                        </span>
                      )}
                    </td>
                    <td>
                      {t.kind === "sequence" ? <StageCell t={t} /> : "—"}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {canEdit && (
                          <>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-label={`Actions for ${t.name}`}
                                  size="icon"
                                  variant="ghost"
                                  disabled={structurePending}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Add below</DropdownMenuLabel>
                                {Object.entries(TASK_KINDS).map(
                                  ([kind, label]) => (
                                    <DropdownMenuItem
                                      key={`sibling:${kind}`}
                                      onClick={() => add(t, kind, false)}
                                    >
                                      <Plus className="size-3.5" />
                                      {label}
                                    </DropdownMenuItem>
                                  )
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>
                                  Add as child
                                </DropdownMenuLabel>
                                {Object.entries(TASK_KINDS).map(
                                  ([kind, label]) => (
                                    <DropdownMenuItem
                                      key={`child:${kind}`}
                                      onClick={() => add(t, kind, true)}
                                    >
                                      <Plus className="size-3.5" />
                                      {label}
                                    </DropdownMenuItem>
                                  )
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setMoveIds([t.id])}>
                                  <ArrowRightLeft className="size-3.5" />
                                  Move to sequence…
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!t.startDate}
                                  onClick={() => setShiftIds([t.id])}
                                >
                                  <CalendarClock className="size-3.5" />
                                  {t.isSummary ? "Shift sequence dates…" : "Shift dates…"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={index <= 0}
                                  onClick={() => indent.mutate({ id: t.id })}
                                >
                                  <Indent className="size-3.5" />
                                  Indent
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!t.parentId}
                                  onClick={() => outdent.mutate({ id: t.id })}
                                >
                                  <Outdent className="size-3.5" />
                                  Outdent
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={index <= 0}
                                  onClick={() => moveRow(t, -1)}
                                >
                                  <ArrowUp className="size-3.5" />
                                  Move up (Alt+↑)
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={index >= sibs.length - 1}
                                  onClick={() => moveRow(t, 1)}
                                >
                                  <ArrowDown className="size-3.5" />
                                  Move down (Alt+↓)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <ConfirmButton
                              destructive
                              size="icon"
                              variant="ghost"
                              title={`Delete "${t.name}"?`}
                              body={
                                t.isSummary
                                  ? "This removes the summary and all child tasks, assignments and dependency links."
                                  : "This removes the task, assignments and dependency links."
                              }
                              onConfirm={() => remove.mutate({ id: t.id })}
                              disabled={structurePending}
                            >
                              <Trash2 className="size-3.5" />
                            </ConfirmButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateTaskDrawer
          projectId={projectId}
          target={creating}
          onClose={() => setCreating(null)}
          onCreated={id => {
            setCreating(null);
            void changed();
            open(id);
          }}
        />
      )}
      <MoveToDialog
        open={!!moveIds}
        onOpenChange={o => !o && setMoveIds(null)}
        ops={ops}
        tasks={all}
        ids={moveIds ?? []}
      />
      <ShiftDialog
        open={!!shiftIds}
        onOpenChange={o => !o && setShiftIds(null)}
        ops={ops}
        ids={shiftIds ?? []}
        title={
          shiftIds?.length === 1
            ? `"${all.find(x => x.id === shiftIds[0])?.name ?? "task"}"`
            : `${shiftIds?.length ?? 0} rows`
        }
      />
      {ops.dialog}
      <TaskDrawer
        projectId={projectId}
        taskId={taskId}
        onClose={close}
        onChanged={() => void changed()}
      />
    </div>
  );
}
