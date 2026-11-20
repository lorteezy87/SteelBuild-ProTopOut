import { WorkCalendar } from "./calendar";

/**
 * Projection & health (RAG) engine.
 *
 * Projected finish comes from the observed rate of progress. Under the
 * Tonnage / Pieces methods a sequence's % complete is erected ÷ planned, so
 * the rate is effectively tons (or pieces) per work day.
 */

export type ScheduleHealth =
  | "delayed"
  | "at_risk"
  | "on_track"
  | "blocked"
  | "future"
  | "done"
  | "not_active";

export type CostHealth = "overbudget" | "at_risk" | "on_track" | "not_active";

export type ProgressMethod = "duration" | "effort" | "tonnage" | "pieces";

export type HealthTask = {
  id: number;
  isSummary: boolean;
  kind: string;
  status: string;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number;
  effortHours: number;
  percentComplete: number;
  plannedTons: number;
  erectedTons: number;
  plannedPieces: number;
  erectedPieces: number;
  budgetCost: number;
};

export type TaskProjection = { health: ScheduleHealth; projectedFinish: string | null };

export function sequencePercent(t: HealthTask, method: ProgressMethod): number {
  if (t.kind === "sequence") {
    if (method === "tonnage" && t.plannedTons > 0) return clampPct((t.erectedTons / t.plannedTons) * 100);
    if (method === "pieces" && t.plannedPieces > 0) return clampPct((t.erectedPieces / t.plannedPieces) * 100);
  }
  return clampPct(t.percentComplete);
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function projectTask(
  t: HealthTask,
  today: string,
  cal: WorkCalendar,
  projectActive: boolean,
  method: ProgressMethod
): TaskProjection {
  const pct = sequencePercent(t, method);
  if (!t.startDate || !t.finishDate) return { health: projectActive ? "future" : "not_active", projectedFinish: null };
  if (!projectActive) return { health: "not_active", projectedFinish: t.finishDate };
  if (pct >= 100 || t.status === "done") return { health: "done", projectedFinish: t.finishDate };

  const todayIdx = cal.toIndex(today, "forward");
  const startIdx = cal.toIndex(t.startDate, "forward");
  const finishIdx = cal.toIndex(t.finishDate, "backward");
  const dur = Math.max(1, finishIdx - startIdx + 1);

  let projectedIdx: number;
  if (startIdx > todayIdx && pct === 0) {
    return { health: t.status === "blocked" ? "blocked" : "future", projectedFinish: t.finishDate };
  }
  if (pct <= 0) {
    // Should have started but has not: assume work starts today at planned pace.
    projectedIdx = todayIdx + dur - 1;
  } else {
    const elapsed = Math.max(1, todayIdx - startIdx + 1);
    const rate = pct / elapsed; // % per work day
    const remaining = Math.ceil((100 - pct) / rate - 1e-9);
    projectedIdx = todayIdx + Math.max(0, remaining);
    // Progress ahead of plan still cannot finish before the planned start window.
    projectedIdx = Math.max(projectedIdx, startIdx);
  }
  const projectedFinish = cal.fromIndex(projectedIdx);
  if (t.status === "blocked") return { health: "blocked", projectedFinish };

  const threshold = Math.max(1, Math.round(dur * 0.1));
  const slip = projectedIdx - finishIdx;
  let health: ScheduleHealth;
  if (todayIdx > finishIdx) health = "delayed";
  else if (slip > threshold) health = "delayed";
  else if (slip > 0) health = "at_risk";
  else health = "on_track";
  return { health, projectedFinish };
}

/** Project % complete by progress method, from leaf tasks. */
export function projectPercent(leaves: HealthTask[], method: ProgressMethod): number {
  const work = leaves.filter(t => !t.isSummary);
  if (!work.length) return 0;
  if (method === "tonnage" || method === "pieces") {
    const seqs = work.filter(t => t.kind === "sequence");
    const planned = seqs.reduce((s, t) => s + (method === "tonnage" ? t.plannedTons : t.plannedPieces), 0);
    if (planned > 0) {
      const done = seqs.reduce(
        (s, t) =>
          s +
          Math.min(
            method === "tonnage" ? t.erectedTons : t.erectedPieces,
            method === "tonnage" ? t.plannedTons : t.plannedPieces
          ),
        0
      );
      return clampPct((done / planned) * 100);
    }
  }
  const weight = (t: HealthTask) =>
    method === "effort" && t.effortHours > 0 ? t.effortHours : t.kind === "milestone" ? 0 : Math.max(1, t.durationDays);
  const total = work.reduce((s, t) => s + weight(t), 0);
  if (total <= 0) return clampPct(work.reduce((s, t) => s + sequencePercent(t, method), 0) / work.length);
  return clampPct(work.reduce((s, t) => s + weight(t) * sequencePercent(t, method), 0) / total);
}

export type ProjectHealthInput = {
  active: boolean;
  today: string;
  deadline: string | null;
  plannedFinish: string | null;
  plannedStart: string | null;
  budget: number;
  actualCost: number;
  percentComplete: number;
  taskProjections: TaskProjection[];
};

export type ProjectHealthOutput = {
  scheduleHealth: ScheduleHealth;
  costHealth: CostHealth;
  projectedFinish: string | null;
  projectedCost: number | null;
};

export function projectHealth(p: ProjectHealthInput, cal: WorkCalendar): ProjectHealthOutput {
  const projected = p.taskProjections
    .map(t => t.projectedFinish)
    .filter((d): d is string => !!d)
    .sort();
  const projectedFinish = projected.length ? projected[projected.length - 1] : p.plannedFinish;
  const projectedCost =
    p.percentComplete > 0 ? p.actualCost / (p.percentComplete / 100) : p.budget > 0 ? p.budget : null;

  if (!p.active) {
    return { scheduleHealth: "not_active", costHealth: "not_active", projectedFinish, projectedCost };
  }

  let scheduleHealth: ScheduleHealth = "on_track";
  if (p.percentComplete >= 100) scheduleHealth = "done";
  else if (p.plannedStart && p.plannedStart > p.today && p.percentComplete === 0) scheduleHealth = "future";
  else {
    const target = p.deadline ?? p.plannedFinish;
    if (target && projectedFinish) {
      const span = p.plannedStart ? cal.workDaysBetween(p.plannedStart, target) : 20;
      const threshold = Math.max(2, Math.round(span * 0.05));
      const slip = cal.toIndex(projectedFinish, "backward") - cal.toIndex(target, "backward");
      if (slip > threshold) scheduleHealth = "delayed";
      else if (slip > 0) scheduleHealth = "at_risk";
    }
    if (scheduleHealth === "on_track" && p.taskProjections.some(t => t.health === "delayed")) {
      scheduleHealth = "at_risk";
    }
  }

  let costHealth: CostHealth = "not_active";
  if (p.budget > 0 && projectedCost != null) {
    if (projectedCost > p.budget * 1.05 || p.actualCost > p.budget) costHealth = "overbudget";
    else if (projectedCost > p.budget) costHealth = "at_risk";
    else costHealth = "on_track";
  }
  return { scheduleHealth, costHealth, projectedFinish, projectedCost };
}

/* ------------------------------------------------------------------ */
/* Earned value                                                        */
/* ------------------------------------------------------------------ */

export type EvaTask = {
  id: number;
  kind: string;
  durationDays: number;
  budgetCost: number;
  /** Planned window used for PV: baseline dates if a baseline is active, else current. */
  plannedStart: string | null;
  plannedFinish: string | null;
};

export type EvaResult = {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cpi: number | null;
  spi: number | null;
  cv: number;
  sv: number;
  eac: number;
  vac: number;
  plannedPercent: number;
};

export function plannedFraction(start: string | null, finish: string | null, today: string, cal: WorkCalendar): number {
  if (!start || !finish) return 0;
  if (today < start) return 0;
  if (today >= finish) return 1;
  const total = cal.workDaysBetween(start, finish);
  if (total <= 0) return 1;
  const done = cal.workDaysBetween(start, today);
  return Math.max(0, Math.min(1, done / total));
}

export function earnedValue(
  tasks: EvaTask[],
  budget: number,
  percentComplete: number,
  actualCost: number,
  today: string,
  cal: WorkCalendar
): EvaResult {
  const sumBudget = tasks.reduce((s, t) => s + (t.budgetCost || 0), 0);
  const bac = budget > 0 ? budget : sumBudget;
  const weight = (t: EvaTask) =>
    sumBudget > 0 ? t.budgetCost || 0 : t.kind === "milestone" ? 0 : Math.max(1, t.durationDays);
  const totalW = tasks.reduce((s, t) => s + weight(t), 0);
  const plannedPercent =
    totalW > 0
      ? (tasks.reduce((s, t) => s + weight(t) * plannedFraction(t.plannedStart, t.plannedFinish, today, cal), 0) /
          totalW) *
        100
      : 0;
  const pv = (bac * plannedPercent) / 100;
  const ev = (bac * percentComplete) / 100;
  const ac = actualCost;
  const cpi = ac > 0 ? ev / ac : null;
  const spi = pv > 0 ? ev / pv : null;
  const eac = cpi && cpi > 0 ? bac / cpi : bac;
  return {
    bac,
    pv,
    ev,
    ac,
    cpi,
    spi,
    cv: ev - ac,
    sv: ev - pv,
    eac,
    vac: bac - eac,
    plannedPercent,
  };
}
