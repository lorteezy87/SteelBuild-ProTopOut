/**
 * Shell counts: the handful of numbers the navigation rail shows as badges.
 * They load on their own cheap query so the shell paints before any page data arrives.
 */

export type ShellCounts = {
  /** Open log items (RFIs, submittals, change orders, ...) past their due date, on active jobs. */
  logsPastDue: number;
  /** Open log items where the ball is in our court, on active jobs. */
  logsOurCourt: number;
  /** Active jobs whose schedule health is Delayed. */
  jobsDelayed: number;
};

export const EMPTY_SHELL_COUNTS: ShellCounts = { logsPastDue: 0, logsOurCourt: 0, jobsDelayed: 0 };

/** Coerce whatever the SQL driver hands back (string, bigint, null) into a safe non-negative integer. */
export function toCount(v: unknown): number {
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Badge per navigation destination. A destination with nothing to show is left out. */
export function navBadges(c: ShellCounts): Record<string, number> {
  const out: Record<string, number> = {};
  if (c.logsPastDue > 0) out["/"] = c.logsPastDue;
  if (c.jobsDelayed > 0) out["/jobs"] = c.jobsDelayed;
  if (c.logsOurCourt > 0) out["/logs"] = c.logsOurCourt;
  return out;
}

/** What the badge means, for the tooltip. */
export const NAV_BADGE_HINT: Record<string, (n: number) => string> = {
  "/": n => `${n} log item${n === 1 ? "" : "s"} past due`,
  "/jobs": n => `${n} active job${n === 1 ? "" : "s"} behind schedule`,
  "/logs": n => `${n} open item${n === 1 ? "" : "s"} with the ball in our court`,
};

/** Badges stay narrow: anything over 99 reads "99+". */
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
