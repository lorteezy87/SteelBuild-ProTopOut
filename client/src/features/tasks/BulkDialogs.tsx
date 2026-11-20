import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { childrenOf, descendantIds, topLevelSelection, wbsOrder } from "@shared/taskOps";
import { CornerDownRight, FolderTree, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OpsTask, TaskOps } from "./useTaskOps";

/** Pick a sequence / summary (or the job's top level) to move rows into. */
export function MoveToDialog({
  open,
  onOpenChange,
  ops,
  tasks,
  ids,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ops: TaskOps;
  tasks: OpsTask[];
  ids: number[];
}) {
  const options = useMemo(() => {
    if (!open) return [];
    const kids = childrenOf(tasks);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const blocked = new Set<number>();
    for (const id of ids) {
      blocked.add(id);
      for (const d of descendantIds(tasks, id)) blocked.add(d);
    }
    const depth = (t: OpsTask) => {
      let n = 0;
      let p = t.parentId;
      const seen = new Set<number>();
      while (p != null && byId.has(p) && !seen.has(p)) {
        seen.add(p);
        n++;
        p = byId.get(p)!.parentId;
      }
      return n;
    };
    return wbsOrder(tasks)
      .map(id => byId.get(id)!)
      .filter(t => !blocked.has(t.id) && (kids.has(t.id) || t.isSummary || t.kind === "sequence"))
      .map(t => ({ task: t, depth: depth(t), summary: kids.has(t.id) }));
  }, [open, tasks, ids]);
  const moving = topLevelSelection(tasks, ids);
  const names = moving.map(id => tasks.find(t => t.id === id)?.name).filter(Boolean);
  const choose = (parentId: number | null) => {
    if (ops.moveTasks(moving, parentId, null)) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Move {moving.length === 1 ? `"${names[0]}"` : `${moving.length} rows`} to…</DialogTitle>
          <DialogDescription>
            Rows land at the end of the chosen sequence with their subtasks. Drag rows in the grid for an exact position.
          </DialogDescription>
        </DialogHeader>
        <Command className="border-t border-[var(--ks-rule)]">
          <CommandInput placeholder="Search sequences and summaries…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No sequence matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="top level job root" onSelect={() => choose(null)} disabled={ops.pending}>
                <CornerDownRight className="size-3.5 text-muted-foreground" />
                Top level of the job
              </CommandItem>
              {options.map(({ task, depth, summary }) => (
                <CommandItem
                  key={task.id}
                  value={`${task.wbs ?? ""} ${task.name} #${task.id}`}
                  onSelect={() => choose(task.id)}
                  disabled={ops.pending}
                >
                  <span style={{ width: depth * 14 }} className="shrink-0" />
                  {summary ? (
                    <FolderTree className="size-3.5 text-muted-foreground" />
                  ) : (
                    <Layers className="size-3.5 text-[var(--ks-accent-ink)]" />
                  )}
                  <span className="num w-12 shrink-0 text-[11px] text-muted-foreground">{task.wbs}</span>
                  <span className="truncate">{task.name}</span>
                  {!summary && <span className="ml-auto text-[10.5px] text-muted-foreground">becomes summary</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Shift selected rows (summaries expand to their tasks) by ± work days. */
export function ShiftDialog({
  open,
  onOpenChange,
  ops,
  ids,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ops: TaskOps;
  ids: number[];
  title: string;
}) {
  const [days, setDays] = useState("5");
  const inFlight = useRef(false);
  useEffect(() => {
    if (open) setDays("5");
  }, [open]);
  const n = Math.trunc(Number(days));
  const valid = Number.isFinite(n) && n !== 0 && Math.abs(n) <= 260;
  const apply = async () => {
    if (!valid || ops.pending || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await ops.shift(ids, n);
      if (res) onOpenChange(false);
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Shift dates — {title}</DialogTitle>
          <DialogDescription>
            Moves every detail task under the selection by work days on the job calendar (weekends and holidays skipped).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {[-5, -1, 1, 5, 10].map(v => (
            <Button key={v} size="sm" variant={n === v ? "secondary" : "outline"} className="h-8 w-12" onClick={() => setDays(String(v))}>
              {v > 0 ? `+${v}` : v}
            </Button>
          ))}
          <Input
            aria-label="Work days to shift"
            className="num h-8 w-20 bg-[var(--ks-paper)] text-right"
            value={days}
            disabled={ops.pending}
            onChange={e => setDays(e.target.value.replace(/[^0-9-]/g, ""))}
            onKeyDown={e => e.key === "Enter" && void apply()}
          />
          <span className="text-[12px] text-muted-foreground">work days</span>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
          <li>Automatic tasks get Start No Earlier Than = current start {valid ? (n > 0 ? `+${n}` : n) : "±n"}; tasks driven by another selected task follow their logic.</li>
          <li>Manual tasks shift start and finish. MSO / MFO / FNLT constraint dates shift too.</li>
          <li>Started or complete tasks keep their actual dates. Predecessors outside the selection can still hold a task.</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || ops.pending} onClick={() => void apply()}>
            Shift {valid ? `${n > 0 ? "+" : ""}${n}` : ""} work days
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
