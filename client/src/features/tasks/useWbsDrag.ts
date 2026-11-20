import { descendantIds, resolveDrop, zoneFor, type DropZone } from "@shared/taskOps";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { OpsTask } from "./useTaskOps";

export const WBS_DRAG_TYPE = "application/x-steelbuild-wbs";

/**
 * Handle-only HTML5 drag for WBS rows.
 * - Drag the grip; a checked row drags the whole checked selection.
 * - Top quarter = above, bottom quarter = below, middle = into a sequence / summary.
 */
export function useWbsDrag({
  tasks,
  enabled,
  selection,
  expanded,
  onDrop,
}: {
  tasks: OpsTask[];
  enabled: boolean;
  selection: Set<number>;
  expanded: (id: number) => boolean;
  onDrop: (ids: number[], parentId: number | null, beforeId: number | null) => void;
}) {
  const [dragIds, setDragIds] = useState<number[] | null>(null);
  const [over, setOver] = useState<{ id: number; zone: DropZone } | null>(null);
  const overRef = useRef(over);
  overRef.current = over;
  const hasKids = useMemo(() => new Set(tasks.map(t => t.parentId).filter((p): p is number => p != null)), [tasks]);
  const blocked = useMemo(() => {
    const out = new Set<number>();
    for (const id of dragIds ?? []) {
      out.add(id);
      for (const d of descendantIds(tasks, id)) out.add(d);
    }
    return out;
  }, [dragIds, tasks]);
  const canNest = (t: OpsTask) => t.isSummary || t.kind === "sequence" || hasKids.has(t.id);

  function clear() {
    setDragIds(null);
    setOver(null);
  }
  // Fallbacks: the source row can unmount mid-drag (virtualized Gantt rows), so React's
  // onDragEnd may never arrive. A mousemove only fires once the drag is over.
  useEffect(() => {
    if (!dragIds) return;
    const reset = () => clear();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clear();
    const onDrop = () => setTimeout(clear, 0);
    document.addEventListener("mousemove", reset);
    document.addEventListener("keydown", onKey);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", reset, true);
    return () => {
      document.removeEventListener("mousemove", reset);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", reset, true);
    };
  }, [dragIds]);

  function handleProps(task: OpsTask) {
    return {
      draggable: enabled,
      "aria-roledescription": "drag handle",
      onDragStart(event: DragEvent<HTMLElement>) {
        if (!enabled) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        // Native listener on the source node still fires if React unmounts the row mid-drag.
        event.currentTarget.addEventListener("dragend", () => clear(), { once: true });
        const ids = selection.has(task.id) && selection.size > 1 ? Array.from(selection) : [task.id];
        event.dataTransfer.setData(WBS_DRAG_TYPE, JSON.stringify(ids));
        event.dataTransfer.setData("text/plain", ids.length === 1 ? task.name : `${ids.length} tasks`);
        event.dataTransfer.effectAllowed = "move";
        const row = event.currentTarget.closest("tr");
        if (ids.length > 1) {
          const ghost = document.createElement("div");
          ghost.textContent = `${ids.length} rows`;
          ghost.style.cssText =
            "position:fixed;top:-100px;left:-100px;padding:4px 10px;background:var(--ks-solid);color:var(--ks-solid-ink);font:500 12px Inter,system-ui;border-left:3px solid var(--ks-brand);border-radius:6px";
          document.body.appendChild(ghost);
          event.dataTransfer.setDragImage(ghost, 12, 12);
          setTimeout(() => ghost.remove(), 0);
        } else if (row) {
          event.dataTransfer.setDragImage(row, 24, row.clientHeight / 2);
        }
        // Defer so the browser snapshots the row before it fades.
        setTimeout(() => setDragIds(ids), 0);
      },
      onDragEnd: clear,
    };
  }

  function rowProps(task: OpsTask) {
    if (!dragIds) return {};
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (blocked.has(task.id)) {
          if (overRef.current) setOver(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = zoneFor(event.clientY - rect.top, rect.height, canNest(task));
        const cur = overRef.current;
        if (!cur || cur.id !== task.id || cur.zone !== zone) setOver({ id: task.id, zone });
      },
      onDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        const ids = dragIds;
        const zone = overRef.current?.id === task.id ? overRef.current.zone : null;
        clear();
        if (!ids || !zone || blocked.has(task.id)) return;
        const target = resolveDrop(tasks, task.id, zone, expanded);
        if (target) onDrop(ids, target.parentId, target.beforeId);
      },
    };
  }

  /** Row class for drop indicators and the faded dragged rows. */
  function rowClass(id: number) {
    if (dragIds && blocked.has(id)) return "ks-dragging";
    if (over?.id !== id) return "";
    return over.zone === "before" ? "ks-drop-before" : over.zone === "after" ? "ks-drop-after" : "ks-drop-into";
  }

  return { dragging: !!dragIds, dragIds, over, handleProps, rowProps, rowClass };
}
