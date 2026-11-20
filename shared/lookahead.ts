/** 3-week look-ahead and weekly GC report rules. Dates are plain YYYY-MM-DD, done in UTC arithmetic (no zone shifts). */

const toD = (day: string) => new Date(`${day}T00:00:00Z`);
const fromD = (d: Date) => d.toISOString().slice(0, 10);
export function plusDays(day: string, n: number): string {
  const d = toD(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromD(d);
}

/** The Monday on or before `day`. */
export function weekStartOf(day: string): string {
  const dow = toD(day).getUTCDay(); // 0 = Sunday
  return plusDays(day, -((dow + 6) % 7));
}

type LaTask = { id: number; name: string; kind: string; isSummary: boolean; startDate: string | null; finishDate: string | null; status: string; percentComplete: number };

export function lookahead(tasks: LaTask[], from: string, weeks = 3) {
  const days = 7 * weeks;
  const end = plusDays(from, days - 1);
  const ws = Array.from({ length: weeks }, (_, i) => ({ start: plusDays(from, 7 * i), end: plusDays(from, 7 * i + 6) }));
  let undated = 0;
  const rows: (LaTask & { startDate: string; finishDate: string; days: boolean[] })[] = [];
  for (const t of tasks) {
    if (t.isSummary) continue;
    if (!t.startDate || !t.finishDate) {
      undated++;
      continue;
    }
    if (t.finishDate < from || t.startDate > end) continue;
    const grid = Array.from({ length: days }, (_, i) => {
      const d = plusDays(from, i);
      return d >= t.startDate! && d <= t.finishDate!;
    });
    rows.push({ ...t, startDate: t.startDate, finishDate: t.finishDate, days: grid });
  }
  rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  return { weeks: ws, rows: rows.map(({ id, name, kind, startDate, finishDate, status, percentComplete, days }) => ({ id, name, kind, startDate, finishDate, status, percentComplete, days })), undated };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Tons erected (Set stage) by sequence: plan, to date (as of the week's end), this week. `posted` must hold every posted set line
 * from final reports up to the week's end. With no final daily report in the week,
 * "this week" is unknown (null), not 0 — nobody reported, which is different from reporting nothing hung.
 */
export function weeklyTons(
  seqs: { id: number; name: string; plannedTons: number; erectedTons?: number }[],
  posted: { taskId: number; stage: string; reportDate: string; tons: number }[],
  weekStart: string,
  finalReportsThisWeek: number,
) {
  const weekEnd = plusDays(weekStart, 6);
  const rows = seqs.map(s => {
    const thisWeek = finalReportsThisWeek
      ? r2(posted.filter(p => p.taskId === s.id && p.stage === "set" && p.reportDate >= weekStart && p.reportDate <= weekEnd).reduce((a, p) => a + p.tons, 0))
      : null;
    // As of the week's end: set steel posted on or before it (not today's total), so an old week's report still adds up.
    const toDate = r2(posted.filter(p => p.taskId === s.id && p.stage === "set" && p.reportDate <= weekEnd).reduce((a, p) => a + p.tons, 0));
    return { id: s.id, name: s.name, plannedTons: r2(s.plannedTons), toDate, thisWeek, pct: s.plannedTons > 0 ? Math.round((toDate / s.plannedTons) * 1000) / 10 : null };
  });
  return { rows, finalReportsThisWeek };
}
