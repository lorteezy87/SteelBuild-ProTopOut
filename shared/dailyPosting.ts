/** Pure rules for finalizing a daily field report (draft → final). */
import { isStage, type Stage } from "./stages";

export const DAILY_STATUSES = { draft: "Draft", final: "Final" } as const;
export type DailyStatus = keyof typeof DAILY_STATUSES;

export function assertFinalizable(status: string): void {
  if (status === "final") throw new Error("Report is already final");
  if (status !== "draft") throw new Error(`Unknown report status: ${status}`);
}

export type CrewHours = { userId: number | null; taskId: number | null; stHours: number; otHours: number };
export type TimeLine = { userId: number; taskId: number | null; hours: number; kind: "st" | "ot" };

/** One time line per non-zero ST/OT bucket for each crew line that names a person. */
export function crewTimeLines(crew: CrewHours[]): TimeLine[] {
  const out: TimeLine[] = [];
  for (const c of crew) {
    if (!c.userId) continue;
    if (c.stHours > 0) out.push({ userId: c.userId, taskId: c.taskId, hours: c.stHours, kind: "st" });
    if (c.otHours > 0) out.push({ userId: c.userId, taskId: c.taskId, hours: c.otHours, kind: "ot" });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Erected tons/pieces summed per sequence task and erection stage (a line without a stage is "set"). */
export function progressByTask(
  progress: { taskId: number; stage?: string | null; tons: number; pieces: number }[],
): Map<string, { taskId: number; stage: Stage; tons: number; pieces: number }> {
  const m = new Map<string, { taskId: number; stage: Stage; tons: number; pieces: number }>();
  for (const p of progress) {
    const stage: Stage = isStage(p.stage) ? p.stage : "set";
    const key = `${p.taskId}:${stage}`;
    const cur = m.get(key) ?? { taskId: p.taskId, stage, tons: 0, pieces: 0 };
    m.set(key, { taskId: p.taskId, stage, tons: round2(cur.tons + p.tons), pieces: cur.pieces + p.pieces });
  }
  return m;
}

/** Reopening reverses posted hours; hours already billed to the GC must not be deleted out from under the invoice. */
export function assertReopenable(postedEntries: { state: string }[]): void {
  if (postedEntries.some(e => e.state === "invoiced")) throw new Error("Hours from this report are already invoiced");
}

/**
 * Reopening a report that started a sequence: when no set steel remains and no other posted report has set steel on it,
 * the sequence goes back to not started (so the ready-to-erect gate applies again). A start dated before the report
 * wasn't caused by it and stays. Returns the patch, or null to leave the sequence alone.
 */
export function reopenStartReset(
  t: { status: string; actualStart: string | null; erectedTonsAfter: number; otherPostedSet: boolean },
  reportDate: string,
): { status: "not_started"; actualStart: null; percentComplete: 0 } | null {
  if (t.status !== "in_progress" || t.erectedTonsAfter > 1e-6 || t.otherPostedSet) return null;
  if (t.actualStart != null && t.actualStart !== reportDate) return null;
  return { status: "not_started", actualStart: null, percentComplete: 0 };
}
