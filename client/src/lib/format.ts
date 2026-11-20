import { parseGateRefusal } from "@shared/gate";
/** Formatting helpers. Dates are plain YYYY-MM-DD strings (no timezone shifts). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

export function weekStart(day: string): string {
  const d = parseDay(day);
  const wd = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -wd);
}

export function dow(day: string): string {
  return DOW[parseDay(day).getUTCDay()];
}

/** "Nov 5" or "Nov 5, 2027" when not the current year. */
export function fmtDate(day: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!day) return "—";
  const d = parseDay(day);
  const thisYear = new Date().getFullYear();
  const showYear = opts.year ?? d.getUTCFullYear() !== thisYear;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${showYear ? `, ${d.getUTCFullYear()}` : ""}`;
}

/** 11/05/26 — compact, for dense grids. */
export function fmtDateShort(day: string | null | undefined): string {
  if (!day) return "—";
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export function fmtDateTime(ts: string | Date | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtAgo(ts: string | Date | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtMoney(n: number | null | undefined, opts: { cents?: boolean; compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 10_000) {
    const abs = Math.abs(n);
    const v = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M` : `${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
    return `${n < 0 ? "-" : ""}$${v}`;
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtTons(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 1 : 0, maximumFractionDigits: 1 })} t`;
}

export function fmtHours(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} h`;
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Read a File as base64 (no data: prefix) for tRPC uploads. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: unknown }).message);
    try {
      const parsed = JSON.parse(m);
      if (Array.isArray(parsed)) return parsed.map((x: { message?: string }) => x.message).filter(Boolean).join("; ");
    } catch {
      /* not JSON */
    }
    return parseGateRefusal(m)?.text ?? m;
  }
  return "Something went wrong";
}
