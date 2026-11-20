import { WorkCalendar } from "./calendar";

/**
 * Critical-path scheduler.
 *
 * Order of operations for each auto-scheduled leaf task:
 *   1. predecessors (dependency type + lag, in work days)
 *   2. duration (or effort ÷ daily capacity) on the work calendar
 *   3. constraints (SNET, MSO, MFO move the task; FNLT is checked only)
 *   4. actuals override (actual start/finish pin the task)
 * Summary tasks roll up from children. A backward pass yields total float;
 * float <= 0 marks the critical path.
 */

export type DepType = "FS" | "SS" | "FF" | "SF";
export type ConstraintType = "asap" | "snet" | "fnlt" | "mso" | "mfo";

export type SchedTask = {
  id: number;
  parentId: number | null;
  kind: string; // task | milestone | sequence
  schedulingMode: string; // auto | manual
  constraintType: string;
  constraintDate: string | null;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number;
  effortHours: number;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number;
  /** Sum of assignment allocation fractions (1 = one person full time). */
  allocation: number;
  /** External tasks (other projects) are fixed inputs and not returned. */
  external?: boolean;
};

export type SchedDep = {
  predecessorId: number;
  successorId: number;
  type: string;
  lagDays: number;
};

export type SchedOutput = {
  id: number;
  startDate: string;
  finishDate: string;
  durationDays: number;
  totalFloat: number;
  isCritical: boolean;
  isSummary: boolean;
  constraintViolated: boolean;
};

export class CycleError extends Error {
  constructor(public readonly taskIds: number[]) {
    super("Dependency cycle detected");
  }
}

type Node = {
  t: SchedTask;
  dur: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  violated: boolean;
};

export function leafDuration(t: SchedTask, hoursPerDay: number): number {
  if (t.kind === "milestone") return 0;
  if (t.durationDays > 0) return Math.max(1, Math.ceil(t.durationDays - 1e-9));
  if (t.effortHours > 0) {
    const perDay = hoursPerDay * (t.allocation > 0 ? t.allocation : 1);
    return Math.max(1, Math.ceil(t.effortHours / perDay - 1e-9));
  }
  return 1;
}

/** Returns task ids in a cycle if the dependency set contains one, else null. */
export function findCycle(deps: SchedDep[]): number[] | null {
  const adj = new Map<number, number[]>();
  for (const d of deps) {
    if (!adj.has(d.predecessorId)) adj.set(d.predecessorId, []);
    adj.get(d.predecessorId)!.push(d.successorId);
  }
  const state = new Map<number, 1 | 2>();
  const stack: number[] = [];
  const visit = (n: number): number[] | null => {
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m);
      if (s === 1) return stack.slice(stack.indexOf(m));
      if (!s) {
        const c = visit(m);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of Array.from(adj.keys())) {
    if (!state.get(n)) {
      const c = visit(n);
      if (c) return c;
    }
  }
  return null;
}

