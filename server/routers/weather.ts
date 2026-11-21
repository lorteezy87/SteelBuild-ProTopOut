import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  classifyDay,
  DEFAULT_WEATHER_THRESHOLDS,
  summarizeForecast,
  summarizeObservations,
  weatherDayCount,
  weatherFlags,
  type DaySummary,
  type NwsForecastPeriod,
  type NwsObservation,
  type WeatherThresholds,
} from "@shared/weather";
import { dailyReports, projects, weatherDays } from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getSetting, setSetting } from "../bootstrap";
import { db } from "../db";
import { todayIn } from "../engine/calendar";
import { requireJobModule } from "../security/guard";
import { nwsGet, pointFor, WeatherUnavailable, type NwsPoint } from "../services/nws";
import { notFound, zDay, zId } from "./_util";

export type WeatherStatus = "stored" | "fetched" | "no_location" | "too_old" | "too_far" | "unavailable";

export async function thresholds(): Promise<WeatherThresholds> {
  return { ...DEFAULT_WEATHER_THRESHOLDS, ...(await getSetting<Partial<WeatherThresholds>>("weather_thresholds", {})) };
}

async function projectOr404(id: number) {
  const [p] = await (await db()).select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) notFound("Job");
  return p;
}

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

async function observed(point: NwsPoint, day: string): Promise<DaySummary> {
  // A UTC window wide enough for any US offset; summarizeObservations keeps only the site's local day.
  const q = new URLSearchParams({ start: `${addDays(day, -1)}T00:00:00Z`, end: `${addDays(day, 2)}T00:00:00Z` });
  const r = await nwsGet<{ features: { properties: NwsObservation }[] }>(`/stations/${point.station}/observations?${q}`);
  return summarizeObservations(r.features.map(f => f.properties), day, point.timeZone);
}

async function hourly(point: NwsPoint): Promise<NwsForecastPeriod[]> {
  const r = await nwsGet<{ properties: { periods: NwsForecastPeriod[] } }>(point.hourlyUrl);
  return r.properties.periods;
}

export type WeatherDayResult = { summary: DaySummary | null; flags: string[]; status: WeatherStatus; reason?: string };

/** Weather for one job day: stored if we already have a finished day, else fetched from NWS (past week observed, today so far, next week forecast). */
export async function weatherForDay(projectId: number, date: string): Promise<WeatherDayResult> {
  const d = await db();
  const t = await thresholds();
  const [stored] = await d.select().from(weatherDays).where(and(eq(weatherDays.projectId, projectId), eq(weatherDays.day, date))).limit(1);
  const done = (summary: DaySummary | null, status: WeatherStatus, reason?: string): WeatherDayResult => ({ summary, flags: summary ? weatherFlags(summary, t) : [], status, ...(reason ? { reason } : {}) });
  const p = await projectOr404(projectId);
  if (stored && stored.source === "observed") return done(stored.summary, "stored");
  if (p.latitude == null || p.longitude == null) return done(null, "no_location", "Add the job site's latitude and longitude to look up weather.");
  try {
    const point = (await pointFor(p))!;
    const kind = classifyDay(date, todayIn(point.timeZone));
    if (kind === "too_old") return done(null, "too_old", "The National Weather Service keeps about a week of observations. Enter this day's weather by hand.");
    if (kind === "too_far") return done(null, "too_far", "Forecasts reach about a week ahead.");
    if (kind === "forecast") return done(summarizeForecast(await hourly(point), date), "fetched");
    const s = await observed(point, date);
    // Only a finished day with readings is kept; today is fetched again until it is over.
    if (kind === "observed" && s.observationCount > 0) {
      await d
        .insert(weatherDays)
        .values({ projectId, day: date, source: "observed", summary: s })
        .onDuplicateKeyUpdate({ set: { source: "observed", summary: s, fetchedAt: new Date() } });
    }
    return done(s.observationCount ? s : null, s.observationCount ? "fetched" : "unavailable", s.observationCount ? undefined : "The station reported no observations for this day.");
  } catch (e) {
    if (e instanceof WeatherUnavailable) return done(null, "unavailable", e.message);
    throw e;
  }
}

