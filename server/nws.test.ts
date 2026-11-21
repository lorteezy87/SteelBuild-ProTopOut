import { describe, expect, it } from "vitest";
import { nwsGet, WeatherUnavailable, NWS_USER_AGENT } from "./services/nws";
import { classifyDay } from "@shared/weather";

describe("NWS client", () => {
  it("sends the generic user agent and returns JSON", async () => {
    let ua = "";
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      ua = new Headers(init?.headers).get("user-agent") ?? "";
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as typeof fetch;
    await expect(nwsGet("/points/1,2", { fetchFn })).resolves.toEqual({ ok: 1 });
    expect(ua).toBe(NWS_USER_AGENT);
    expect(NWS_USER_AGENT).not.toMatch(/@/);
  });
  it("a server error is 'unavailable', not an empty result", async () => {
    const fetchFn = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(nwsGet("/points/1,2", { fetchFn })).rejects.toBeInstanceOf(WeatherUnavailable);
  });
  it("a slow service times out as 'unavailable'", async () => {
    const fetchFn = ((_u: string, init?: RequestInit) =>
      new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const err = await nwsGet("/points/1,2", { fetchFn, timeoutMs: 20 }).catch(e => e);
    expect(err).toBeInstanceOf(WeatherUnavailable);
    expect((err as Error).message).toMatch(/did not answer/);
  });
  it("a network failure is 'unavailable'", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(nwsGet("/x", { fetchFn })).rejects.toBeInstanceOf(WeatherUnavailable);
  });
});

describe("which NWS data a day can have", () => {
  const today = "2026-11-21";
  it("past week is observed, today is today, next week is forecast", () => {
    expect(classifyDay("2026-11-14", today)).toBe("observed");
    expect(classifyDay("2026-11-13", today)).toBe("too_old");
    expect(classifyDay(today, today)).toBe("today");
    expect(classifyDay("2026-11-28", today)).toBe("forecast");
    expect(classifyDay("2026-11-29", today)).toBe("too_far");
  });
});
