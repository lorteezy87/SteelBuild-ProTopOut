import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEATHER_THRESHOLDS as T,
  summarizeForecast,
  summarizeObservations,
  weatherDayCount,
  weatherFlags,
  weatherText,
  type DaySummary,
  type NwsObservation,
} from "@shared/weather";

const obs = (timestamp: string, o: Partial<{ c: number | null; wind: number | null; gust: number | null; precipMm: number | null; text: string }> = {}): NwsObservation => ({
  timestamp,
  textDescription: o.text ?? "Clear",
  temperature: { unitCode: "wmoUnit:degC", value: o.c === undefined ? 20 : o.c },
  windSpeed: { unitCode: "wmoUnit:km_h-1", value: o.wind === undefined ? 10 : o.wind },
  windGust: { unitCode: "wmoUnit:km_h-1", value: o.gust === undefined ? null : o.gust },
  precipitationLastHour: o.precipMm === undefined ? undefined : { unitCode: "wmoUnit:mm", value: o.precipMm },
});

const base: DaySummary = { day: "2026-11-20", source: "observed", highF: 70, lowF: 50, maxWindMph: 10, maxGustMph: null, precipIn: null, precipChancePct: null, conditions: "Clear", observationCount: 5 };

describe("observed day summary", () => {
  it("converts NWS units to °F, mph and inches", () => {
    const s = summarizeObservations([obs("2026-11-20T19:00:00+00:00", { c: 20, wind: 48.28, gust: 64.37, precipMm: 2.54 })], "2026-11-20", "America/Phoenix");
    expect(s.highF).toBe(68);
    expect(s.maxWindMph).toBe(30);
    expect(s.maxGustMph).toBe(40);
    expect(s.precipIn).toBe(0.1);
  });
  it("buckets by the site's local day, not UTC", () => {
    // 06:30Z on the 21st is 23:30 on the 20th in Phoenix (UTC-7) but 01:30 on the 21st in New York.
    const list = [obs("2026-11-21T06:30:00+00:00", { c: 30 }), obs("2026-11-20T20:00:00+00:00", { c: 10 })];
    expect(summarizeObservations(list, "2026-11-20", "America/Phoenix")).toMatchObject({ observationCount: 2, highF: 86, lowF: 50 });
    expect(summarizeObservations(list, "2026-11-20", "America/New_York")).toMatchObject({ observationCount: 1, highF: 50 });
    expect(summarizeObservations(list, "2026-11-21", "America/New_York")).toMatchObject({ observationCount: 1, highF: 86 });
  });
  it("precipitation is unknown (null) when no reading has a value — never 0", () => {
    const s = summarizeObservations([obs("2026-11-20T19:00:00+00:00"), obs("2026-11-20T20:00:00+00:00", { precipMm: null })], "2026-11-20", "America/Phoenix");
    expect(s.precipIn).toBeNull();
    expect(summarizeObservations([obs("2026-11-20T19:00:00+00:00", { precipMm: 0 })], "2026-11-20", "America/Phoenix").precipIn).toBe(0);
  });
  it("a day with no observations is all unknown", () => {
    const s = summarizeObservations([], "2026-11-20", "America/Phoenix");
    expect(s).toMatchObject({ highF: null, lowF: null, maxWindMph: null, conditions: null, observationCount: 0 });
  });
  it("conditions are the most frequent description; nulls are skipped", () => {
    const s = summarizeObservations(
      [obs("2026-11-20T15:00:00+00:00", { text: "Rain" }), obs("2026-11-20T16:00:00+00:00", { text: "Rain" }), obs("2026-11-20T17:00:00+00:00", { text: "Cloudy", c: null })],
      "2026-11-20",
      "America/Phoenix"
    );
    expect(s.conditions).toBe("Rain");
    expect(s.highF).toBe(68);
  });
});

describe("forecast day summary", () => {
  const p = (startTime: string, temperature: number, windSpeed: string, pop: number | null, shortForecast = "Sunny") => ({
    startTime,
    temperature,
    temperatureUnit: "F",
    windSpeed,
    windGust: null,
    probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: pop },
    shortForecast,
  });
  it("picks the periods on that local day and reads 'x to y mph'", () => {
    const s = summarizeForecast(
      [p("2026-11-21T23:00:00-07:00", 60, "5 mph", 0), p("2026-11-22T10:00:00-07:00", 72, "10 to 25 mph", 40, "Windy"), p("2026-11-22T14:00:00-07:00", 75, "15 mph", 10, "Windy")],
      "2026-11-22"
    )!;
    expect(s).toMatchObject({ source: "forecast", highF: 75, lowF: 72, maxWindMph: 25, precipChancePct: 40, precipIn: null, conditions: "Windy" });
  });
  it("returns null when no period falls on the day", () => {
    expect(summarizeForecast([p("2026-11-21T10:00:00-07:00", 60, "5 mph", 0)], "2026-11-25")).toBeNull();
  });
});

describe("weather flags", () => {
  it("flags only at or past the limit", () => {
    expect(weatherFlags({ ...base, maxGustMph: 30 }, T)).toEqual(["Gusts 30 mph (limit 30)"]);
    expect(weatherFlags({ ...base, maxGustMph: 29, maxWindMph: 19 }, T)).toEqual([]);
    expect(weatherFlags({ ...base, precipIn: 0.1, lowF: 20, highF: 110 }, T)).toEqual(["Precipitation 0.10 in (limit 0.10)", "Low 20 °F (limit 20)", "High 110 °F (limit 110)"]);
  });
  it("unknown values never flag", () => {
    expect(weatherFlags({ ...base, highF: null, lowF: null, maxWindMph: null, maxGustMph: null, precipIn: null }, T)).toEqual([]);
  });
});

describe("report text and counts", () => {
  it("fills the report's weather and temperature fields", () => {
    expect(weatherText({ ...base, maxGustMph: 31, precipIn: 0.2 })).toEqual({ weather: "Clear · wind 10 mph, gusts 31 mph · precip 0.20 in", temperature: "50–70 °F" });
    expect(weatherText({ ...base, conditions: null, highF: null, lowF: null, maxWindMph: null })).toEqual({ weather: "Conditions not reported", temperature: "" });
  });
  it("counts full and partial days and keeps unrecorded apart", () => {
    expect(weatherDayCount([{ weatherDelay: "full" }, { weatherDelay: "partial" }, { weatherDelay: "none" }, { weatherDelay: null }, { weatherDelay: "full" }])).toEqual({ full: 2, partial: 1, none: 1, unrecorded: 1 });
  });
});
