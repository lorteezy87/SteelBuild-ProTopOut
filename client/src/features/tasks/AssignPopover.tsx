import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRefData } from "@/lib/ref";
import { cn } from "@/lib/utils";
import { childrenOf, leafIds, resourceKey, type WbsNode } from "@shared/taskOps";
import { Check, HardHat, Truck, User, UserPlus, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { TaskOps } from "./useTaskOps";

export type AssignmentLike = {
  userId: number | null;
  jobRoleId: number | null;
  equipmentId: number | null;
  allocationPct: number;
};
export type RollupItem = { key: string; ref: AssignmentLike; count: number };
/** Assignments on a task, or the union over a summary's / selection's detail tasks. */
export type Rollup = {
  leafIds: number[];
  items: RollupItem[];
  summary: boolean;
  byLeaf: Map<number, AssignmentLike[]>;
};

/** Union of assignments over `leaves`, with per-leaf rows for coverage checks. */
export function rollupFor(
  byId: Map<number, { assignments: AssignmentLike[] }>,
  leaves: number[],
  summary: boolean
): Rollup {
  const items = new Map<string, RollupItem>();
  const byLeaf = new Map<number, AssignmentLike[]>();
  for (const id of leaves) {
    const list = byId.get(id)?.assignments ?? [];
    byLeaf.set(id, list);
    for (const a of list) {
      const key = resourceKey(a);
      const hit = items.get(key);
      if (hit) hit.count++;
      else items.set(key, { key, ref: a, count: 1 });
    }
  }
  return { leafIds: leaves, items: Array.from(items.values()), summary, byLeaf };
}

/** One rollup per task id. Summary rows union their detail tasks' assignments. */
export function buildRollups(
  tasks: (WbsNode & { assignments: AssignmentLike[] })[]
): Map<number, Rollup> {
  const kids = childrenOf(tasks);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const out = new Map<number, Rollup>();
  for (const t of tasks) {
    const summary = kids.has(t.id);
    out.set(t.id, rollupFor(byId, summary ? leafIds(tasks, [t.id]) : [t.id], summary));
  }
  return out;
}

export function useAssignmentLabel() {
  const { userName, jobRoleName, equipmentName } = useRefData();
  return (a: Pick<AssignmentLike, "userId" | "jobRoleId" | "equipmentId">) => {
    if (a.userId) return a.jobRoleId ? `${userName(a.userId)} (${jobRoleName(a.jobRoleId)})` : userName(a.userId);
    if (a.equipmentId) return equipmentName(a.equipmentId);
    return jobRoleName(a.jobRoleId);
  };
}

function KindIcon({ a, className }: { a: Pick<AssignmentLike, "userId" | "equipmentId">; className?: string }) {
  const Icon = a.userId ? User : a.equipmentId ? Truck : HardHat;
  return <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-hidden />;
}

function AllocInput({ value, disabled, onCommit, label }: { value: number; disabled?: boolean; onCommit: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < 1 || n > 400) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <span className="flex items-center gap-0.5">
      <input
        aria-label={label}
        className="num h-6 w-12 rounded border border-[var(--tp-rule)] bg-[var(--tp-paper)] px-1 text-right text-[11.5px]"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <span className="text-[10.5px] text-muted-foreground">%</span>
    </span>
  );
}

/**
 * Searchable people / crew roles / equipment picker. Applies to one task or,
 * for summary rows and multi-selections, to every covered detail task.
 */
