/** Production chart data: tons and pieces per day, split by the report's foreman, against the planned daily rate. */

export type ProductionRow = { reportDate: string; foremanId: number | null; tons: number; pieces: number };
export type ProductionPlan = { tonsPerDay: number | null; piecesPerDay: number | null };
export type ProductionDay = { date: string; byForeman: Record<string, { tons: number; pieces: number }>; tons: number; pieces: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function productionSeries(rows: ProductionRow[], plan: ProductionPlan): { days: ProductionDay[]; plan: ProductionPlan } {
  const byDay = new Map<string, ProductionDay>();
  for (const r of rows) {
    const d = byDay.get(r.reportDate) ?? { date: r.reportDate, byForeman: {}, tons: 0, pieces: 0 };
    const k = String(r.foremanId ?? "none");
    const f = d.byForeman[k] ?? { tons: 0, pieces: 0 };
    d.byForeman[k] = { tons: r2(f.tons + r.tons), pieces: f.pieces + r.pieces };
    d.tons = r2(d.tons + r.tons);
    d.pieces += r.pieces;
    byDay.set(r.reportDate, d);
  }
  return { days: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)), plan };
}

/** Planned tons per day on each date: the sum of plannedTons / durationDays over sequences scheduled on that date (undated ones excluded). */
export function plannedRateByDay(
  seqs: { plannedTons: number; plannedPieces: number; durationDays: number; startDate: string | null; finishDate: string | null }[],
  dates: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) {
    out[d] = r2(seqs.filter(s => s.startDate && s.finishDate && s.durationDays > 0 && s.startDate <= d && d <= s.finishDate).reduce((a, s) => a + s.plannedTons / s.durationDays, 0));
  }
  return out;
}