export function schedule(
  tasks: SchedTask[],
  deps: SchedDep[],
  cal: WorkCalendar,
  projectStart: string
): Map<number, SchedOutput> {
  const byId = new Map<number, SchedTask>(tasks.map(t => [t.id, t]));
  const children = new Map<number, number[]>();
  for (const t of tasks) {
    if (t.parentId != null && byId.has(t.parentId)) {
      if (!children.has(t.parentId)) children.set(t.parentId, []);
      children.get(t.parentId)!.push(t.id);
    }
  }
  const isSummary = (id: number) => (children.get(id)?.length ?? 0) > 0;

  // Only leaf-to-leaf dependencies participate in the network.
  const usable = deps.filter(
    d =>
      byId.has(d.predecessorId) &&
      byId.has(d.successorId) &&
      !isSummary(d.predecessorId) &&
      !isSummary(d.successorId)
  );
  const cycle = findCycle(usable);
  if (cycle) throw new CycleError(cycle);

  const preds = new Map<number, SchedDep[]>();
  const succs = new Map<number, SchedDep[]>();
  for (const d of usable) {
    if (!preds.has(d.successorId)) preds.set(d.successorId, []);
    preds.get(d.successorId)!.push(d);
    if (!succs.has(d.predecessorId)) succs.set(d.predecessorId, []);
    succs.get(d.predecessorId)!.push(d);
  }

  // Topological order of leaves (Kahn).
  const leaves = tasks.filter(t => !isSummary(t.id));
  const indeg = new Map<number, number>(leaves.map(t => [t.id, preds.get(t.id)?.length ?? 0]));
  const queue = leaves.filter(t => indeg.get(t.id) === 0).map(t => t.id);
  const order: number[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const d of succs.get(n) ?? []) {
      const v = (indeg.get(d.successorId) ?? 0) - 1;
      indeg.set(d.successorId, v);
      if (v === 0) queue.push(d.successorId);
    }
  }

  const startIdx = cal.toIndex(projectStart, "forward");
  const nodes = new Map<number, Node>();

  // Forward pass.
  for (const id of order) {
    const t = byId.get(id)!;
    let dur = leafDuration(t, cal.hoursPerDay);
    let es: number;
    let ef: number;
    let violated = false;

    const fixedManual = t.schedulingMode === "manual" || t.external;
    if (fixedManual && t.startDate) {
      es = cal.toIndex(t.startDate, "forward");
      if (t.kind === "milestone") {
        ef = es;
        dur = 0;
      } else {
        const fin = t.finishDate ? cal.toIndex(t.finishDate, "backward") : es + dur - 1;
        ef = Math.max(es, fin);
        dur = ef - es + 1;
      }
    } else {
      es = startIdx;
      for (const d of preds.get(id) ?? []) {
        const p = nodes.get(d.predecessorId);
        if (!p) continue;
        const lag = Math.round(d.lagDays || 0);
        let bound: number;
        switch (d.type as DepType) {
          case "SS":
            bound = p.es + lag;
            break;
          case "FF":
            bound = dur === 0 ? p.ef + lag : p.ef + lag - (dur - 1);
            break;
          case "SF":
            bound = p.es + lag - dur;
            break;
          case "FS":
          default:
            bound = dur === 0 ? p.ef + lag : p.ef + 1 + lag;
            // A milestone predecessor finishes at the end of its day too.
            break;
        }
        es = Math.max(es, bound);
      }

      const cType = (t.constraintType || "asap") as ConstraintType;
      if (t.constraintDate) {
        const cStart = cal.toIndex(t.constraintDate, "forward");
        const cFinish = cal.toIndex(t.constraintDate, "backward");
        if (cType === "snet") es = Math.max(es, cStart);
        if (cType === "mso") es = cStart;
        if (cType === "mfo") es = dur === 0 ? cFinish : cFinish - dur + 1;
      }

      if (t.actualStart) es = cal.toIndex(t.actualStart, "forward");
      ef = dur === 0 ? es : es + dur - 1;
      if (t.actualFinish && t.percentComplete >= 100) {
        ef = Math.max(es, cal.toIndex(t.actualFinish, "backward"));
        dur = t.kind === "milestone" ? 0 : ef - es + 1;
      }

      if (cType === "fnlt" && t.constraintDate) {
        violated = ef > cal.toIndex(t.constraintDate, "backward");
      }
      if (cType === "snet" && t.constraintDate && t.actualStart) {
        violated = es < cal.toIndex(t.constraintDate, "forward");
      }
    }
    nodes.set(id, { t, dur, es, ef, ls: es, lf: ef, violated });
  }

  // Backward pass.
  let projectFinish = startIdx;
  for (const n of Array.from(nodes.values())) projectFinish = Math.max(projectFinish, n.ef);
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nodes.get(order[i])!;
    let lf = projectFinish;
    for (const d of succs.get(order[i]) ?? []) {
      const s = nodes.get(d.successorId);
      if (!s) continue;
      const lag = Math.round(d.lagDays || 0);
      let bound: number;
      switch (d.type as DepType) {
        case "SS":
          bound = s.ls - lag + (n.dur === 0 ? 0 : n.dur - 1);
          break;
        case "FF":
          bound = s.lf - lag;
          break;
        case "SF":
          bound = s.lf - lag + n.dur;
          break;
        case "FS":
        default:
          bound = s.dur === 0 ? s.ls - lag : s.ls - 1 - lag;
          break;
      }
      lf = Math.min(lf, bound);
    }
    n.lf = lf;
    n.ls = n.dur === 0 ? lf : lf - n.dur + 1;
  }

  const out = new Map<number, SchedOutput>();
  for (const n of Array.from(nodes.values())) {
    if (n.t.external) continue;
    const float = n.ls - n.es;
    out.set(n.t.id, {
      id: n.t.id,
      startDate: cal.fromIndex(n.es),
      finishDate: cal.fromIndex(n.ef),
      durationDays: n.dur,
      totalFloat: float,
      isCritical: float <= 0 && n.t.percentComplete < 100,
      isSummary: false,
      constraintViolated: n.violated,
    });
  }

  // Summary rollups (post-order).
  const rollup = (id: number): SchedOutput | null => {
    const kids = children.get(id);
    if (!kids?.length) return out.get(id) ?? null;
    const rs = kids.map(rollup).filter((x): x is SchedOutput => x !== null);
    if (!rs.length) return null;
    const s = rs.reduce((a, b) => (a.startDate < b.startDate ? a : b)).startDate;
    const f = rs.reduce((a, b) => (a.finishDate > b.finishDate ? a : b)).finishDate;
    const r: SchedOutput = {
      id,
      startDate: s,
      finishDate: f,
      durationDays: cal.workDaysBetween(s, f),
      totalFloat: Math.min(...rs.map(x => x.totalFloat)),
      isCritical: rs.some(x => x.isCritical),
      isSummary: true,
      constraintViolated: rs.some(x => x.constraintViolated),
    };
    out.set(id, r);
    return r;
  };
  for (const t of tasks) {
    if ((t.parentId == null || !byId.has(t.parentId)) && !t.external) rollup(t.id);
  }
  return out;
}
