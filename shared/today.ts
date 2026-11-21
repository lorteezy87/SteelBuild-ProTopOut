import { certsDue } from "./certs";
import { rentalsToCallOff, type RentalIn } from "./rentals";
import type { BallInCourt } from "./ballInCourt";

/** Work days ahead that still count as "due soon" on the Today screen. */
export const DUE_SOON_WORK_DAYS = 3;

/** YYYY-MM-DD plus n Monday–Friday work days (n = 0 returns the same day). Pure string/UTC arithmetic: no local-zone drift. */
export function addWorkDays(from: string, n: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export type ActionItem = { open: boolean; ballInCourt: BallInCourt; dueDate: string | null; slaDueAt: Date | null };

/**
 * An open log item needs the PM when the ball is in our court, or its due date / SLA deadline is past or within
 * DUE_SOON_WORK_DAYS work days. A missing date is unknown, never "overdue".
 */
export function needsAction(item: ActionItem, today: string, workDaysAhead: (from: string, n: number) => string = addWorkDays): boolean {
  if (!item.open) return false;
  if (item.ballInCourt === "us") return true;
  const horizon = workDaysAhead(today, DUE_SOON_WORK_DAYS);
  const dates = [item.dueDate, item.slaDueAt ? item.slaDueAt.toISOString().slice(0, 10) : null].filter((x): x is string => !!x);
  return dates.some(d => d <= horizon);
}

export type TodayRow = { id: number; projectId: number; label: string; date: string | null };

type SeqIn = { id: number; projectId: number; name: string; scheduleHealth: string; projectedFinish: string | null };
type LoadIn = { id: number; projectId: number; loadNumber: string; status: string; promisedDate: string | null; needDate: string | null };
type LogIn = ActionItem & { id: number; projectId: number | null; appKey: string; label: string };

const SLIPPING = new Set(["delayed", "at_risk", "blocked"]);
const OPEN_LOAD = new Set(["scheduled", "shipped"]);
const DELAY_NOTICE_APP = "delay";

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const byDate = (a: TodayRow, b: TodayRow) => (a.date ?? "9999") .localeCompare(b.date ?? "9999") || a.id - b.id;

/** The four Today panels. Undated loads and items are left out rather than shown as due (unknown ≠ late). */
type GateIn = { id: number; projectId: number; name: string; status: string; startDate: string | null; gate: "ready" | "not_ready" | "unknown" };
/** Look this far ahead (calendar days) for sequences about to start without a ready gate. */
export const GATE_LOOKAHEAD_DAYS = 14;

type CertIn = { id: number; userId: number; name: string; certType: string; expiresOn: string | null };

export function todaySummary(input: { today: string; sequences: SeqIn[]; deliveries: LoadIn[]; logs: LogIn[]; gates?: GateIn[]; certs?: CertIn[]; rentals?: (RentalIn & { projectId: number; description: string })[] }) {
  const week = plusDays(input.today, 7);
  const sequencesAtRisk = input.sequences
    .filter(s => SLIPPING.has(s.scheduleHealth))
    .map(s => ({ id: s.id, projectId: s.projectId, label: s.name, date: s.projectedFinish }));
  const loadsDue7 = input.deliveries
    .filter(l => OPEN_LOAD.has(l.status))
    .map(l => ({ id: l.id, projectId: l.projectId, label: `Load ${l.loadNumber}`, date: l.promisedDate ?? l.needDate }))
    .filter(l => l.date != null && l.date <= week)
    .sort(byDate);
  const withProject = input.logs.filter((l): l is LogIn & { projectId: number } => l.projectId != null);
  const logsNeedingAction = withProject
    .filter(l => needsAction(l, input.today))
    .map(l => ({ id: l.id, projectId: l.projectId, label: l.label, date: l.dueDate ?? (l.slaDueAt ? l.slaDueAt.toISOString().slice(0, 10) : null) }));
  const noticeDeadlines = withProject
    .filter(l => l.open && l.appKey === DELAY_NOTICE_APP && l.slaDueAt && l.slaDueAt.toISOString().slice(0, 10) <= week)
    .map(l => ({ id: l.id, projectId: l.projectId, label: l.label, date: l.slaDueAt!.toISOString().slice(0, 10) }))
    .sort(byDate);
  // Sequences due to start (or already past their start) that haven't cleared the ready-to-erect gate. No start date → left out.
  const horizon = plusDays(input.today, GATE_LOOKAHEAD_DAYS);
  const sequencesNotReady = (input.gates ?? [])
    .filter(g => g.status === "not_started" && g.gate !== "ready" && g.startDate != null && g.startDate <= horizon)
    .map(g => ({ id: g.id, projectId: g.projectId, label: g.name, date: g.startDate }))
    .sort(byDate);
  return { sequencesAtRisk, loadsDue7, logsNeedingAction, noticeDeadlines, sequencesNotReady, certsDue: certsDue(input.certs ?? [], input.today), rentalsToCallOff: rentalsToCallOff(input.rentals ?? [], input.today) };
}
