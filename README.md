# SteelBuild Pro TopOut

Project management for a structural steel erection PM: jobs, erection sequences and schedule, fabricator deliveries, daily field reports, RFIs/COs/delay notices, drawings, 3D lift list, cost and reports. Single user (the owner). Erection only; fabrication by others.

Design: `docs/superpowers/specs/2026-11-20-topout-design.md`

## Erection features (Phase 2)
- **Erection stages** per sequence — Set (hung) → Plumbed → Bolted-up → Detailed-out / Final — posted from daily reports; the job picks which stage drives % complete. Production chart: tons/day by foreman vs plan.
- **Ready-to-erect gate** per sequence: anchor bolts, concrete, site access, crane pad (marked by the PM) plus steel on site, drawings released and open RFIs (read from the job). Starting a sequence with the gate open asks for a reason. Shown on Today and the Gantt.
- **Cranes & lifts**: crane library with pasted load charts (Settings), crane setups per job, picks checked at the next longer chart radius — ≥ 75 % critical, > 100 % or off-chart blocked — with a printable lift plan. Picks can be added from the model's lift list; radii are measured only where the sheet has a scale and always stay editable.
- **T&M tickets**: labor/equipment/material lines (prefilled from a final daily report), markup, CO link, on-screen GC signature, then locked; printable.
- **3-week look-ahead** and **weekly GC report** (tons by sequence, look-ahead, open RFIs/COs/delays, deliveries, photos) — print or save as PDF.

## Field control & compliance (Phase 3)
- **QC** tab: field bolting log (grade, lot, method, inspector), weld log (welder, WPS, process, NDT), and special inspections per sequence. A failed entry creates one punch item linked to its sequence. A sequence with no records shows "No QC records", never "Clear". The log prints with sign-off lines.
- **Safety** tab: JHA/AHA with steps, hazards, controls, PPE and a competent person (it can't go active until complete), daily pre-task plans started from a JHA with a crew sign-in, toolbox talks with attendance, and printable sign-in sheets. Incidents and near misses stay in the Safety log, which now records injured person, treatment, OSHA recordable, days away and the date reported to the GC.
- **Settings → Certifications**: crew cards (NCCCO operator, rigger, signal person, fall protection, CPR/First Aid, OSHA 10/30, welder) with expiry dates, a matrix and its print. Today lists certifications that are expired, expiring within 30 days, or missing an expiry date. Each classification can require certifications, and a daily report warns when a crew member lacks a current card.
- **Rentals** tab: vendor, PO, on and off rent, day/week/4-week rates (billed the cheapest way), delivery and pickup, and the planned off-rent date with the vendor's notice. Today lists rentals to call off, and overdue ones. Rental cost goes into job cost once; a rented unit on a daily report isn't charged again, and a rental without rates is counted as unpriced, not $0. Standby days come from final daily reports.
- **Photos** tab: every photo on the job by day, with caption, taken date and sequence. Photos attach to daily reports, log items and T&M tickets. An undated photo files under its upload day, marked "uploaded". The weekly GC report and the T&M print include photos.

## Field use and weather (Phase 4)
- **Works with no signal.** After you've opened a job once on a device, the app opens on that device with no connection. Its daily reports, sequences, crew and equipment come from the copy saved on the device.
  - New daily reports, edits to draft reports, and photos save on the device and sync in order when the signal returns. The top bar shows "Offline · N on this device" until they have synced.
  - A save that gets no answer (a dead zone) is kept, never lost. Sending it twice can't make a second report or photo.
  - Finalizing, logs, T&M signatures, QC, safety and the rest still need a connection.
- **Two devices.** If a report was changed on another device after you edited your copy, your copy is held and the top bar shows "1 needs attention". Open it and choose **Keep mine** or **Discard mine**. Nothing is overwritten without your say.
- **Weather.** Give each job a site latitude and longitude (type them, or "Use this device's location" on site). Weather comes from the National Weather Service; US sites only.
  - Daily reports show the day's observed conditions: high and low, wind, gusts, and precipitation. "Fill weather and temperature" copies them into the report.
  - Days at or over your limits are flagged (Settings → Weather limits; defaults: gusts 30 mph, wind 20 mph, precipitation 0.10 in, low 20 °F, high 110 °F).
  - NWS keeps about a week of observations; older days you enter by hand. Unknown values show as "not reported", never as calm or dry.
- **Weather days.** Mark each daily report: no weather delay, partial day lost or full day lost. Flags never decide this; you do.
  - The Daily Reports page keeps the weather-day register against the contract allowance (set on the job).
  - Delay notices show the event date's weather and that day's call.
  - The GC weekly report lists the week's weather days.
  - Today warns of forecast days over your limits in the next three days.

## Commands
- `pnpm dev` — development server (honors `PORT`, default 3000)
- `pnpm test` — unit tests
- `pnpm check` — typecheck
- `pnpm build` / `pnpm start` — production build and server

## Environment
| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | MySQL 8 connection string |
| `SESSION_SECRET` | yes | signs the login session |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | for files | Cloudflare R2 storage |
| `OWNER_RESET_PASSWORD` | no | resets the owner password at startup |
| `R2_ENDPOINT` | no | local testing only: an S3-compatible server instead of Cloudflare (e.g. `node scripts/fake-r2.cjs`) |
| `NWS_BASE_URL` | no | local testing only: a stand-in weather service instead of api.weather.gov (e.g. `node scripts/fake-nws.cjs 9200`) |

## End-to-end checks
On a fresh database, run `node scripts/fake-r2.cjs 9100` and `node scripts/fake-nws.cjs 9200`. Build with `pnpm build`, then start the server with `R2_ENDPOINT=http://127.0.0.1:9100 NWS_BASE_URL=http://127.0.0.1:9200`. Run `scripts/e2e-phase1.cjs`, `scripts/e2e-posting.cjs`, `scripts/e2e-phase2.cjs`, `scripts/e2e-phase3.cjs` and `scripts/e2e-phase4.cjs` in that order. Phase 4 checks offline use in a real browser, so it needs the production build (the service worker only runs there).
