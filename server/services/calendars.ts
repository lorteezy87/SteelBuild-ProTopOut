import { eq } from "drizzle-orm";
import { calendarExceptions, calendars } from "../../drizzle/schema";
import { WorkCalendar, todayIn } from "../engine/calendar";
import { db } from "../db";
import { getSetting } from "../bootstrap";

const cache = new Map<number, { at: number; cal: WorkCalendar }>();
const TTL = 60_000;
let defaultId: { at: number; id: number | null } | null = null;

export function invalidateCalendars() {
  cache.clear();
  defaultId = null;
}

async function resolveDefaultId(): Promise<number | null> {
  if (defaultId && Date.now() - defaultId.at < TTL) return defaultId.id;
  const d = await db();
  const rows = await d.select().from(calendars);
  const id = rows.find(r => r.isDefault)?.id ?? rows[0]?.id ?? null;
  defaultId = { at: Date.now(), id };
  return id;
}

export async function getCalendar(calendarId: number | null | undefined): Promise<WorkCalendar> {
  const id = calendarId ?? (await resolveDefaultId());
  if (id == null) return new WorkCalendar({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.cal;
  const d = await db();
  const [row] = await d.select().from(calendars).where(eq(calendars.id, id)).limit(1);
  if (!row) return getCalendar(null);
  const ex = await d.select().from(calendarExceptions).where(eq(calendarExceptions.calendarId, id));
  const cal = new WorkCalendar({
    workDays: row.workDays,
    hoursPerDay: row.hoursPerDay,
    exceptions: ex.map(e => ({ date: e.date, isWorking: e.isWorking })),
  });
  cache.set(id, { at: Date.now(), cal });
  return cal;
}

export async function orgToday(): Promise<string> {
  const org = await getSetting<{ timezone?: string }>("org", {});
  return todayIn(org.timezone || "America/Phoenix");
}
