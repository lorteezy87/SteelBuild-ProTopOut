/** NWS weather: daily summaries in the site's own time zone, delay thresholds and report text. Pure rules. */

export type WeatherThresholds = { gustMph: number; windMph: number; precipIn: number; lowF: number; highF: number };

/** Defaults the PM can change in Settings → Weather. The app flags; the PM decides whether the day was lost. */
export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = { gustMph: 30, windMph: 20, precipIn: 0.1, lowF: 20, highF: 110 };

export type DaySummary = {
  day: string;
  source: "observed" | "forecast";
  highF: number | null;
  lowF: number | null;
  maxWindMph: number | null;
  maxGustMph: number | null;
  /** Observed rainfall; null = no gauge reading, never assumed dry. Forecasts give a chance instead. */
  precipIn: number | null;
  /** Some hours had no rain reading: precipIn is a floor ("at least"), not the day's total. */
  precipPartial: boolean;
  precipChancePct: number | null;
  conditions: string | null;
  observationCount: number;
};

type Quantity = { unitCode?: string; value: number | null } | null | undefined;

export type NwsObservation = {
  timestamp: string;
  textDescription?: string | null;
  temperature?: Quantity;
  windSpeed?: Quantity;
  windGust?: Quantity;
  precipitationLastHour?: Quantity;
};

export type NwsForecastPeriod = {
  startTime: string;
  temperature: number | null;
  temperatureUnit?: string;
  windSpeed?: string | null;
  windGust?: string | null;
  probabilityOfPrecipitation?: Quantity;
  shortForecast?: string | null;
};

export const WEATHER_DELAY = { none: "No weather delay", partial: "Partial day lost", full: "Full day lost" } as const;
export type WeatherDelay = keyof typeof WEATHER_DELAY;
export const WEATHER_DELAY_KEYS = Object.keys(WEATHER_DELAY) as WeatherDelay[];

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

function num(q: Quantity): number | null {
  return q && typeof q.value === "number" && Number.isFinite(q.value) ? q.value : null;
}
function toF(q: Quantity): number | null {
  const v = num(q);
  if (v == null) return null;
  return q!.unitCode?.endsWith("degF") ? v : (v * 9) / 5 + 32;
}
function toMph(q: Quantity): number | null {
  const v = num(q);
  if (v == null) return null;
  const u = q!.unitCode ?? "wmoUnit:km_h-1";
  if (u.endsWith("m_s-1")) return v * 2.236936;
  if (u.endsWith("kn") || u.endsWith("kt")) return v * 1.150779;
  return v / 1.609344;
}
function toIn(q: Quantity): number | null {
  const v = num(q);
  if (v == null) return null;
  const u = q!.unitCode ?? "wmoUnit:mm";
  if (u.endsWith(":m")) return v * 39.37008;
  return v / 25.4;
}

const dayFmt = new Map<string, Intl.DateTimeFormat>();
/** YYYY-MM-DD of an instant in a time zone. */
export function localDay(iso: string, timeZone: string): string {
  let f = dayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFmt.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

function mode(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v && v.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}
const maxOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};
const minOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
};
const round = (n: number | null, f: (n: number) => number) => (n == null ? null : f(n));

/**
 * Rain by reporting hour. A station's routine report (usually at :53) carries rain since the previous one;
 * special reports in between carry the running total for the same hour. So readings are grouped by the
 * routine report that closes their hour and the hour's largest reading is taken — never summed within it.
 */
function hourlyPrecip(obs: NwsObservation[]): { total: number | null; partial: boolean } {
  if (!obs.length) return { total: null, partial: false };
  const minutes = obs.map(o => new Date(o.timestamp).getUTCMinutes());
  const routine = Number(mode(minutes.map(String)) ?? 53);
  const shift = (routine + 1) * 60_000;
  const hours = new Map<number, number | null>();
  for (const o of obs) {
    const key = Math.floor((Date.parse(o.timestamp) - shift) / 3_600_000);
    const v = toIn(o.precipitationLastHour);
    const prev = hours.get(key);
    hours.set(key, v == null ? (prev ?? null) : Math.max(prev ?? 0, v));
  }
  const known = [...hours.values()].filter((v): v is number => v != null);
  if (!known.length) return { total: null, partial: false };
  return { total: r2(known.reduce((a, b) => a + b, 0)), partial: known.length < hours.size };
}

/** Station observations for one local day at the site. */
export function summarizeObservations(obs: NwsObservation[], day: string, timeZone: string): DaySummary {
  const mine = obs.filter(o => o.timestamp && localDay(o.timestamp, timeZone) === day);
  const temps = mine.map(o => toF(o.temperature));
  const precip = hourlyPrecip(mine);
  return {
    day,
    source: "observed",
    highF: round(maxOf(temps), r0),
    lowF: round(minOf(temps), r0),
    maxWindMph: round(maxOf(mine.map(o => toMph(o.windSpeed))), r0),
    maxGustMph: round(maxOf(mine.map(o => toMph(o.windGust))), r0),
    precipIn: precip.total,
    precipPartial: precip.partial,
    precipChancePct: null,
    conditions: mode(mine.map(o => o.textDescription)),
    observationCount: mine.length,
  };
}

