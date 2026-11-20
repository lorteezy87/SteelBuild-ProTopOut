# SteelBuild Pro TopOut

Project management for a structural steel erection PM: jobs, erection sequences and schedule, fabricator deliveries, daily field reports, RFIs/COs/delay notices, drawings, 3D lift list, cost and reports. Single user (the owner). Erection only; fabrication by others.

Design: `docs/superpowers/specs/2026-11-20-topout-design.md`

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
