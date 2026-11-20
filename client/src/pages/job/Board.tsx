import { SimpleSelect } from "@/components/ks/Controls";
import { EmptyState, ErrorState, Loading } from "@/components/ks/Layout";
import { PriorityBadge } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import {
  BOARD_DRAG_TYPE,
  TaskCard,
  type TaskStatus,
} from "@/features/board/TaskCard";
import { TaskDrawer } from "@/features/tasks/TaskDrawer";
import { AssignCell, buildRollups } from "@/features/tasks/AssignPopover";
import { useTaskOps } from "@/features/tasks/useTaskOps";
import { errMsg } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TASK_KINDS, TASK_STATUSES } from "@shared/domain";
import { Columns3, Layers3, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { useJob, useJobInvalidate, useSearchParam } from "./JobContext";

const STATUSES = Object.entries(TASK_STATUSES) as [TaskStatus, string][];
const PRIORITY_ORDER = ["critical", "high", "normal", "low"];
const STATUS_COLORS: Record<TaskStatus, string> = {
  not_started: "var(--ks-graphite-3)",
  in_progress: "var(--ks-accent)",
  blocked: "var(--ks-red-strong)",
  done: "var(--ks-green)",
};

export default function Board() {
  const { projectId, can } = useJob();
  const { userName, jobRoleName, equipmentName } = useRefData();
  const invalidate = useJobInvalidate();
  const query = trpc.tasks.list.useQuery({ projectId });
  const taskParam = useSearchParam("task");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [swimlanes, setSwimlanes] = useState(true);
  const [kind, setKind] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const editable = can("task.edit") || can("task.progress");
  const update = trpc.tasks.update.useMutation({
    onSuccess: async () => {
      await invalidate(projectId);
      toast.success("Task status updated.");
    },
    onError: error => toast.error(errMsg(error)),
  });
  const allTasks = query.data?.tasks;
  const canAssign = can("task.edit");
  const ops = useTaskOps({
    projectId,
    tasks: allTasks ?? [],
    dependencies: query.data?.dependencies ?? [],
    onChanged: () => invalidate(projectId),
  });
  const rollups = useMemo(() => buildRollups(allTasks ?? []), [allTasks]);
  const leaves = useMemo(() => {
    const tasks = allTasks ?? [];
    const parents = new Set(tasks.map(t => t.parentId).filter(Boolean));
    return tasks.filter(t => !t.isSummary && !parents.has(t.id));
  }, [allTasks]);
  const assigneeOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const task of leaves)
      for (const a of task.assignments) {
        if (a.userId) options.set(`u:${a.userId}`, userName(a.userId));
        if (a.jobRoleId)
          options.set(`r:${a.jobRoleId}`, `Role: ${jobRoleName(a.jobRoleId)}`);
        if (a.equipmentId)
          options.set(
            `e:${a.equipmentId}`,
            `Equipment: ${equipmentName(a.equipmentId)}`
          );
      }
    return [
      { value: "all", label: "All assignees" },
      { value: "unassigned", label: "Unassigned" },
      ...Array.from(options)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [leaves, userName, jobRoleName, equipmentName]);
  const filtered = useMemo(
    () =>
      leaves.filter(t => {
        if (kind !== "all" && t.kind !== kind) return false;
        if (assignee === "all") return true;
        if (assignee === "unassigned") return t.assignments.length === 0;
        const [type, rawId] = assignee.split(":");
        const id = Number(rawId);
        return t.assignments.some(a =>
          type === "u"
            ? a.userId === id
            : type === "r"
              ? a.jobRoleId === id
              : a.equipmentId === id
        );
      }),
    [leaves, kind, assignee]
  );
  const lanes = swimlanes ? PRIORITY_ORDER : ["all"];

  useEffect(() => {
    setTaskId(null);
    setDraggingId(null);
    setDropTarget(null);
    setKind("all");
    setAssignee("all");
  }, [projectId]);

  useEffect(() => {
    const id = Number(taskParam);
    if (taskParam && Number.isInteger(id) && id > 0) {
      setTaskId(id);
      setKind("all");
      setAssignee("all");
    }
  }, [taskParam, projectId]);
  useEffect(() => {
    if (taskId && boardRef.current)
      boardRef.current
        .querySelector(`[data-board-task="${taskId}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [taskId, filtered, swimlanes]);

  function changeStatus(id: number, status: TaskStatus) {
    const task = leaves.find(t => t.id === id);
    if (!editable || update.isPending || !task || task.status === status)
      return;
    update.mutate({ id, status });
  }
  function drop(event: DragEvent<HTMLDivElement>, status: TaskStatus) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData(BOARD_DRAG_TYPE));
    if (draggingId === id) changeStatus(id, status);
    setDraggingId(null);
    setDropTarget(null);
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

  if (query.isLoading) return <Loading label="Loading task board…" />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2">
          <Columns3 className="size-4 text-muted-foreground" />
          <h2 className="label-caps text-[11px] text-[var(--ks-ink)]">
            Task board
          </h2>
          <span className="num text-[11.5px] text-muted-foreground">
            {filtered.length} / {leaves.length} detail tasks
          </span>
        </div>
        <SimpleSelect
          value={kind}
          onChange={v => setKind(v ?? "all")}
          options={[
            { value: "all", label: "All kinds" },
            ...Object.entries(TASK_KINDS).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          size="sm"
          className="w-[170px]"
        />
        <SimpleSelect
          value={assignee}
          onChange={v => setAssignee(v ?? "all")}
          options={assigneeOptions}
          size="sm"
          className="w-[205px]"
        />
        <Button
          variant={swimlanes ? "secondary" : "outline"}
          size="sm"
          className="h-8"
          aria-pressed={swimlanes}
          onClick={() => setSwimlanes(v => !v)}
        >
          <Layers3 className="size-3.5" /> Priority lanes
        </Button>
        {(kind !== "all" || assignee !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              setKind("all");
              setAssignee("all");
            }}
          >
            <RotateCcw className="size-3.5" /> Clear filters
          </Button>
        )}
      </div>
      <div className="mb-3 text-[11.5px] text-muted-foreground">
        {editable
          ? "Drag a card to change status. Priority is unchanged. Use the card’s status control on touch or keyboard."
          : "Read-only board. Open a card to inspect its task."}
      </div>
      {!leaves.length ? (
        <EmptyState
          title="No detail tasks yet."
          body="Add erection sequences and tasks in Sequences & Tasks to populate this board."
        />
      ) : !filtered.length ? (
        <EmptyState
          title="No tasks match these filters."
          body="Clear the kind or assignee filter to see more tasks."
        />
      ) : (
        <div
          ref={boardRef}
          className="max-h-[calc(100vh-330px)] min-h-[300px] overflow-auto border border-[var(--ks-rule)] bg-[var(--ks-bone)]"
        >
          <div className="min-w-[980px]">
            <div className="sticky top-0 z-10 grid grid-cols-4 gap-px border-b border-[var(--ks-rule)] bg-[var(--ks-rule)]">
              {STATUSES.map(([status, label]) => (
                <div
                  key={status}
                  className="flex items-center gap-2 bg-[var(--ks-paper)] px-3 py-3"
                  style={{ borderTop: `3px solid ${STATUS_COLORS[status]}` }}
                >
                  <span className="label-caps text-[11px] text-[var(--ks-ink)]">
                    {label}
                  </span>
                  <span className="num ml-auto text-[12px] text-muted-foreground">
                    {filtered.filter(t => t.status === status).length}
                  </span>
                </div>
              ))}
            </div>
            {lanes.map(priority => {
              const laneTasks =
                priority === "all"
                  ? filtered
                  : filtered.filter(t => t.priority === priority);
              if (swimlanes && !laneTasks.length) return null;
              return (
                <section
                  key={priority}
                  aria-label={
                    priority === "all"
                      ? "All tasks"
                      : `${priority} priority tasks`
                  }
                >
                  {swimlanes && (
                    <div className="flex items-center gap-2 border-b border-[var(--ks-rule)] bg-[var(--ks-gray-soft)] px-3 py-1.5">
                      <PriorityBadge value={priority} />
                      <span className="num text-[11px] text-muted-foreground">
                        {laneTasks.length} tasks
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-4 divide-x divide-[var(--ks-rule)] border-b border-[var(--ks-rule)]">
                    {STATUSES.map(([status, label]) => {
                      const key = `${priority}:${status}`;
                      const cards = laneTasks.filter(t => t.status === status);
                      return (
                        <div
                          key={status}
                          className={cn(
                            "min-h-[150px] space-y-2 p-2",
                            dropTarget === key &&
                              "bg-[var(--ks-accent-soft)] outline outline-1 -outline-offset-1 outline-[var(--ks-accent)]"
                          )}
                          aria-label={`${priority === "all" ? "" : priority + " priority — "}${label}`}
                          onDragOver={event => {
                            if (
                              !editable ||
                              !draggingId ||
                              update.isPending ||
                              !event.dataTransfer.types.includes(
                                BOARD_DRAG_TYPE
                              )
                            )
                              return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDropTarget(key);
                          }}
                          onDragLeave={event => {
                            if (
                              !event.currentTarget.contains(
                                event.relatedTarget as Node | null
                              )
                            )
                              setDropTarget(null);
                          }}
                          onDrop={event => drop(event, status)}
                        >
                          {cards.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              editable={editable}
                              pending={update.isPending}
                              dragging={draggingId === task.id}
                              selected={taskId === task.id}
                              showPriority={!swimlanes}
                              onOpen={() => setTaskId(task.id)}
                              onStatus={value => changeStatus(task.id, value)}
                              assign={
                                canAssign ? (
                                  <AssignCell
                                    ops={ops}
                                    taskId={task.id}
                                    title={`${task.wbs ?? ""} ${task.name}`}
                                    rollup={rollups.get(task.id)}
                                    editable
                                    className="text-[11.5px]"
                                  />
                                ) : undefined
                              }
                              onDragStart={event => {
                                if (!editable || update.isPending) {
                                  event.preventDefault();
                                  return;
                                }
                                event.dataTransfer.setData(
                                  BOARD_DRAG_TYPE,
                                  String(task.id)
                                );
                                event.dataTransfer.effectAllowed = "move";
                                setDraggingId(task.id);
                              }}
                              onDragEnd={() => {
                                setDraggingId(null);
                                setDropTarget(null);
                              }}
                            />
                          ))}
                          {!cards.length && (
                            <div className="py-4 text-center text-[11px] text-muted-foreground">
                              {dropTarget === key
                                ? "Drop to change status"
                                : "No tasks"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
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