/** Highest number in an NWS wind string: "15 mph", "10 to 25 mph". */
function mphText(s: string | null | undefined): number | null {
  if (!s) return null;
  const ns = (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return ns.length ? Math.max(...ns) : null;
}

/** Hourly forecast periods for one local day (each period's start time carries the site's offset). */
export function summarizeForecast(periods: NwsForecastPeriod[], day: string): DaySummary | null {
  const mine = periods.filter(p => p.startTime?.slice(0, 10) === day);
  if (!mine.length) return null;
  const temps = mine.map(p => (p.temperature == null ? null : p.temperatureUnit === "C" ? (p.temperature * 9) / 5 + 32 : p.temperature));
  return {
    day,
    source: "forecast",
    highF: round(maxOf(temps), r0),
    lowF: round(minOf(temps), r0),
    maxWindMph: round(maxOf(mine.map(p => mphText(p.windSpeed))), r0),
    maxGustMph: round(maxOf(mine.map(p => mphText(p.windGust))), r0),
    precipIn: null,
    precipPartial: false,
    precipChancePct: maxOf(mine.map(p => num(p.probabilityOfPrecipitation))),
    conditions: mode(mine.map(p => p.shortForecast)),
    observationCount: mine.length,
  };
}

/** Thresholds met or exceeded. An unknown value never flags (and never reads as fine — the screen says unknown). */
export function weatherFlags(s: DaySummary, t: WeatherThresholds): string[] {
  const out: string[] = [];
  if (s.maxGustMph != null && s.maxGustMph >= t.gustMph) out.push(`Gusts ${s.maxGustMph} mph (limit ${t.gustMph})`);
  if (s.maxWindMph != null && s.maxWindMph >= t.windMph) out.push(`Wind ${s.maxWindMph} mph (limit ${t.windMph})`);
  if (s.precipIn != null && s.precipIn >= t.precipIn) out.push(`Precipitation ${s.precipIn.toFixed(2)} in (limit ${t.precipIn.toFixed(2)})`);
  if (s.lowF != null && s.lowF <= t.lowF) out.push(`Low ${s.lowF} °F (limit ${t.lowF})`);
  if (s.highF != null && s.highF >= t.highF) out.push(`High ${s.highF} °F (limit ${t.highF})`);
  return out;
}

/** Text for the daily report's weather (128) and temperature (32) fields. */
export function weatherText(s: DaySummary): { weather: string; temperature: string } {
  const parts: string[] = [];
  if (s.conditions) parts.push(s.conditions);
  const wind = [s.maxWindMph != null ? `wind ${s.maxWindMph} mph` : null, s.maxGustMph != null ? `gusts ${s.maxGustMph} mph` : null].filter(Boolean).join(", ");
  if (wind) parts.push(wind);
  if (s.precipIn != null) parts.push(`precip ${s.precipIn.toFixed(2)} in${s.precipPartial ? " (some hours not reported)" : ""}`);
  else if (s.precipChancePct != null) parts.push(`${s.precipChancePct}% chance of precip`);
  const weather = (parts.length ? parts.join(" · ") : "Conditions not reported").slice(0, 128);
  const temperature = s.lowF != null && s.highF != null ? `${s.lowF}–${s.highF} °F` : s.highF != null ? `${s.highF} °F` : "";
  return { weather, temperature };
}

const DELAY_RANK: Record<string, number> = { full: 3, partial: 2, none: 1 };

/** Each date's weather call across its reports (two crews on one rain day are one day): the worst call made, or null. */
export function weatherDayCalls(reports: { reportDate: string; weatherDelay: string | null }[]): Map<string, WeatherDelay | null> {
  const days = new Map<string, WeatherDelay | null>();
  for (const r of reports) {
    const cur = days.get(r.reportDate) ?? null;
    const v = r.weatherDelay && DELAY_RANK[r.weatherDelay] ? (r.weatherDelay as WeatherDelay) : null;
    days.set(r.reportDate, v && (!cur || DELAY_RANK[v] > DELAY_RANK[cur]) ? v : cur);
  }
  return days;
}

/** Weather-delay days (dates, not reports). A date nobody made a call on stays "unrecorded", not "none". */
export function weatherDayCount(reports: { reportDate: string; weatherDelay: string | null }[]) {
  const out = { full: 0, partial: 0, none: 0, unrecorded: 0 };
  for (const v of weatherDayCalls(reports).values()) out[v ?? "unrecorded"]++;
  return out;
}

/** NWS keeps about a week of station observations and forecasts about a week ahead. */
export const NWS_HISTORY_DAYS = 7;
export const NWS_FORECAST_DAYS = 7;

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** What NWS can tell us about a day, relative to the site's today. */
export function classifyDay(date: string, today: string): "observed" | "today" | "forecast" | "too_old" | "too_far" {
  if (date === today) return "today";
  if (date < today) return date >= addDays(today, -NWS_HISTORY_DAYS) ? "observed" : "too_old";
  return date <= addDays(today, NWS_FORECAST_DAYS) ? "forecast" : "too_far";
}

/** Observed rain for display: unknown stays "not reported"; a partial reading is a floor. */
export function precipLabel(s: Pick<DaySummary, "precipIn" | "precipPartial">): string {
  if (s.precipIn == null) return "not reported";
  return s.precipPartial ? `at least ${s.precipIn.toFixed(2)} in (some hours not reported)` : `${s.precipIn.toFixed(2)} in`;
}
