# TopOut Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Field use with bad signal (daily reports and photos save on the tablet and sync later, never silently lost or overwritten), plus NWS weather: daily conditions on daily reports, weather-delay days, and weather on delay notices.

**Architecture:** A hand-written service worker caches the app shell. Selected tRPC queries persist to IndexedDB so the editor opens offline. Daily-report saves and photo uploads go through an outbox in IndexedDB that replays in order when the network returns. The server makes replays idempotent (`clientKey`) and refuses stale overwrites (`baseUpdatedAt` → CONFLICT), which the PM resolves by hand. Weather comes from api.weather.gov server-side, is stored per job and day, and is summarized in the site's own time zone.

**Tech Stack:** Vite 7, React 19, TS, Express + tRPC 11, Drizzle/MySQL 8, Tailwind 4, Vitest (TZ=UTC), Playwright. One new dependency: `@tanstack/react-query-persist-client` (v5, matching react-query).

**Spec:** `docs/superpowers/specs/2026-11-20-topout-design.md` §7 Phase 4, §4 (unknown stays unknown), §9.

## Global Constraints

- Stack stays: Vite + React 19 + TypeScript, Express + tRPC, Drizzle ORM, MySQL 8, Tailwind 4, pnpm.
- Tests run with `TZ=UTC`; date logic that must be local-day aware needs explicit tests.
- Phase ends with: `tsc` clean, all tests green, production build, a browser click-through of changed screens, and a PR to `main`.
- Unknown stays visibly unknown: no weather fetched ≠ "clear"; an unrecorded weather delay ≠ "no delay".
- NWS requests send a generic User-Agent (`SteelBuild-Pro-TopOut`), never the owner's email or name.
- Nothing saved on the tablet may disappear without the PM choosing to discard it.

## Rulings (builder's calls the owner may override)

1. **Offline scope:** daily reports (create/edit, with crew, equipment, progress) and photo uploads. Finalize, logs, T&M signatures, QC, safety and everything else need a connection. Cost if wrong: a foreman can't log a punch item offline.
2. **Two-device edits:** a queued save carries the report's `updatedAt` it was edited from. If the report changed since, the server refuses and the PM chooses "Keep mine" (overwrite) or "Discard mine". No silent last-write-wins.
3. **Weather delay is the PM's call.** The app flags thresholds (default: gust ≥ 30 mph, sustained wind ≥ 20 mph, precipitation ≥ 0.10 in, low ≤ 20 °F, high ≥ 110 °F; editable in Settings → Weather) but never marks a weather day itself.
4. **Location:** each job gets latitude/longitude, typed in or "Use this device's location". No geocoding of the address.
5. **History limit:** NWS keeps about 7 days of observations. Older days not already stored show "Not available from NWS — enter manually".
6. **Weather-days register** counts daily reports marked full or partial weather delay, against an optional "weather days allowed" on the job.

## Review Focus

1. A saved-offline new report replayed twice (lost response) must not create two reports → `clientKey` idempotency test (Task 5) and e2e (Task 8).
2. Observations near local midnight must land on the site's day, not UTC's → weather summary test with America/Phoenix and America/New_York (Task 1).
3. A queued edit to a report that was finalized on the desktop meanwhile must surface as needing attention, not vanish → outbox status test (Task 4) and e2e.
4. NWS down/slow/404 must show "unavailable", never blank-as-fine, and must not hang the editor → service timeout + error mapping test (Task 2).
5. A queued photo for an offline-created report must attach to that report once it syncs → outbox dependency test (Task 4).

---

### Task 1: Weather rules (`shared/weather.ts`)

**Files:** Create `shared/weather.ts`; Test `server/weather.test.ts`.

