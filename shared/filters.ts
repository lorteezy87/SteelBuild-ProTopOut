/**
 * Row filtering shared by the report builder and the REST API.
 *
 * Filters are {field, op, value}. Date values may be relative tokens:
 *   today, yesterday, tomorrow, today+N, today-N,
 *   this_week_start/end, last_week_start/end, next_week_start/end,
 *   this_month_start/end, last_month_start/end, next_month_start/end
 * Range ops (this_week, next_month, ...) expand to a between check.
 */

export type FilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "nin"
  | "contains"
  | "starts"
  | "empty"
  | "notempty"
  | "between"
  | "range";

export type Filter = { field: string; op: FilterOp | string; value?: unknown };

export const FILTER_OPS: Record<string, string> = {
  eq: "is",
  ne: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "is any of",
  nin: "is none of",
  contains: "contains",
  starts: "starts with",
  empty: "is empty",
  notempty: "is not empty",
  between: "between",
  range: "in period",
};

export const DATE_RANGES: Record<string, string> = {
  today: "Today",
  this_week: "This Week",
  last_week: "Last Week",
  next_week: "Next Week",
  this_month: "This Month",
  last_month: "Last Month",
  next_month: "Next Month",
  next_30: "Next 30 Days",
  last_30: "Last 30 Days",
  overdue: "Before Today",
};

const MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);

function weekStart(today: string): number {
  const t = parse(today);
  const wd = new Date(t).getUTCDay(); // 0 Sun
  const offset = wd === 0 ? 6 : wd - 1; // Monday start
  return t - offset * MS;
}
function monthStart(today: string, delta: number): number {
  const d = new Date(parse(today));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1);
}

export function resolveDateToken(value: unknown, today: string): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  const m = /^today\s*([+-])\s*(\d+)$/.exec(v);
  if (m) return iso(parse(today) + (m[1] === "+" ? 1 : -1) * Number(m[2]) * MS);
  switch (v) {
    case "today":
      return today;
    case "yesterday":
      return iso(parse(today) - MS);
    case "tomorrow":
      return iso(parse(today) + MS);
    case "this_week_start":
      return iso(weekStart(today));
    case "this_week_end":
      return iso(weekStart(today) + 6 * MS);
    case "last_week_start":
      return iso(weekStart(today) - 7 * MS);
    case "last_week_end":
      return iso(weekStart(today) - MS);
    case "next_week_start":
      return iso(weekStart(today) + 7 * MS);
    case "next_week_end":
      return iso(weekStart(today) + 13 * MS);
    case "this_month_start":
      return iso(monthStart(today, 0));
    case "this_month_end":
      return iso(monthStart(today, 1) - MS);
    case "last_month_start":
      return iso(monthStart(today, -1));
    case "last_month_end":
      return iso(monthStart(today, 0) - MS);
    case "next_month_start":
      return iso(monthStart(today, 1));
    case "next_month_end":
      return iso(monthStart(today, 2) - MS);
    default:
      return value;
  }
}

export function rangeBounds(range: string, today: string): [string, string] | null {
  switch (range) {
    case "today":
      return [today, today];
    case "this_week":
    case "last_week":
    case "next_week":
    case "this_month":
    case "last_month":
    case "next_month":
      return [
        resolveDateToken(`${range}_start`, today) as string,
        resolveDateToken(`${range}_end`, today) as string,
      ];
    case "next_30":
      return [today, resolveDateToken("today+30", today) as string];
    case "last_30":
      return [resolveDateToken("today-30", today) as string, today];
    case "overdue":
      return ["0000-01-01", resolveDateToken("yesterday", today) as string];
    default:
      return null;
  }
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function matchFilter(row: Record<string, unknown>, f: Filter, today: string): boolean {
  const raw = norm(row[f.field]);
  const value = Array.isArray(f.value)
    ? f.value.map(v => resolveDateToken(v, today))
    : resolveDateToken(f.value, today);
  const asList = (v: unknown) => (Array.isArray(v) ? v : [v]).map(x => String(x));
  switch (f.op) {
    case "eq":
      if (Array.isArray(raw)) return raw.map(String).includes(String(value));
      if (typeof value === "boolean") return Boolean(raw) === value;
      return String(raw ?? "") === String(value ?? "");
    case "ne":
      if (Array.isArray(raw)) return !raw.map(String).includes(String(value));
      return String(raw ?? "") !== String(value ?? "");
    case "gt":
      return !isEmpty(raw) && cmp(raw, value) > 0;
    case "gte":
      return !isEmpty(raw) && cmp(raw, value) >= 0;
    case "lt":
      return !isEmpty(raw) && cmp(raw, value) < 0;
    case "lte":
      return !isEmpty(raw) && cmp(raw, value) <= 0;
    case "in": {
      const set = asList(value);
      if (Array.isArray(raw)) return raw.some(x => set.includes(String(x)));
      return set.includes(String(raw ?? ""));
    }
    case "nin": {
      const set = asList(value);
      if (Array.isArray(raw)) return !raw.some(x => set.includes(String(x)));
      return !set.includes(String(raw ?? ""));
    }
    case "contains":
      return String(raw ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
    case "starts":
      return String(raw ?? "").toLowerCase().startsWith(String(value ?? "").toLowerCase());
    case "empty":
      return isEmpty(raw);
    case "notempty":
      return !isEmpty(raw);
    case "between": {
      const [lo, hi] = Array.isArray(value) ? value : [null, null];
      if (isEmpty(raw)) return false;
      const s = String(raw).slice(0, 10);
      const r = typeof raw === "number" ? raw : s;
      return (lo == null || cmp(r, lo) >= 0) && (hi == null || cmp(r, hi) <= 0);
    }
    case "range": {
      const b = rangeBounds(String(f.value ?? ""), today);
      if (!b || isEmpty(raw)) return false;
      const s = String(raw).slice(0, 10);
      return s >= b[0] && s <= b[1];
    }
    default:
      return true;
  }
}

export function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[], today: string): T[] {
  if (!filters.length) return rows;
  return rows.filter(r => filters.every(f => matchFilter(r, f, today)));
}

/**
 * Convert the REST API's JSON filter object into Filter[].
 *   {"name": "^Steel"}              → starts
 *   {"state": "active"}             → eq
 *   {"state": ["active","draft"]}   → in
 *   {"budget": {"gt": 1000}}        → gt
 *   {"finishDate": {"between": ["today", "today+30"]}}
 */
export function parseApiFilter(obj: unknown): Filter[] {
  if (!obj || typeof obj !== "object") return [];
  const out: Filter[] = [];
  for (const [field, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && v.startsWith("^")) out.push({ field, op: "starts", value: v.slice(1) });
    else if (Array.isArray(v)) out.push({ field, op: "in", value: v });
    else if (v && typeof v === "object") {
      for (const [op, val] of Object.entries(v as Record<string, unknown>)) out.push({ field, op, value: val });
    } else out.push({ field, op: "eq", value: v });
  }
  return out;
}

export function sortRows<T extends Record<string, unknown>>(rows: T[], sort: { field: string; dir: "asc" | "desc" }[]): T[] {
  if (!sort.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const av = norm(a[s.field]);
      const bv = norm(b[s.field]);
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = cmp(av, bv);
      if (c !== 0) return s.dir === "desc" ? -c : c;
    }
    return 0;
  });
}
