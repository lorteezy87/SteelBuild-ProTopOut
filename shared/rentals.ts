/** Equipment rentals: billed days, rental-house billing, call-off reminders and cost coverage. */

export type Rates = { dayRate: number | null; weekRate: number | null; monthRate: number | null };

/** Rental houses bill a "month" as a 28-day cycle. */
export const RENTAL_MONTH_DAYS = 28;
/** Show "call off soon" this many days before the call-off date. */
export const CALL_OFF_SOON_DAYS = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayMs = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function plusDays(day: string, n: number): string {
  const d = new Date(toMs(day));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Calendar days on rent: delivery day through the day before pickup, minimum 1; 0 if not on rent yet. */
export function billedDays(onRent: string, offRent: string | null, today: string): number {
  // "To date": nothing after today is billed, even when the off-rent date is entered ahead.
  if (onRent > today) return 0;
  const end = offRent && offRent < today ? offRent : today;
  if (onRent > end) return 0;
  return Math.max(1, Math.round((toMs(end) - toMs(onRent)) / dayMs));
}

/**
 * Cheapest rental-house billing: whole 28-day months, then weeks, then days, each tier capped at the next.
 * A missing lower rate is prorated from the next rate up. No rates at all → null (unknown, never $0).
 */
export function rentalCharge(days: number, r: Rates): number | null {
  if (r.dayRate == null && r.weekRate == null && r.monthRate == null) return null;
  if (days <= 0) return 0;
  const day = r.dayRate ?? (r.weekRate != null ? r.weekRate / 7 : r.monthRate! / RENTAL_MONTH_DAYS);
  const week = r.weekRate ?? day * 7;
  const month = r.monthRate ?? week * 4;
  const months = Math.floor(days / RENTAL_MONTH_DAYS);
  const rem = days % RENTAL_MONTH_DAYS;
  const weeks = Math.floor(rem / 7);
  const odd = rem % 7;
  const oddCost = Math.min(odd * day, week);
  const remCost = Math.min(weeks * week + oddCost, month);
  return round2(months * month + remCost);
}

export type RentalIn = Rates & {
  id: number;
  equipmentId: number | null;
  onRentDate: string;
  offRentDate: string | null;
  plannedOffRentDate: string | null;
  callOffNoticeDays: number;
  calledOffOn: string | null;
  deliveryCharge: number | null;
  pickupCharge: number | null;
};

/** Cost so far (through off-rent, or today while on rent). Unknown charge → unknown total. Not yet on rent → 0. */
export function rentalCost(r: RentalIn, today: string): { days: number; charge: number | null; total: number | null } {
  const days = billedDays(r.onRentDate, r.offRentDate, today);
  const charge = rentalCharge(days, r);
  if (days === 0 && charge != null) return { days, charge: 0, total: 0 };
  return { days, charge, total: charge == null ? null : round2(charge + (r.deliveryCharge ?? 0) + (r.pickupCharge ?? 0)) };
}

export type CallOff = "off_rent" | "called_off" | "overdue" | "call_off_now" | "call_off_soon" | "on_rent" | "no_planned_date" | "not_yet_on_rent";

export const CALL_OFF_LABEL: Record<CallOff, string> = {
  overdue: "Overdue — still on rent",
  call_off_now: "Call off today",
  call_off_soon: "Call off by {date}",
  no_planned_date: "No planned off-rent date",
  not_yet_on_rent: "Not yet on rent",
  called_off: "Called off {date}",
  off_rent: "Off rent {date}",
  on_rent: "On rent",
};

export function callOffStatus(r: RentalIn, today: string): { status: CallOff; callBy: string | null } {
  const callBy = r.plannedOffRentDate ? plusDays(r.plannedOffRentDate, -Math.max(0, r.callOffNoticeDays)) : null;
  if (r.offRentDate) return { status: "off_rent", callBy };
  if (r.onRentDate > today) return { status: "not_yet_on_rent", callBy };
  if (r.calledOffOn) return { status: "called_off", callBy };
  if (!r.plannedOffRentDate || !callBy) return { status: "no_planned_date", callBy: null };
  if (today > r.plannedOffRentDate) return { status: "overdue", callBy };
  if (today >= callBy) return { status: "call_off_now", callBy };
  if (today >= plusDays(callBy, -CALL_OFF_SOON_DAYS)) return { status: "call_off_soon", callBy };
  return { status: "on_rent", callBy };
}

/** Is this piece of equipment on rent to the job on that date? (Inclusive; an open rental runs on.) */
export function coveredByRental(rentals: Pick<RentalIn, "equipmentId" | "onRentDate" | "offRentDate">[], equipmentId: number, date: string): boolean {
  return rentals.some(r => r.equipmentId === equipmentId && date >= r.onRentDate && (r.offRentDate == null || date <= r.offRentDate));
}

/** Distinct report dates in the rental window with the equipment idle on standby. Delay-claim backup; not added to cost. */
export function standbyDays(rows: { reportDate: string; standbyHours: number; operatingHours: number }[], r: Pick<RentalIn, "onRentDate" | "offRentDate">): number {
  const days = new Set(
    rows
      .filter(x => x.standbyHours > 0 && x.operatingHours === 0 && x.reportDate >= r.onRentDate && (r.offRentDate == null || x.reportDate <= r.offRentDate))
      .map(x => x.reportDate)
  );
  return days.size;
}

const CALL_OFF_PANEL: CallOff[] = ["overdue", "call_off_now", "call_off_soon"];

/** Today panel: rentals that need a call-off now or soon, overdue first, then by call-off date. */
export function rentalsToCallOff(rentals: (RentalIn & { projectId: number; description: string })[], today: string) {
  return rentals
    .map(r => ({ r, c: callOffStatus(r, today) }))
    .filter(x => CALL_OFF_PANEL.includes(x.c.status))
    .sort((a, b) => CALL_OFF_PANEL.indexOf(a.c.status) - CALL_OFF_PANEL.indexOf(b.c.status) || (a.c.callBy ?? "").localeCompare(b.c.callBy ?? "") || a.r.id - b.r.id)
    .map(({ r, c }) => ({ id: r.id, projectId: r.projectId, label: r.description, date: c.callBy, status: c.status }));
}