**Interfaces — Produces:**
- `type WeatherThresholds = { gustMph: number; windMph: number; precipIn: number; lowF: number; highF: number }`; `DEFAULT_WEATHER_THRESHOLDS = { gustMph: 30, windMph: 20, precipIn: 0.1, lowF: 20, highF: 110 }`.
- `type DaySummary = { day: string; source: "observed" | "forecast"; highF: number | null; lowF: number | null; maxWindMph: number | null; maxGustMph: number | null; precipIn: number | null; conditions: string | null; observationCount: number }`.
- `summarizeObservations(obs: NwsObservation[], day: string, timeZone: string): DaySummary` — NWS units (°C, km/h, mm/m) converted; only observations whose local date in `timeZone` equals `day`; precipitation summed from `precipitationLastHour` (null when no reading has a value, never 0); `conditions` = most frequent `textDescription`.
- `summarizeForecast(periods: NwsForecastPeriod[], day: string): DaySummary | null` (hourly forecast periods; local date from the period's own offset in `startTime`).
- `weatherFlags(s: DaySummary, t: WeatherThresholds): string[]` — e.g. `"Gusts 34 mph (limit 30)"`; nulls never flag.
- `weatherText(s: DaySummary): { weather: string; temperature: string }` for the report's existing 128/32-char fields.
- `WEATHER_DELAY = { none: "No weather delay", partial: "Partial day lost", full: "Full day lost" }`; `weatherDayCount(reports: { weatherDelay: string | null }[]) → { full, partial, unrecorded }`.

- [ ] Write tests: unit conversion (20 °C → 68 °F, 48.28 km/h → 30 mph); a 06:30Z observation counts for the previous Phoenix day; precip null when all null; flags at and below limits; forecast day pick; counts. Run `pnpm test server/weather.test.ts` → FAIL (module missing).
- [ ] Implement; run → PASS. Commit `feat: weather rules`.

### Task 2: Weather storage, NWS service and router

**Files:** Modify `drizzle/schema.ts` (projects: `latitude double`, `longitude double`, `weatherDaysAllowed int` nullable, `nwsTimeZone varchar(64)`, `nwsStation varchar(16)`, `nwsHourlyUrl text`; daily_reports: `weatherDelay varchar(8)` nullable; new `weather_days(id, projectId, day, source, summary json, fetchedAt, unique(projectId, day))`); migration `0010_weather`. Create `server/services/nws.ts`, `server/routers/weather.ts`, `scripts/fake-nws.cjs`; register router; Settings key `weather_thresholds`. Test `server/nws.test.ts`.

**Interfaces — Produces:**
- `nws.ts`: `nwsBase()` = `process.env.NWS_BASE_URL || "https://api.weather.gov"`; `nwsGet(path, timeoutMs = 8000)` with UA `SteelBuild-Pro-TopOut`; throws `WeatherUnavailable(reason)` on network error, timeout, non-2xx; `resolvePoint(lat, lon) → { timeZone, station, hourlyUrl }`.
- Router `weather`: `day({ projectId, date }) → { summary: DaySummary | null; flags: string[]; status: "stored" | "fetched" | "no_location" | "too_old" | "unavailable"; reason?: string }` (fetches observed for today and ≤ 7 days back, forecast for future ≤ 7 days, stores observed days except today which is re-fetched); `forecast({ projectId, days = 3 })`; `register({ projectId })` → reports with weatherDelay, summary per day, counts and `allowed`; `thresholds` get/set (admin).
- `dailyReports.save` accepts `weatherDelay: "none" | "partial" | "full" | null`.
- `projects` create/update accept latitude (−90..90), longitude (−180..180), weatherDaysAllowed.

- [ ] Write tests: `nwsGet` maps a 500 and an aborted request to `WeatherUnavailable` (inject fetch); `classifyDay(date, today)` → observed/forecast/too_old. Run → FAIL.
- [ ] Implement schema, migration (`DATABASE_URL=mysql://x@localhost/x pnpm drizzle-kit generate --name weather`), service, router, fake NWS. Run → PASS; `pnpm check`. Commit `feat: NWS weather service and register`.

### Task 3: Weather screens

**Files:** Modify `JobFormDrawer.tsx` (lat/lon + "Use this device's location", weather days allowed), `ReportEditor.tsx` (Weather panel: status/summary/flags, "Fill from NWS" writes weather + temperature fields, Weather delay select with "Not recorded"), log item drawer for delay notices (Weather on event date panel via `weather.day`), `DailyReports.tsx` (Weather days panel from `weather.register`), Today (forecast flags next 3 days per active job with a location), Settings → Weather thresholds, GC weekly print (weather delay days that week).

- [ ] Click-through in the browser after Task 8 server is up; `pnpm check` clean. Commit `feat: weather on reports, delay notices, Today and settings`.

### Task 4: Outbox (pure queue)

**Files:** Create `client/src/features/offline/outbox.ts`, `client/src/features/offline/idbStore.ts`; Test `client/src/features/offline/outbox.test.ts`.

**Interfaces — Produces:**
- `type OutboxItem = { id: string; kind: "dailySave" | "photoUpload"; clientKey: string; dependsOn: string | null; projectId: number; input: unknown; label: string; createdAt: number; status: "pending" | "syncing" | "conflict" | "failed"; error: string | null; attempts: number }`.
- `interface OutboxStore { all(): Promise<OutboxItem[]>; put(i): Promise<void>; remove(id): Promise<void>; getMap(k): Promise<number|undefined>; setMap(k, id): Promise<void> }`; `memoryStore()` for tests, `idbStore()` for the app.
- `enqueue(store, item)` coalesces a `dailySave` with the same `clientKey` still pending (newest input wins, keeps the original `baseUpdatedAt`).
- `drain(store, send: (item, resolvedIds) => Promise<{ id: number }>, isNetworkError)`: in createdAt order; items whose `dependsOn` clientKey has no mapped id wait; on success map `clientKey → id` and remove; network error stops the drain and leaves the item pending; CONFLICT → `conflict`; other errors → `failed` with the message. Never removes an unsent item.
- `resolveConflict(store, id, "keep" | "discard")`.

- [ ] Tests: coalesce; order; dependency waits then sends with resolved id; network error keeps pending and stops; conflict/failed statuses; discard removes only on request. Run → FAIL; implement; PASS. Commit `feat: offline outbox`.

### Task 5: Server idempotency and conflict

**Files:** schema `daily_reports.clientKey varchar(36)` unique, `documents.clientKey varchar(36)` unique; migration `0011_client_keys`; `dailyReports.save` input `clientKey?`, `baseUpdatedAt?: Date`; `collab.upload` input `clientKey?`; pure helper `saveDecision` in `shared/offline.ts`. Test `server/offline.test.ts`.

**Interfaces — Produces:** `saveDecision({ existing: { id, projectId, status, updatedAt } | null, input: { id?, projectId, baseUpdatedAt? } }) → { action: "insert" } | { action: "update", id } | { error: "conflict" | "not_draft" | "wrong_job" }`. A save with no id whose clientKey exists becomes an update of that report. Conflict = `baseUpdatedAt` given and ≠ stored `updatedAt` (second precision). CONFLICT is a `TRPCError` code `CONFLICT`. Upload with a known clientKey returns the existing document.

- [ ] Tests for each decision branch. FAIL → implement → PASS. Commit `feat: idempotent, conflict-checked saves`.

### Task 6: Offline shell

**Files:** Create `client/public/sw.js` (cache-first `/assets/*`, network-first navigations falling back to cached `/`, never `/api`), register in `main.tsx` in production; persist queries `auth.me`, `ref.all`, `projects.*`, `tasks.list`, `daily.list`, `daily.get`, `photos.list` to IndexedDB with `PersistQueryClientProvider` (maxAge 7 days, buster = build id); `useOnline()` hook.

- [ ] Verified by the Playwright offline run in Task 8. Commit `feat: offline app shell and cached job data`.

### Task 7: Offline-aware saves and sync UI

**Files:** `ReportEditor.tsx` save path → `saveDailyOffline` (sends when online; on network error or offline, enqueues with clientKey/baseUpdatedAt and toasts "Saved on this device — will sync"); `DailyReports.tsx` lists unsynced drafts ("Not synced"), opening one edits the outbox entry; `usePhotoUpload` enqueues when offline (dependsOn the report's clientKey when the report isn't synced); Layout top bar badge (Offline · N waiting / Syncing / N need attention) opening a Sync drawer (list, Retry, Keep mine, Discard mine with confirm); runner drains on `online`, on load and every 30 s.

- [ ] Verified in Task 8. `pnpm check`. Commit `feat: save daily reports and photos offline; sync status`.

### Task 8: End-to-end and docs

**Files:** `scripts/e2e-phase4.cjs` (API: clientKey replay → one report; stale baseUpdatedAt → CONFLICT; non-draft refuse; weather day via fake NWS stored + flags; unavailable when fake NWS returns 500; register counts), `scripts/e2e-offline.cjs` (Playwright: load job, go offline, reload, create report, add photo, back online, both synced once; conflict path shows "needs attention"); README Phase 4 section; DEPLOY.md migrations 0010–0011 and optional `NWS_BASE_URL`.

- [ ] Run full suite, build, all e2e suites on a fresh database. Commit `test: phase 4 end-to-end; docs`.
