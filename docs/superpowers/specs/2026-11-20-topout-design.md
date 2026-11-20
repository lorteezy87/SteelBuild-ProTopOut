# SteelBuild Pro TopOut — Design

Status: approved by owner 2026-11-20 ("mimic the working app, from a steel erector point of view — continue")

## 1. Intent

TopOut is a standalone project-management app for **one structural steel erection PM** (the owner). It tracks every erection job from award to topping out: schedule and sequences, fabricator deliveries, field production, crane and lift planning, RFIs/COs/delay notices, drawings, cost, and the reports a GC asks for.

It is a new app with its own repository (`lorteezy87/SteelBuild-ProTopOut`), its own database and its own hosting. It is **not** SteelBuild-Pro (the live multi-user app on Railway) and **not** SteelBuild Pro Rev.2. No data is shared with either.

Why a fork rather than a fresh build: SteelBuild-Pro already contains a tested scheduling engine (CPM, calendars, constraints), Gantt, health/EVA projection, a drawing register with PDF viewer, and a 3D model/lift-list reader — about 340 unit tests' worth of logic. Rewriting those is weeks of work and the main source of new bugs.

## 2. Goals

1. One PM, one login, desktop-first with a usable tablet layout.
2. Keep everything in SteelBuild-Pro that helps a PM run erection jobs (§5).
3. Remove everything that exists only to manage other users (§6).
4. Add erection-specific features (§7), phased so each phase ships usable.
5. Deployable to Railway: MySQL + Cloudflare R2 storage, one start command that migrates then serves.

## 3. Non-goals

- Multiple users, roles, permissions, approvals between people, invitations.
- Fabrication/detailing workflows (erection only; fabrication by others).
- Public API, webhooks, integrations with accounting/payroll.
- Native mobile apps.
- Migrating data from SteelBuild-Pro or Rev.2 (can be a later, separate request).

## 4. Anti-goals (failure even if it "works")

- Showing a claim the data doesn't support (e.g. "0%" for unknown progress, "on time" for a load with no promised date). Unknown stays visibly unknown.
- Losing an entry the PM saved. Every save either persists or shows an error; no silent drops.
- A second app with SteelBuild-Pro's or Keystone's name/branding inside it. Product name is **SteelBuild Pro TopOut** everywhere user-visible; no "Keystone" anywhere in source, docs or UI.
- Desktop-only screens that are unusable on a tablet in the truck.

## 5. Kept from SteelBuild-Pro (behavior unchanged unless noted)

| Area | Notes |
|---|---|
| Jobs (portfolio, job page, title-block header) | Fields as today. Workspaces collapse to none. |
| Sequences & tasks, WBS, dependencies, constraints, move/assign/shift | Assignments are crew/equipment **resources**, not app users. |
| Scheduling engine, critical path, calendars & holidays | Unchanged; existing tests carried over. |
| Gantt, Board, Baselines + EVA, health / Reforecast | Unchanged. |
| Fabricator deliveries + "Create delay notice" | Unchanged. |
| Daily field reports | Draft → Final (no approval step). Finalizing posts crew hours, equipment hours and erected tons/pieces, as "Approved" does today. |
| Workflow logs: RFI, Submittal, CO, Delay Notice, Backcharge, Delivery Issue, Safety Observation, Punch, Risk, Bid pipeline | SLA clocks kept; "assignee/requestor" become free-text or company contacts. |
| Drawings register, PDF viewer, marks/scales, release holds tied to RFIs | Unchanged. |
| 3D model, pieces, lift list, totals | Unchanged; feeds §7.2. |
| Financials, expenses | Expenses: Saved → Recorded (no approval). Labor cost from crew rates. |
| Report builder, dashboards, custom fields, documents with revisions | Unchanged minus sharing. |
| Companies & contacts, equipment, crew roles & rates, calendars, codes | Admin area becomes **Settings**. |
| Executive theme, dark mode | Rebranded (§8). |

## 6. Removed

- Manus OAuth, users table as people-who-log-in, access types (Full/Team/Timesheet/App/Passive), security roles & privileges, auto-roles, workspaces.
- Timesheet submit/approve/reject/invoice chain and the Approvals page (crew hours come from daily reports; a simple hours grid remains for corrections).
- Expense approval chain.
- Comments/@mentions, followers, notification center, activity "who did what" attribution (activity log stays, single actor).
- REST API v2, API tokens, API docs page, webhooks.
- Team tab, My Work (replaced by Today, §7.1), demo-data loader (replaced by a "sample job" seed for screenshots/tests only).
- Manus storage (Forge) → Cloudflare R2. Manus image generation, voice, maps helpers.

Removed server checks are replaced by one rule: every API call requires the owner session.

## 7. Added — erection features (phased)

### Phase 1 — Fork, slim, rebrand, deploy-ready
1. **Single-owner login**: email + password set on first run; scrypt hash; lockout after repeated failures; session cookie; "change password"; a CLI/env reset (`OWNER_RESET_PASSWORD`) for a forgotten password.
2. Remove §6, rebrand §8, R2 storage, Railway config (`railway.json`, migrate-then-start).
3. **Today** home: overdue/at-risk sequences, loads due in 7 days, RFIs/COs needing action, delay-notice deadlines inside the job's notice window, certs/rentals expiring (once Phase 3 lands).