export function AssignPopover({
  ops,
  taskIds,
  rollup,
  title,
  children,
  align = "start",
  open: controlledOpen,
  onOpenChange,
}: {
  ops: TaskOps;
  taskIds: number[];
  rollup: Rollup;
  title: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { ref } = useRefData();
  const labelOf = useAssignmentLabel();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [alloc, setAlloc] = useState(100);
  const total = rollup.leafIds.length;
  const single = total === 1 && !rollup.summary && taskIds.length === 1;
  const users = (ref?.users ?? []).filter(u => u.isActive);
  const roles = (ref?.jobRoles ?? []).filter(r => r.isActive);
  const gear = (ref?.equipment ?? []).filter(e => e.isActive);
  const roleName = (id: number | null) => roles.find(r => r.id === id)?.name ?? "";
  const busy = ops.pending;
  type Match = (a: AssignmentLike) => boolean;
  /** Detail tasks that already carry the resource (any role/equipment tuple), and those tuples. */
  const coverage = (match: Match) => {
    const covered = rollup.leafIds.filter(id => (rollup.byLeaf.get(id) ?? []).some(match));
    const tuples = rollup.items.filter(i => match(i.ref)).map(i => i.ref);
    return { covered, tuples };
  };

  async function pick(match: Match, resource: Partial<AssignmentLike>, name: string) {
    const { covered, tuples } = coverage(match);
    if (total > 0 && covered.length === total) {
      // On every covered task already: click again removes it everywhere (all tuples).
      await ops.assign(taskIds, "remove", tuples, name);
      return;
    }
    const have = new Set(covered);
    const lacking = rollup.leafIds.filter(id => !have.has(id));
    if (lacking.length) await ops.assign(lacking, "add", [{ ...resource, allocationPct: alloc }], name);
  }

  const status = (match: Match) => {
    const n = coverage(match).covered.length;
    return !n ? null : n === total ? (
      <Check className="size-3.5 text-[var(--tp-accent-ink)]" aria-label="Assigned" />
    ) : (
      <span className="num text-[10.5px] text-muted-foreground" title={`On ${n} of ${total} tasks — click to add to the rest`}>
        {n}/{total}
      </span>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[340px] p-0"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <div className="border-b border-[var(--tp-rule)] px-3 py-2">
          <div className="label-caps">Assign crew & equipment</div>
          <div className="truncate text-[12.5px] font-semibold" title={title}>
            {title}
          </div>
          {!single && (
            <div className="text-[11px] text-muted-foreground">
              Applies to {total} detail task{total === 1 ? "" : "s"}. Workload counts detail tasks only.
            </div>
          )}
        </div>
        {rollup.items.length > 0 && (
          <div className="max-h-40 overflow-auto border-b border-[var(--tp-rule)] px-2 py-1.5">
            {rollup.items.map(item => {
              const name = labelOf(item.ref);
              return (
                <div key={item.key} className="flex items-center gap-2 py-0.5 text-[12px]">
                  <KindIcon a={item.ref} />
                  <span className="min-w-0 flex-1 truncate" title={name}>
                    {name}
                  </span>
                  {single ? (
                    <AllocInput
                      label={`Allocation for ${name}`}
                      value={item.ref.allocationPct}
                      disabled={busy}
                      onCommit={v => void ops.assign(taskIds, "add", [{ ...item.ref, allocationPct: v }], name)}
                    />
                  ) : (
                    <span className="num text-[10.5px] text-muted-foreground" title={`On ${item.count} of ${total} tasks`}>
                      {item.count}/{total}
                    </span>
                  )}
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--tp-gray-soft)] hover:text-[var(--tp-red-strong)] disabled:opacity-40"
                    aria-label={`Remove ${name}`}
                    title={single ? "Remove" : `Remove from all ${total} tasks`}
                    disabled={busy}
                    onClick={() => void ops.assign(taskIds, "remove", [item.ref], name)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <Command>
          <CommandInput placeholder="Search people, crew roles, equipment…" />
          <div className="flex items-center gap-2 border-b border-[var(--tp-rule)] px-3 py-1.5 text-[11px] text-muted-foreground">
            New assignments at
            <AllocInput label="Allocation for new assignments" value={alloc} onCommit={setAlloc} />
            <span className="ml-auto" title="Crew roles: 100% per person">
              400% = 4-person crew
            </span>
          </div>
          <CommandList className="max-h-64">
            <CommandEmpty>No match.</CommandEmpty>
            {users.length > 0 && (
              <CommandGroup heading="People">
                {users.map(u => {
                  const match = (a: AssignmentLike) => a.userId === u.id;
                  const name = u.name || `User ${u.id}`;
                  return (
                    <CommandItem
                      key={`u${u.id}`}
                      value={`person ${name} ${roleName(u.jobRoleId)} u${u.id}`}
                      disabled={busy}
                      onSelect={() => void pick(match, { userId: u.id }, name)}
                    >
                      <User className="size-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate">{name}</span>
                      <span className="truncate text-[10.5px] text-muted-foreground">{roleName(u.jobRoleId)}</span>
                      {status(match)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {roles.length > 0 && (
              <CommandGroup heading="Crew roles (unnamed demand)">
                {roles.map(r => {
                  const match = (a: AssignmentLike) => a.jobRoleId === r.id && !a.userId && !a.equipmentId;
                  return (
                    <CommandItem
                      key={`r${r.id}`}
                      value={`role ${r.name} r${r.id}`}
                      disabled={busy}
                      onSelect={() => void pick(match, { jobRoleId: r.id }, r.name)}
                    >
                      <HardHat className="size-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate">{r.name}</span>
                      {status(match)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {gear.length > 0 && (
              <CommandGroup heading="Equipment">
                {gear.map(e => {
                  const match = (a: AssignmentLike) => a.equipmentId === e.id && !a.userId;
                  return (
                    <CommandItem
                      key={`e${e.id}`}
                      value={`equipment ${e.name} ${e.type} ${e.capacity ?? ""} e${e.id}`}
                      disabled={busy}
                      onSelect={() => void pick(match, { equipmentId: e.id }, e.name)}
                    >
                      <Truck className="size-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate">{e.name}</span>
                      <span className="truncate text-[10.5px] text-muted-foreground">{e.capacity ?? e.type}</span>
                      {status(match)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {!single && rollup.items.length > 0 && (
          <div className="flex justify-end border-t border-[var(--tp-rule)] px-2 py-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11.5px] text-[var(--tp-red-strong)]"
              disabled={busy}
              onClick={() => void ops.assign(taskIds, "replace", [], "all resources")}
            >
              Clear all from {total} tasks
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Compact assignment display + popover trigger for grid cells and cards. */
export function AssignCell({
  ops,
  taskId,
  title,
  rollup,
  editable,
  className,
  emptyLabel = "Unassigned",
}: {
  ops: TaskOps;
  taskId: number;
  title: string;
  rollup: Rollup | undefined;
  editable: boolean;
  className?: string;
  emptyLabel?: string;
}) {
  const labelOf = useAssignmentLabel();
  const r: Rollup = rollup ?? { leafIds: [taskId], items: [], summary: false, byLeaf: new Map() };
  const names = r.items.map(i => labelOf(i.ref));
  const text = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : r.summary ? "—" : emptyLabel;
  const tip = r.items.map(i => `${labelOf(i.ref)} · ${r.summary ? `${i.count}/${r.leafIds.length} tasks` : `${i.ref.allocationPct}%`}`).join("\n");
  const body = (
    <span className={cn("flex min-w-0 items-center gap-1", !names.length && "text-muted-foreground", r.summary && "italic text-[var(--tp-ink-2)]")}>
      {editable && <UserPlus className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="truncate">{text}</span>
    </span>
  );
  if (!editable)
    return (
      <span className={cn("block truncate text-[11px]", className)} title={tip || undefined}>
        {body}
      </span>
    );
  return (
    <AssignPopover ops={ops} taskIds={[taskId]} rollup={r} title={title}>
      <button
        type="button"
        className={cn(
          "block w-full min-w-0 rounded px-1 py-0.5 text-left text-[11px] hover:bg-[var(--tp-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--tp-accent)]",
          className
        )}
        title={tip ? `${tip}\nClick to change` : r.summary ? "Assign to every task in this sequence" : "Click to assign"}
        aria-label={`Assignments for ${title}: ${names.join(", ") || "none"}. Change`}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {body}
      </button>
    </AssignPopover>
  );
}
