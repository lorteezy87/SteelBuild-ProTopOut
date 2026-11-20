/**
 * Pure WBS operations shared by the server (authoritative) and the client
 * (drop previews, pickers). No database or React imports here.
 */

export type WbsNode = { id: number; parentId: number | null; sortOrder: number };

export type DropZone = "before" | "after" | "into";

function bySort(a: WbsNode, b: WbsNode) {
  return a.sortOrder - b.sortOrder || a.id - b.id;
}

/** Children per parent, sorted the way the grid shows them. Orphans go to the root. */
export function childrenOf(nodes: WbsNode[]): Map<number | null, WbsNode[]> {
  const ids = new Set(nodes.map(n => n.id));
  const map = new Map<number | null, WbsNode[]>();
  for (const n of nodes) {
    const parent = n.parentId != null && ids.has(n.parentId) ? n.parentId : null;
    const list = map.get(parent) ?? [];
    list.push(n);
    map.set(parent, list);
  }
  for (const list of map.values()) list.sort(bySort);
  return map;
}

/** Depth-first WBS order (the order rows appear when fully expanded). */
export function wbsOrder(nodes: WbsNode[]): number[] {
  const kids = childrenOf(nodes);
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null) => {
    for (const n of kids.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n.id);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

/** All descendants of `rootId` (not including the root). */
export function descendantIds(nodes: WbsNode[], rootId: number): number[] {
  const kids = childrenOf(nodes);
  const out: number[] = [];
  const stack = [...(kids.get(rootId) ?? [])].reverse();
  const seen = new Set<number>([rootId]);
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n.id);
    stack.push(...[...(kids.get(n.id) ?? [])].reverse());
  }
  return out;
}

/**
 * Drop ids whose ancestor is also selected (moving the ancestor moves them),
 * keep only known ids, and return them in WBS order.
 */
export function topLevelSelection(nodes: WbsNode[], ids: Iterable<number>): number[] {
  const wanted = new Set(ids);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const keep = new Set<number>();
  for (const id of wanted) {
    if (!byId.has(id)) continue;
    let parent = byId.get(id)!.parentId;
    let covered = false;
    const guard = new Set<number>();
    while (parent != null && !guard.has(parent)) {
      guard.add(parent);
      if (wanted.has(parent)) {
        covered = true;
        break;
      }
      parent = byId.get(parent)?.parentId ?? null;
    }
    if (!covered) keep.add(id);
  }
  return wbsOrder(nodes).filter(id => keep.has(id));
}

/** Detail (leaf) tasks covered by a selection: summaries expand to their leaves. */
export function leafIds(nodes: WbsNode[], ids: Iterable<number>): number[] {
  const kids = childrenOf(nodes);
  const out = new Set<number>();
  for (const id of ids) {
    if (!kids.has(id)) {
      if (nodes.some(n => n.id === id)) out.add(id);
      continue;
    }
    for (const d of descendantIds(nodes, id)) if (!kids.has(d)) out.add(d);
  }
  return wbsOrder(nodes).filter(id => out.has(id));
}

export type MovePlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Top-level ids actually moved, in WBS order. */
      moved: number[];
      /** New full sibling order under `parentId`. */
      order: number[];
      parentId: number | null;
      /** True when the new parent had no children before this move. */
      parentBecomesSummary: boolean;
    };

/**
 * Plan moving `ids` (with their subtrees) under `parentId`, placed before
 * `beforeId` (null = at the end). Relative WBS order of the moved rows is kept.
 */
export function planMove(
  nodes: WbsNode[],
  ids: Iterable<number>,
  parentId: number | null,
  beforeId: number | null
): MovePlan {
  const moved = topLevelSelection(nodes, ids);
  if (!moved.length) return { ok: false, error: "Nothing to move" };
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (parentId != null && !byId.has(parentId)) return { ok: false, error: "Target sequence not found" };
  const blocked = new Set<number>();
  for (const id of moved) {
    blocked.add(id);
    for (const d of descendantIds(nodes, id)) blocked.add(d);
  }
  if (parentId != null && blocked.has(parentId)) {
    return { ok: false, error: "A task cannot be moved under itself" };
  }
  const kids = childrenOf(nodes);
  const siblings = (kids.get(parentId) ?? []).map(n => n.id);
  const remaining = siblings.filter(id => !blocked.has(id));
  let at = remaining.length;
  if (beforeId != null) {
    // If the anchor itself is moving, anchor on the next sibling that stays.
    const start = siblings.indexOf(beforeId);
    if (start < 0) return { ok: false, error: "Drop position is not inside the target sequence" };
    const anchor = siblings.slice(start).find(id => !blocked.has(id));
    at = anchor != null ? remaining.indexOf(anchor) : remaining.length;
  }
  const order = [...remaining.slice(0, at), ...moved, ...remaining.slice(at)];
  const unchanged =
    moved.every(id => (byId.get(id)!.parentId ?? null) === parentId) &&
    order.length === siblings.length &&
    order.every((id, i) => id === siblings[i]);
  if (unchanged) return { ok: false, error: "Already in that position" };
  const parentBecomesSummary = parentId != null && !kids.has(parentId);
  return { ok: true, moved, order, parentId, parentBecomesSummary };
}

/**
 * Translate a drop on a visible row into (parentId, beforeId).
 * - before: same parent as the target, placed above it
 * - into: last child of the target
 * - after: below the target; on an expanded summary that means "first child"
 */
