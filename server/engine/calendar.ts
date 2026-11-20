/**
 * Work calendar arithmetic.
 *
 * Dates are ISO strings (YYYY-MM-DD). Internally each date maps to a day
 * number (days since 1970-01-01, UTC) and to a "work index": the number of
 * working days before it since BASE. Scheduling math happens in work-index
 * space so lags and durations skip weekends and holidays automatically.
 */

export type CalendarSpec = {
  /** ISO weekday numbers that are working days (1 = Mon ... 7 = Sun). */
  workDays: number[];
  hoursPerDay: number;
  exceptions?: { date: string; isWorking: boolean }[];
};

const MS_PER_DAY = 86_400_000;
const BASE = Date.UTC(1990, 0, 1) / MS_PER_DAY;
const SPAN = 365 * 120; // through ~2110

export function parseDay(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function formatDay(dayNum: number): string {
  return new Date(dayNum * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, n: number): string {
  return formatDay(parseDay(date) + n);
}

export function isoWeekday(dayNum: number): number {
  const wd = new Date(dayNum * MS_PER_DAY).getUTCDay(); // 0 = Sun
  return wd === 0 ? 7 : wd;
}

export function todayIn(timeZone = "America/Phoenix"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

export function isValidDay(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parseDay(date));
}

export class WorkCalendar {
  readonly hoursPerDay: number;
  private readonly cum: Int32Array;
  private readonly work: Uint8Array;

  constructor(spec: CalendarSpec) {
    this.hoursPerDay = spec.hoursPerDay > 0 ? spec.hoursPerDay : 8;
    const workDays = new Set(spec.workDays.length ? spec.workDays : [1, 2, 3, 4, 5]);
    const overrides = new Map<number, boolean>();
    for (const ex of spec.exceptions ?? []) {
      if (isValidDay(ex.date)) overrides.set(parseDay(ex.date), ex.isWorking);
    }
    this.work = new Uint8Array(SPAN);
    this.cum = new Int32Array(SPAN + 1);
    let count = 0;
    for (let k = 0; k < SPAN; k++) {
      const dayNum = BASE + k;
      const override = overrides.get(dayNum);
      const isWork = override !== undefined ? override : workDays.has(isoWeekday(dayNum));
      this.work[k] = isWork ? 1 : 0;
      this.cum[k] = count;
      if (isWork) count++;
    }
    this.cum[SPAN] = count;
  }

  private k(date: string): number {
    const k = parseDay(date) - BASE;
    return Math.max(0, Math.min(SPAN - 1, k));
  }

  isWorkDay(date: string): boolean {
    return this.work[this.k(date)] === 1;
  }

  /**
   * Work index of a date. Non-working dates roll forward to the next work day
   * (default) or backward to the previous work day.
   */
  toIndex(date: string, roll: "forward" | "backward" = "forward"): number {
    const k = this.k(date);
    if (this.work[k] === 1) return this.cum[k];
    return roll === "forward" ? this.cum[k] : this.cum[k] - 1;
  }

  /** The date of a work index. */
  fromIndex(index: number): string {
    const target = Math.max(0, Math.min(this.cum[SPAN] - 1, Math.round(index)));
    // Smallest k with cum[k + 1] > target is the target work day.
    let lo = 0;
    let hi = SPAN - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid + 1] > target) hi = mid;
      else lo = mid + 1;
    }
    return formatDay(BASE + lo);
  }

  nextWorkDay(date: string): string {
    return this.fromIndex(this.toIndex(date, "forward"));
  }

  addWorkDays(date: string, n: number): string {
    return this.fromIndex(this.toIndex(date, "forward") + n);
  }

  /** Inclusive count of working days between two dates (0 if b < a). */
  workDaysBetween(a: string, b: string): number {
    const ia = this.toIndex(a, "forward");
    const ib = this.toIndex(b, "backward");
    return Math.max(0, ib - ia + 1);
  }
}

/** US federal holidays commonly observed by construction (observed dates). */
export function usHolidays(year: number): { date: string; name: string }[] {
  const nthWeekday = (month: number, weekday: number, n: number) => {
    // weekday: 0 = Sun ... 6 = Sat
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return Date.UTC(year, month, day);
  };
  const lastWeekday = (month: number, weekday: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return Date.UTC(year, month, last.getUTCDate() - diff);
  };
  const observed = (ms: number) => {
    const wd = new Date(ms).getUTCDay();
    if (wd === 6) return ms - MS_PER_DAY;
    if (wd === 0) return ms + MS_PER_DAY;
    return ms;
  };
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const thanksgiving = nthWeekday(10, 4, 4);
  return [
    { date: iso(observed(Date.UTC(year, 0, 1))), name: "New Year's Day" },
    { date: iso(lastWeekday(4, 1)), name: "Memorial Day" },
    { date: iso(observed(Date.UTC(year, 6, 4))), name: "Independence Day" },
    { date: iso(nthWeekday(8, 1, 1)), name: "Labor Day" },
    { date: iso(thanksgiving), name: "Thanksgiving" },
    { date: iso(thanksgiving + MS_PER_DAY), name: "Day after Thanksgiving" },
    { date: iso(observed(Date.UTC(year, 11, 25))), name: "Christmas Day" },
  ];
}
