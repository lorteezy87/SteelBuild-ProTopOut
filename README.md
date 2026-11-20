# SteelBuild Pro TopOut

Project management for a structural steel erection PM: jobs, erection sequences and schedule, fabricator deliveries, daily field reports, RFIs/COs/delay notices, drawings, 3D lift list, cost and reports. Single user (the owner). Erection only; fabrication by others.

Design: `docs/superpowers/specs/2026-11-20-topout-design.md`

## Erection features (Phase 2)
- **Erection stages** per sequence — Set (hung) → Plumbed → Bolted-up → Detailed-out / Final — posted from daily reports; the job picks which stage drives % complete. Production chart: tons/day by foreman vs plan.
- **Ready-to-erect gate** per sequence: anchor bolts, concrete, site access, crane pad (marked by the PM) plus steel on site, drawings released and open RFIs (read from the job). Starting a sequence with the gate open asks for a reason. Shown on Today and the Gantt.
- **Cranes & lifts**: crane library with pasted load charts (Settings), crane setups per job, picks checked at the next longer chart radius — ≥ 75 % critical, > 100 % or off-chart blocked — with a printable lift plan. Picks can be added from the model's lift list; radii are measured only where the sheet has a scale and always stay editable.
- **T&M tickets**: labor/equipment/material lines (prefilled from a final daily report), markup, CO link, on-screen GC signature, then locked; printable.
- **3-week look-ahead** and **weekly GC report** (tons by sequence, look-ahead, open RFIs/COs/delays, deliveries, photos) — print or save as PDF.

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
On a fresh database, start the server with `R2_ENDPOINT=http://127.0.0.1:9100` and `node scripts/fake-r2.cjs 9100` running, then run `scripts/e2e-phase1.cjs`, `scripts/e2e-posting.cjs` and `scripts/e2e-phase2.cjs` in that order.
