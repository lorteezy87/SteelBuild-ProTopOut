/** Pure rules for finalizing a daily field report (draft → final). */

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

/** Erected tons/pieces summed per sequence task. */
export function progressByTask(progress: { taskId: number; tons: number; pieces: number }[]): Map<number, { tons: number; pieces: number }> {
  const m = new Map<number, { tons: number; pieces: number }>();
  for (const p of progress) {
    const cur = m.get(p.taskId) ?? { tons: 0, pieces: 0 };
    m.set(p.taskId, { tons: round2(cur.tons + p.tons), pieces: cur.pieces + p.pieces });
  }
  return m;
}