export function resolveDrop(
  nodes: WbsNode[],
  targetId: number,
  zone: DropZone,
  expanded: (id: number) => boolean
): { parentId: number | null; beforeId: number | null } | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const target = byId.get(targetId);
  if (!target) return null;
  const kids = childrenOf(nodes);
  const parent = target.parentId != null && byId.has(target.parentId) ? target.parentId : null;
  if (zone === "into") return { parentId: target.id, beforeId: null };
  if (zone === "before") return { parentId: parent, beforeId: target.id };
  const own = kids.get(target.id);
  if (own?.length && expanded(target.id)) return { parentId: target.id, beforeId: own[0].id };
  const sibs = kids.get(parent) ?? [];
  const next = sibs[sibs.findIndex(s => s.id === target.id) + 1];
  return { parentId: parent, beforeId: next?.id ?? null };
}

/** Which zone of a row the pointer is over. Middle half nests when allowed. */
export function zoneFor(offsetY: number, height: number, canNest: boolean): DropZone {
  const r = height > 0 ? offsetY / height : 0.5;
  if (canNest) return r < 0.25 ? "before" : r > 0.75 ? "after" : "into";
  return r < 0.5 ? "before" : "after";
}

/* ------------------------------------------------------------------ */
/* Date shifting                                                       */
/* ------------------------------------------------------------------ */

export type ShiftTask = {
  id: number;
  schedulingMode: string;
  constraintType: string;
  constraintDate: string | null;
  startDate: string | null;
  finishDate: string | null;
};
export type ShiftDep = { predecessorId: number; successorId: number };
export type ShiftUpdate = {
  id: number;
  set: Partial<Pick<ShiftTask, "constraintType" | "constraintDate" | "startDate" | "finishDate">>;
  /** Start the user should expect if nothing outside the selection holds it. */
  expectedStart: string | null;
};

/**
 * Shift detail tasks by `n` work days.
 * - Manual tasks: start and finish move.
 * - Automatic ASAP tasks driven by another moved task: left alone (logic carries them).
 * - Other automatic ASAP / SNET tasks: Start No Earlier Than = current start ± n.
 * - Dated constraints (MSO, MFO, FNLT): the constraint date moves.
 */
export function planShift(
  leaves: ShiftTask[],
  deps: ShiftDep[],
  n: number,
  addWorkDays: (date: string, n: number) => string
): ShiftUpdate[] {
  if (!n) return [];
  const moving = new Set(leaves.map(t => t.id));
  const drivenInside = new Set(
    deps.filter(d => moving.has(d.predecessorId) && moving.has(d.successorId)).map(d => d.successorId)
  );
  const out: ShiftUpdate[] = [];
  for (const t of leaves) {
    const expectedStart = t.startDate ? addWorkDays(t.startDate, n) : null;
    if (t.schedulingMode === "manual") {
      if (!t.startDate) continue;
      out.push({
        id: t.id,
        set: { startDate: expectedStart, finishDate: t.finishDate ? addWorkDays(t.finishDate, n) : null },
        expectedStart,
      });
      continue;
    }
    if (t.constraintType === "asap") {
      if (drivenInside.has(t.id) || !t.startDate) {
        if (t.startDate) out.push({ id: t.id, set: {}, expectedStart });
        continue;
      }
      out.push({ id: t.id, set: { constraintType: "snet", constraintDate: expectedStart }, expectedStart });
      continue;
    }
    if (t.constraintType === "snet") {
      const base = t.startDate ?? t.constraintDate;
      if (!base) continue;
      out.push({ id: t.id, set: { constraintDate: addWorkDays(base, n) }, expectedStart: expectedStart ?? addWorkDays(base, n) });
      continue;
    }
    if (t.constraintDate) {
      out.push({ id: t.id, set: { constraintDate: addWorkDays(t.constraintDate, n) }, expectedStart });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Assignment merging                                                  */
/* ------------------------------------------------------------------ */

export type ResourceRef = {
  userId?: number | null;
  jobRoleId?: number | null;
  equipmentId?: number | null;
};
export type AssignmentRow = {
  userId: number | null;
  jobRoleId: number | null;
  equipmentId: number | null;
  allocationPct: number;
};

export function resourceKey(r: ResourceRef): string {
  return `${r.userId ?? 0}:${r.jobRoleId ?? 0}:${r.equipmentId ?? 0}`;
}

/** Apply add / remove / replace of resources to one task's current rows. */
export function mergeAssignments(
  current: AssignmentRow[],
  resources: (ResourceRef & { allocationPct?: number })[],
  mode: "add" | "remove" | "replace"
): AssignmentRow[] {
  const norm = (r: ResourceRef & { allocationPct?: number }): AssignmentRow => ({
    userId: r.userId ?? null,
    jobRoleId: r.jobRoleId ?? null,
    equipmentId: r.equipmentId ?? null,
    allocationPct: r.allocationPct ?? 100,
  });
  if (mode === "replace") {
    const seen = new Set<string>();
    return resources.map(norm).filter(r => {
      const k = resourceKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const keys = new Set(resources.map(resourceKey));
  if (mode === "remove") return current.filter(r => !keys.has(resourceKey(r)));
  const out = current.map(r => ({ ...r }));
  for (const r of resources.map(norm)) {
    const hit = out.find(x => resourceKey(x) === resourceKey(r));
    if (hit) hit.allocationPct = r.allocationPct;
    else out.push(r);
  }
  return out;
}
