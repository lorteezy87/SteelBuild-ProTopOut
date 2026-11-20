import { ensureBootstrap } from "../bootstrap";
import { recomputeAll } from "../services/recompute";
import { orgToday } from "../services/calendars";
import { getSetting, setSetting } from "../bootstrap";
import { sweepSla } from "../services/wf";

const FIVE_MIN = 5 * 60_000;
let started = false;
let running = false;

/**
 * In-process sweeps: workflow SLA expiry (every 5 min), webhook retries, and a
 * once-per-day reforecast of all jobs (records the daily snapshot).
 * Safe to run on overlapping instances: every step is idempotent.
 */
async function tick() {
  if (running) return;
  running = true;
  try {
    await ensureBootstrap();
    await sweepSla();
    const today = await orgToday();
    const last = await getSetting<string | null>("last_daily_reforecast", null);
    if (last !== today) {
      await setSetting("last_daily_reforecast", today);
      const n = await recomputeAll();
      console.log(`[jobs] daily reforecast: ${n} jobs`);
    }
  } catch (e) {
    console.warn("[jobs] sweep failed:", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

export function startJobs() {
  if (started || !process.env.DATABASE_URL) return;
  started = true;
  setTimeout(tick, 15_000);
  setInterval(tick, FIVE_MIN).unref();
}
