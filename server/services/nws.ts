/** api.weather.gov client. Errors are "unavailable", never an empty result that would read as fine weather. */
import { eq } from "drizzle-orm";
import { projects } from "../../drizzle/schema";
import { db } from "../db";

/** Generic client name: NWS asks for a User-Agent; the owner's name or email never goes in it. */
export const NWS_USER_AGENT = "SteelBuild-Pro-TopOut (weather for daily field reports)";

export class WeatherUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherUnavailable";
  }
}

export const nwsBase = () => (process.env.NWS_BASE_URL || "https://api.weather.gov").replace(/\/$/, "");

export async function nwsGet<T = unknown>(pathOrUrl: string, opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<T> {
  const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : `${nwsBase()}${pathOrUrl}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await (opts.fetchFn ?? fetch)(url, {
      headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
      signal: ctrl.signal,
    });
    if (res.status === 404) throw new WeatherUnavailable("The National Weather Service has no data for this location (US sites only).");
    if (!res.ok) throw new WeatherUnavailable(`The National Weather Service returned an error (${res.status}). Try again later.`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof WeatherUnavailable) throw e;
    if (ctrl.signal.aborted) throw new WeatherUnavailable("The National Weather Service did not answer in time. Try again later.");
    throw new WeatherUnavailable("Couldn't reach the National Weather Service.");
  } finally {
    clearTimeout(timer);
  }
}

export type NwsPoint = { timeZone: string; station: string; hourlyUrl: string };

/** The job's NWS point (time zone, nearest station, hourly forecast), looked up once per location and cached on the job. */
export async function pointFor(p: { id: number; latitude: number | null; longitude: number | null; nwsTimeZone: string | null; nwsStation: string | null; nwsHourlyUrl: string | null }): Promise<NwsPoint | null> {
  if (p.latitude == null || p.longitude == null) return null;
  if (p.nwsTimeZone && p.nwsStation && p.nwsHourlyUrl) return { timeZone: p.nwsTimeZone, station: p.nwsStation, hourlyUrl: p.nwsHourlyUrl };
  const pt = await nwsGet<{ properties: { timeZone: string; forecastHourly: string; observationStations: string } }>(
    `/points/${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`
  );
  const st = await nwsGet<{ features: { properties: { stationIdentifier: string } }[] }>(pt.properties.observationStations);
  const station = st.features[0]?.properties.stationIdentifier;
  if (!station) throw new WeatherUnavailable("No National Weather Service station near this location.");
  const point = { timeZone: pt.properties.timeZone, station, hourlyUrl: pt.properties.forecastHourly };
  await (await db()).update(projects).set({ nwsTimeZone: point.timeZone, nwsStation: point.station, nwsHourlyUrl: point.hourlyUrl }).where(eq(projects.id, p.id));
  return point;
}