### Phase 2 — Run the erection
1. **Erection stages per sequence**: Set (hung) → Plumbed → Bolted-up → Detailed-out / Final, each with tons/pieces and %; progress method can use any stage. Production chart: tons/day and pieces/day by crew vs plan.
2. **Ready-to-erect gate per sequence**: checklist (anchor bolt survey accepted, concrete strength/cure, site access & laydown, crane pad/ground bearing, steel on site, drawings released, open RFIs on sequence). Gate status shows on Gantt and Today; starting a sequence with an open gate item asks for a reason.
3. **Crane & lift planning**: crane library (model, max capacity, radius/capacity table entered or pasted), crane setups per job (position on grid, boom, counterweight). Picks from the model lift list are matched to a setup by radius; percent of chart capacity computed; ≥75% flagged **critical lift**, >100% blocked. Lift plan PDF per critical pick (rigging weight, load, radius, capacity, sign-offs).
4. **T&M / extra-work tickets**: labor, equipment, material lines (prefilled from a daily report), linked to a CO; on-screen signature for the GC super; PDF.
5. **3-week look-ahead** (from the schedule) and **weekly GC report** (tons erected by sequence vs plan, look-ahead, open RFIs/COs/delays, deliveries, photos) — print/PDF.

### Phase 3 — Field control & compliance
1. **QC logs**: bolt installation/tension (method, lot, inspector), weld log, special-inspection tracking per sequence, deficiencies → punch.
2. **Safety**: JHA/AHA per activity, pre-task plans, toolbox talks (topic, date, attendees), incident/near-miss log.
3. **Certifications tracker**: per crew member (NCCCO operator, rigger, signal person, fall protection, CPR/First Aid, OSHA 10/30) with expiry alerts on Today.
4. **Equipment rentals**: vendor, on-rent/off-rent, rate, standby, call-off reminder; rental cost into job financials.
5. **Photo log**: by job/sequence/date with captions, attachable to reports, logs and tickets.

### Phase 4 — Optional
1. Offline-tolerant tablet use (local queue + sync).
2. Weather: daily conditions and weather-delay days (NWS API) attached to daily reports and delay notices.

## 8. Brand & look

- Name: **SteelBuild Pro TopOut** (short: TopOut). Wordmark = SteelBuild Pro mark + "TOPOUT" lockup; tagline optional.
- Start from SteelBuild-Pro's Executive theme (Inter; Foundry Black side rail; white work area; navy actions; amber active marker; dark mode). Rename internal `ks-`/`components/ks` to `tp-`/`components/brand` so no legacy name remains.
- Favicon/PWA icon: new TopOut mark (builder creates a simple SVG; owner may swap in final art).

## 9. Constraints

- Stack stays: Vite + React 19 + TypeScript, Express + tRPC, Drizzle ORM, MySQL 8, Tailwind 4, pnpm.
- Fresh migration history (single baseline migration) — no data to preserve.
- Hosting: Railway project (owner creates it) with MySQL plugin; files in a new R2 bucket (owner's Cloudflare account). Variables: `DATABASE_URL`, `SESSION_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- Tests run with `TZ=UTC`; date logic that must be local-day aware needs explicit tests.
- Every phase ends with: `tsc` clean, all tests green, production build, a browser click-through of changed screens, and a PR to `main`.

## 10. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **Fork SteelBuild-Pro, slim to one PM, add erection features** | Fastest; keeps tested engine, Gantt, drawings, 3D. Carries some of its internal complexity. | **Chosen** (recommended; owner approved the doc) |
| Fresh lean build, porting logic | Cleanest code; several times longer; Gantt/PDF/3D re-ported by hand. | Rejected for time and risk. |
| Local-first/offline-first from day one | Best on bad signal; sync is the most complex part. | Deferred to Phase 4. |

## 11. Decided by the owner

- New standalone app, single user (the PM).
- Name built on the SteelBuild Pro brand → SteelBuild Pro TopOut.
- Repo: `lorteezy87/SteelBuild-ProTopOut`.
- Features beyond the original: builder's judgment ("add any additional features that would be helpful").

## 12. Builder's calls (owner may override)

1. **Crew model.** Crew members are named workers (no login) with a craft classification (Foreman, Journeyman, Apprentice, Operator, Oiler…). Labor cost uses the classification's ST/OT rate, with an optional per-worker override. Certifications attach to the worker; "production by crew" groups on the foreman of the daily report. Implementation: crew members are stored as non-login rows in the existing `users` table (the owner is the only row that can sign in), so time entries, assignments, expenses and daily-report crew lines keep their keys; assignments can also target a classification (e.g. 4 × Journeyman).
2. **"Needs action" on Today.** An open log item needs action when ball-in-court is on us, or its SLA/due date is past or within 3 work days. Ball-in-court (us / GC / EOR / Architect / Fabricator / Other) is a field on every log item from Phase 1.
3. **Crane radius.** Owner did not choose; default applies: the PM enters or confirms the radius for each pick; the app pre-fills it only when a piece and the crane setup are on the same sheet with a set scale. No automatic job-wide geometry.

## 13. Left to the builder

Table and route names; how removed features are excised (delete vs. hide); UI layout of new screens within the theme; PDF library choice (pdf-lib is already a dependency); crane chart entry format; seed data for tests.
