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

## End-to-end checks
On a fresh database, start the server with `R2_ENDPOINT=http://127.0.0.1:9100` and `node scripts/fake-r2.cjs 9100` running, then run `scripts/e2e-phase1.cjs`, `scripts/e2e-posting.cjs`, `scripts/e2e-phase2.cjs` and `scripts/e2e-phase3.cjs` in that order.
