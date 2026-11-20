import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { planMove, type ResourceRef } from "@shared/taskOps";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

export type OpsTask = {
  id: number;
  parentId: number | null;
  sortOrder: number;
  name: string;
  wbs: string | null;
  kind: string;
  isSummary: boolean;
};
export type OpsDependency = { predecessorId: number; successorId: number };
export type AssignResource = ResourceRef & { allocationPct?: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Move / assign / shift operations shared by Sequences & Tasks, the Gantt and
 * the Board. Render `dialog` once in the consuming page.
 */
export function useTaskOps({
  projectId,
  tasks,
  dependencies,
  onChanged,
}: {
  projectId: number;
  tasks: OpsTask[];
  dependencies: OpsDependency[];
  onChanged: () => Promise<unknown> | void;
}) {
  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: ReactNode;
    action: string;
    run: () => Promise<void>;
  } | null>(null);
  const bulkMove = trpc.tasks.bulkMove.useMutation();
  const bulkAssign = trpc.tasks.bulkAssign.useMutation();
  const shiftDates = trpc.tasks.shiftDates.useMutation();
  const pending = bulkMove.isPending || bulkAssign.isPending || shiftDates.isPending;

  const label = (id: number) => {
    const t = byId.get(id);
    return t ? `"${t.name}"` : `task ${id}`;
  };

  /** Returns false when the move is a no-op or invalid (nothing sent). */
  function moveTasks(ids: number[], parentId: number | null, beforeId: number | null): boolean {
    const plan = planMove(tasks, ids, parentId, beforeId);
    if (!plan.ok) {
      if (plan.error !== "Already in that position") toast.error(plan.error);
      return false;
    }
    const parent = parentId != null ? byId.get(parentId) : null;
    const links =
      parentId != null
        ? dependencies.filter(d => d.predecessorId === parentId || d.successorId === parentId).length
        : 0;
    const what = plan.moved.length === 1 ? label(plan.moved[0]) : plural(plan.moved.length, "task");
    const where = parent ? `into "${parent.name}"` : "to the top level";
    const run = async () => {
      try {
        const res = await bulkMove.mutateAsync({ projectId, ids: plan.moved, parentId, beforeId });
        await onChanged();
        toast.success(`Moved ${what} ${where}.`, {
          description: res.removedLinks
            ? `${plural(res.removedLinks, "dependency link")} on "${parent?.name}" removed — summary rows roll up from their tasks.`
            : "WBS renumbered and schedule recalculated.",
        });
      } catch (error) {
        toast.error(errMsg(error));
      }
    };
    if (parent && links > 0 && plan.parentBecomesSummary) {
      setConfirm({
        title: `Turn "${parent.name}" into a summary?`,
        body: (
          <>
            Moving {what} under it makes it a summary row. Summary dates roll up from
            their detail tasks and can't carry logic, so its{" "}
            <b>{plural(links, "dependency link")}</b> will be removed. Re-link the
            detail tasks afterward if the sequence logic still applies.
          </>
        ),
        action: "Move and remove links",
        run,
      });
    } else void run();
    return true;
  }

  async function assign(taskIds: number[], mode: "add" | "remove" | "replace", resources: AssignResource[], name?: string) {
    try {
      const res = await bulkAssign.mutateAsync({
        projectId,
        taskIds,
        mode,
        resources: resources.map(r => ({
          userId: r.userId ?? null,
          jobRoleId: r.jobRoleId ?? null,
          equipmentId: r.equipmentId ?? null,
          allocationPct: r.allocationPct ?? 100,
        })),
      });
      await onChanged();
      if (!res.changed) {
        toast.message("No change — those assignments were already in place.");
        return res;
      }
      const who = name ?? plural(resources.length, "resource");
      const scope = res.changed === 1 && taskIds.length === 1 ? label(taskIds[0]) : plural(res.changed, "task");
      toast.success(
        mode === "remove" ? `Removed ${who} from ${scope}.` : mode === "replace" ? `Updated crew on ${scope}.` : `Assigned ${who} to ${scope}.`
      );
      return res;
    } catch (error) {
      toast.error(errMsg(error));
      return null;
    }
  }

  async function shift(ids: number[], workDays: number) {
    try {
      const res = await shiftDates.mutateAsync({ projectId, ids, workDays });
      await onChanged();
      const notes = [
        res.held ? `${plural(res.held, "task")} held by logic outside the selection${res.heldNames.length ? `: ${res.heldNames.join(", ")}` : ""}.` : "",
        res.skippedStarted ? `${plural(res.skippedStarted, "started task")} kept actual dates.` : "",
      ].filter(Boolean);
      const msg = `Shifted ${plural(res.shifted, "task")} ${workDays > 0 ? "+" : ""}${workDays} work day${Math.abs(workDays) === 1 ? "" : "s"}.`;
      if (res.held) toast.warning(msg, { description: notes.join(" ") });
      else toast.success(msg, { description: notes.join(" ") || "Schedule recalculated." });
      return res;
    } catch (error) {
      toast.error(errMsg(error));
      return null;
    }
  }

  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={open => !open && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-[13px] leading-relaxed text-muted-foreground">{confirm?.body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const run = confirm?.run;
              setConfirm(null);
              if (run) void run();
            }}
          >
            {confirm?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { moveTasks, assign, shift, pending, dialog };
}

export type TaskOps = ReturnType<typeof useTaskOps>;