export const weatherRouter = router({
  day: protectedProcedure.input(z.object({ projectId: zId, date: zDay })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    return weatherForDay(input.projectId, input.date);
  }),

  /** Forecast for the next few days from today at the site, with threshold flags. */
  forecast: protectedProcedure.input(z.object({ projectId: zId, days: z.number().int().min(1).max(7).default(3) })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const p = await projectOr404(input.projectId);
    if (p.latitude == null || p.longitude == null) return { status: "no_location" as const, days: [] };
    const t = await thresholds();
    try {
      const point = (await pointFor(p))!;
      const periods = await hourly(point);
      const today = todayIn(point.timeZone);
      const days = Array.from({ length: input.days }, (_, i) => addDays(today, i + 1))
        .map(day => summarizeForecast(periods, day))
        .filter((s): s is DaySummary => s != null)
        .map(s => ({ summary: s, flags: weatherFlags(s, t) }));
      return { status: "fetched" as const, days };
    } catch (e) {
      if (e instanceof WeatherUnavailable) return { status: "unavailable" as const, reason: e.message, days: [] };
      throw e;
    }
  }),

  /** Today: forecast days over the limits in the next three days, across the given active jobs. */
  outlook: protectedProcedure.input(z.object({ projectIds: z.array(zId).max(100) })).query(async ({ ctx, input }) => {
    const d = await db();
    const ids: number[] = [];
    for (const id of input.projectIds) {
      try {
        await requireJobModule(ctx, id);
        ids.push(id);
      } catch {
        /* not visible: skip */
      }
    }
    const rows = ids.length ? await d.select().from(projects).where(inArray(projects.id, ids)) : [];
    const t = await thresholds();
    const flagged: { id: number; projectId: number; label: string; date: string }[] = [];
    const noLocation: number[] = [];
    const unavailable: number[] = [];
    // One NWS round trip per job, all at once: a slow job doesn't hold up the rest.
    await Promise.all(
      rows.map(async p => {
        if (p.latitude == null || p.longitude == null) {
          noLocation.push(p.id);
          return;
        }
        try {
          const point = (await pointFor(p))!;
          const periods = await hourly(point);
          const today = todayIn(point.timeZone);
          for (let i = 0; i <= 3; i++) {
            const s = summarizeForecast(periods, addDays(today, i));
            const f = s ? weatherFlags(s, t) : [];
            if (s && f.length) flagged.push({ id: p.id * 10 + i, projectId: p.id, label: `${s.conditions ?? "Forecast"} — ${f.join(" · ")}`, date: s.day });
          }
        } catch (e) {
          if (e instanceof WeatherUnavailable) unavailable.push(p.id);
          else throw e;
        }
      })
    );
    flagged.sort((a, b) => a.date.localeCompare(b.date) || a.projectId - b.projectId);
    return { flagged, noLocation, unavailable };
  }),

  /** Weather-delay register: each daily report's delay call with the stored conditions, and the totals. */
  register: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const d = await db();
    const p = await projectOr404(input.projectId);
    const reports = await d
      .select({ id: dailyReports.id, reportDate: dailyReports.reportDate, status: dailyReports.status, weatherDelay: dailyReports.weatherDelay, weather: dailyReports.weather })
      .from(dailyReports)
      .where(eq(dailyReports.projectId, input.projectId))
      .orderBy(asc(dailyReports.reportDate));
    const days = reports.length
      ? await d.select().from(weatherDays).where(and(eq(weatherDays.projectId, input.projectId), inArray(weatherDays.day, [...new Set(reports.map(r => r.reportDate))])))
      : [];
    const t = await thresholds();
    const byDay = new Map(days.map(w => [w.day, w.summary]));
    // A weather day marked the same day it happened has nothing stored yet: fetch it while NWS still has it.
    if (p.latitude != null && p.longitude != null) {
      const today = todayIn(p.nwsTimeZone || "America/Phoenix");
      const missing = [...new Set(reports.filter(r => (r.weatherDelay === "full" || r.weatherDelay === "partial") && !byDay.has(r.reportDate) && classifyDay(r.reportDate, today) === "observed").map(r => r.reportDate))];
      const got = await Promise.all(missing.slice(0, 7).map(async day => [day, await weatherForDay(input.projectId, day)] as const));
      for (const [day, w] of got) if (w.summary) byDay.set(day, w.summary);
    }
    const rows = reports.map(r => {
      const s = byDay.get(r.reportDate) ?? null;
      return { ...r, summary: s, flags: s ? weatherFlags(s, t) : [] };
    });
    return { rows, counts: weatherDayCount(reports), allowed: p.weatherDaysAllowed };
  }),

  thresholds: protectedProcedure.query(() => thresholds()),

  setThresholds: adminProcedure
    .input(
      z.object({
        gustMph: z.number().min(1).max(150),
        windMph: z.number().min(1).max(150),
        precipIn: z.number().min(0.01).max(20),
        lowF: z.number().min(-60).max(80),
        highF: z.number().min(60).max(140),
      })
    )
    .mutation(async ({ input }) => {
      await setSetting("weather_thresholds", input);
      return input;
    }),
});
