# SteelBuild Pro TopOut — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working single-PM steel-erection app, forked from SteelBuild-Pro, rebranded TopOut, with owner login, R2 file storage, a Today screen and Railway deploy config.

**Architecture:** Copy the SteelBuild-Pro source into this repo, then cut rather than rewrite. The permission system collapses to "the owner is admin" so its ~100 guard call sites keep working unchanged; multi-user screens and routes are deleted. Crew members stay in the existing `users` table as non-login people records, so time entries, assignments and daily-report crew lines need no re-keying.

**Tech Stack:** Vite 7, React 19, TypeScript 5.9, Express 4 + tRPC 11, Drizzle ORM (MySQL 8), Tailwind 4, Vitest 2, pnpm 10, Playwright (verification only).

**Spec:** `docs/superpowers/specs/2026-11-20-topout-design.md`

**Source:** `/tmp/claude-0/-home-user-SteelBuild-Pro-Rev-2/54730df3-8ad1-5da4-8c39-c2474b7c7cf3/scratchpad/keystone` (SteelBuild-Pro, already carrying an email/password module `server/_core/localAuth.ts` and an R2 module `server/storageR2.ts` written earlier in this session). Read-only; never deploy or connect it to any live database.

## Global Constraints

- Product name in every user-visible string: **SteelBuild Pro TopOut** (short **TopOut**). No "Keystone" (any case) anywhere in the repo after Task 2; no `ks-` CSS prefix or `components/ks` path.
- Erection only — fabrication by others. Keep that wording where the source shows it.
- One login: the owner. No other record can sign in.
- Unknown stays visibly unknown (spec §4): never render a NULL date/percent as 0 or "on time".
- Required env: `DATABASE_URL`, `SESSION_SECRET`; R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; optional `OWNER_RESET_PASSWORD`.
- Fresh migration history: one baseline migration (`drizzle/0000_baseline.sql`), generated in Task 7.
- Every task ends green on: `pnpm check`, `pnpm test`. Tasks 7–8 also `pnpm build`.
- Commit per task on branch `phase1` ; PR to `main` at the end.

## Review Focus

1. **Second sign-up attempt after the owner exists** → must be refused, never create a second admin (Task 3 test `registration is closed once an owner exists`).
2. **Crew/people records trying to log in** (they have no credential) → refused; a worker created later with the owner's email must not hijack the owner (Task 3 test `login only matches the owner credential`).
3. **Forgotten password** → `OWNER_RESET_PASSWORD` set at boot replaces the hash once and logs that it did; unset leaves it alone (Task 3 test `reset applies only when env set`).
4. **File link opened while signed out** → 401, not a public R2 URL (Task 7 test `storage route requires owner session`).
5. **Log item with no due date and ball-in-court elsewhere** → not on Today; NULL due date is not "overdue" (Task 6 test `null due date is never overdue`).

---

### Task 1: Import the source and get it green

**Files:**
- Create: everything from the source tree except `node_modules/`, `dist/`, `.manus*`, `.manus-logs/`, `counts.tmp.mjs`, `dc.tmp.mjs`, `vite.config.ts.bak`, `scripts/_local-login.ts`, `template.json`, `BUILD_NOTES.md`, `TODO.md`, `plan.md`, `docs/*.md` (source history docs; the spec replaces them).
- Modify: `README.md` (one paragraph: what TopOut is, `pnpm dev|test|build`, env list from Global Constraints).
- Modify: `vite.config.ts` — remove the Manus debug-collector plugin and `@builder.io/vite-plugin-jsx-loc`; keep react, tailwind, aliases.
- Modify: `package.json` — name `steelbuild-pro-topout`; drop `@builder.io/vite-plugin-jsx-loc`, `add`.

- [ ] **Step 1:** Copy with `rsync -a --exclude ...` from Source into the repo root; keep the repo's `.git` and `docs/superpowers/`.
- [ ] **Step 2:** `pnpm install` (regenerates the lockfile after the package.json edits). Expected: no errors.
- [ ] **Step 3:** `pnpm check && pnpm test` — Expected: tsc exit 0; ≥ 340 tests pass.
- [ ] **Step 4:** Commit `chore: import SteelBuild-Pro source as TopOut baseline`.

### Task 2: Rebrand to SteelBuild Pro TopOut

**Files:**
- Rename: `client/src/components/ks/` → `client/src/components/brand/`; all `ks-` CSS classes/vars → `tp-` (`--ks-*` → `--tp-*`), imports updated.
- Modify: `client/index.html` (`<title>SteelBuild Pro TopOut</title>`), `client/src/components/brand/Status.tsx` (Wordmark renders the SteelBuild Pro badge plus a "TOPOUT" lockup; alt text "SteelBuild Pro TopOut"), `app.config.ts`, sign-in copy, `X-SteelBuild-*` headers left only if still used after Task 5 (they go with webhooks).
- Create: `client/public/brand/topout-mark.svg` (simple I-beam with upward chevron, `currentColor` stroke), favicon from it.
- Test: `server/brand.test.ts`

- [ ] **Step 1: Failing test** — `server/brand.test.ts`:
  - `no legacy name in source`: walk `client/`, `server/`, `shared/`, `drizzle/`, `scripts/`, root `*.md|*.json|*.ts|*.html` (skip `node_modules`, `pnpm-lock.yaml`); assert no file content or path matches `/keystone/i` and no content matches `/\bks-|components\/ks/`.
  - `product title`: `client/index.html` contains `<title>SteelBuild Pro TopOut</title>`.
- [ ] **Step 2:** `pnpm vitest run server/brand.test.ts` — Expected: FAIL (hits listed).
- [ ] **Step 3:** Do the renames with a scripted sed over tracked files, then hand-fix the wordmark and copy.
- [ ] **Step 4:** `pnpm check && pnpm test` — Expected: all pass incl. brand test.
- [ ] **Step 5:** Commit `feat: rebrand to SteelBuild Pro TopOut`.

### Task 3: Owner-only authentication

**Files:**
- Modify: `server/_core/localAuth.ts` → owner model; `server/_core/index.ts` (drop `registerOAuthRoutes`); `server/_core/sdk.ts` (keep only `createSessionToken`/`verifySession`/`authenticateRequest` reading the local user; delete Manus OAuth calls, cron users); `server/_core/env.ts` (remove MANUS_* except as unused; `appId` const `"topout"`, `cookieSecret` = `SESSION_SECRET`).
- Delete: `server/_core/oauth.ts`, `server/_core/{dataApi,heartbeat,imageGeneration,llm,map,notification,voiceTranscription,storageProxy}.ts` and their callers' features (none are in the spec's kept list), `client/src/components/Map.tsx`, `client/src/const.ts` `startLogin` (replace callers with a no-op `requireSignIn()` that invalidates `auth.me`).
- Modify: `client/src/components/shell/SignIn.tsx` — `PasswordSignIn` only: setup mode when no owner, sign-in otherwise; no "invited" link.
- Create: `server/_core/ownerAuth.ts` (pure policy), `server/routers/account.ts` (`changePassword`).
- Test: `server/ownerAuth.test.ts`, extend `server/localAuth.test.ts`.

**Interfaces:**
- Produces: `registrationAllowed(state: { ownerExists: boolean }): boolean`; `applyResetPassword(env: string | undefined, current: string | null): Promise<{ hash: string; changed: boolean } | null>`; tRPC `account.changePassword({ current: string; next: string }) → { ok: true }`; HTTP `POST /api/auth/setup` (first run only), `POST /api/auth/login`, `GET /api/auth/status → { setupRequired: boolean }`. The owner is the single `users` row with `role = "admin"`; its credential lives in `local_credentials`.

- [ ] **Step 1: Failing tests** (`server/ownerAuth.test.ts`):
  - `registration is closed once an owner exists`: `registrationAllowed({ ownerExists: false })` → `true`; `({ ownerExists: true })` → `false`.
  - `reset applies only when env set`: `applyResetPassword(undefined, "scrypt$…")` → `null`; `applyResetPassword("new-pass-123456", "scrypt$…")` → `{ changed: true }` and `verifyPassword("new-pass-123456", hash)` is true; a value under 10 chars → throws `"OWNER_RESET_PASSWORD must be at least 10 characters"`.
  - `login only matches the owner credential`: `pickLoginUser([{ id: 1, role: "admin" }, { id: 2, role: "user" }], credentialUserId)` returns the admin for 1, `null` for 2.
- [ ] **Step 2:** `pnpm vitest run server/ownerAuth.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `server/_core/ownerAuth.ts` (`registrationAllowed`, `applyResetPassword`, `pickLoginUser`); rewire `localAuth.ts` routes to `/api/auth/{status,setup,login}` using them; setup holds the existing `GET_LOCK` serialization; on boot (`server/_core/index.ts`) call `applyResetPassword(process.env.OWNER_RESET_PASSWORD, …)` and `console.warn("[auth] owner password reset from OWNER_RESET_PASSWORD")` when changed.
- [ ] **Step 4:** `account.changePassword` verifies `current`, enforces ≥10 chars, writes new hash; UI under the profile menu → "Change password".
- [ ] **Step 5:** `pnpm check && pnpm test` — Expected: pass.
- [ ] **Step 6:** Commit `feat: owner-only sign-in, password change and env reset`.

### Task 4: Collapse permissions to the owner

**Files:**
- Modify: `server/security/guard.ts` — `loadSecurity(user)` returns `{ isAdmin: user.role === "admin", accessType: "full", … }`; keep exported names so routers compile unchanged.
- Modify: `server/_core/trpc.ts` — `requireUser` additionally rejects any user whose `role !== "admin"` with FORBIDDEN `"Only the owner can sign in."`.
- Delete: `server/security/access.ts` role-evaluation code paths no longer reachable (keep `Privilege` type if routers import it), `security_roles`/role-assignment tables and admin UI `features/admin/{Roles,Workspaces,Users(see Task 5),Integrations,ApiResources}.tsx`.
- Test: `server/platform.test.ts` (update), `server/security.owner.test.ts`.

- [ ] **Step 1: Failing test** `server/security.owner.test.ts`: `owner has every privilege` — for each value in the `Privilege` union list, `can(await loadSecurity(owner), p, 1)` is true; `non-owner cannot pass requireUser` — calling a protected procedure with ctx user `{ role: "user", isActive: true }` rejects with code `FORBIDDEN`.
- [ ] **Step 2:** Run — Expected: FAIL on the second case.
- [ ] **Step 3:** Implement; delete unreachable role/workspace code; fix compile errors by removing workspace filters (projects list shows all jobs).
- [ ] **Step 4:** `pnpm check && pnpm test` — Expected: pass (update or delete tests that asserted multi-user access tiers; list each deleted test in the commit body).
- [ ] **Step 5:** Commit `refactor: single-owner permissions`.

### Task 5: Remove multi-user features; crew as people records

**Files:**
- Delete server: `server/api/v2.ts`, `server/webhooks/`, REST token and webhook tables/routers (`integration.ts`), comment/follower/notification procedures and tables in `collab.ts` (keep documents + activity log), timesheet/expense approval procedures (`canApprove`, `canAuthor`).
- Delete client: `pages/{ApiDocs,Approvals,MyWork,ComponentShowcase}.tsx`, `pages/job/Team.tsx`, notification bell, comment threads, follower UI, `features/admin/Demo.tsx` (keep `server/services/demo.ts` as test seed only, not routed).
- Modify: Daily reports `draft → final` (rename "Approve" to "Finalize"; finalizing posts hours/equipment/tons exactly as approval did). Time entries and expenses: states `saved | recorded`; "Submit" removed; "Record" locks the row; month lock kept.
- Modify: Admin → **Settings**; `features/admin/Users.tsx` → `features/settings/Crew.tsx`: list/create/edit people with name, classification (job role), phone, optional cost/bill rate override, active; no email-login fields. Job roles relabelled **Classifications** (seed: Foreman, Journeyman, Apprentice, Crane Operator, Oiler, Welder) with ST/OT cost and bill rates.
- Test: `server/dailyFinalize.test.ts`, update `server/services/recompute.test.ts` as needed.

**Interfaces:**
- Produces: tRPC `daily.finalize({ id: number }) → { posted: { hours: number; tons: number; pieces: number } }` (replaces `daily.approve`); `time.record({ ids: number[] })`, `expenses.record({ ids: number[] })`; `settings.crew.{list,create,update}`.

- [ ] **Step 1: Failing test** `server/dailyFinalize.test.ts`: `finalize posts once` — using the existing pure posting helper from `services/`, a report with crew line 8 ST + 2 OT and progress 12.5 t / 40 pcs produces one time entry of 10 h (`source: "daily_report"`, state `recorded`) and adds 12.5 t / 40 pcs to the sequence; finalizing an already-final report → throws `"Report is already final"`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement deletions and renames; keep the routing manifest/sidebar in sync (sidebar: Today, Jobs, Logs, Bids, Resources, Hours, Expenses, Reports, Dashboards, Settings).
- [ ] **Step 4:** `pnpm check && pnpm test` — Expected: pass.
- [ ] **Step 5:** Commit `feat: remove multi-user features; crew records and finalize flow`.

### Task 6: Ball-in-court and the Today screen

**Files:**
- Modify: `drizzle/schema.ts` `wfItems` — add `ballInCourt: varchar("ballInCourt", { length: 16 }).default("us").notNull()`; values from `shared/ballInCourt.ts`.
- Create: `shared/ballInCourt.ts`, `shared/today.ts`, `server/routers/today.ts`, `client/src/pages/Today.tsx` (route `/`; Portfolio moves to `/portfolio`).
- Modify: log item form/table — Ball-in-court select and column.
- Test: `server/today.test.ts`

**Interfaces:**
- Produces: `BALL_IN_COURT = ["us","gc","eor","architect","fabricator","other"] as const`; `needsAction(item: { open: boolean; ballInCourt: BallInCourt; dueDate: string | null; slaDueAt: Date | null }, today: string, workDaysAhead: (from: string, n: number) => string): boolean`; `todaySummary(input) → { sequencesAtRisk; loadsDue7; logsNeedingAction; noticeDeadlines }` where each is an array of `{ id; projectId; label; date: string | null }`.

- [ ] **Step 1: Failing tests** `server/today.test.ts`:
  - `ball in our court needs action`: open, `ballInCourt: "us"`, no dates → `true`.
  - `due within 3 work days needs action`: `ballInCourt: "gc"`, due = today + 3 work days → `true`; + 4 → `false`.
  - `past due needs action`: due yesterday → `true`.
  - `null due date is never overdue`: `ballInCourt: "gc"`, `dueDate: null`, `slaDueAt: null` → `false`.
  - `closed items never need action`: `open: false`, `ballInCourt: "us"` → `false`.
  - `work days skip weekends`: today Fri 2026-11-20, +3 work days = 2026-11-25.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement `shared/today.ts` (pure) and `today.summary` query composing existing health, delivery and delay-notice data; Today page shows four panels (Sequences at risk · Loads due in 7 days · Logs needing action · Delay-notice deadlines), each row linking to its job tab; empty panel text "Nothing needs you here."
- [ ] **Step 4:** `pnpm check && pnpm test` — Expected: pass.
- [ ] **Step 5:** Commit `feat: ball-in-court and Today screen`.

### Task 7: Storage, baseline migration, Railway

**Files:**
- Modify: `server/storage.ts` → R2 only (delete Forge path); `server/storageR2.ts` route renamed from `/manus-storage/` to `/files/` and `storagePut` returns `/files/<key>`; update every caller/URL builder and `server/drawingFiles.ts`.
- Delete: `drizzle/0000…0006*.sql`, `drizzle/meta/*`; generate `drizzle/0000_baseline.sql` with `drizzle-kit generate --name baseline`.
- Create/Modify: `railway.json` (Dockerfile build, `pnpm start:railway`, healthcheck `/api/health`), `package.json` `start:railway` = `drizzle-kit migrate && NODE_ENV=production node dist/index.js`, `Dockerfile` (unchanged base), `DEPLOY.md` (Railway + R2 steps, env table, first-run setup, password reset).
- Test: `server/storage.test.ts`

- [ ] **Step 1: Failing tests** `server/storage.test.ts`: `storage route requires owner session` — mount `registerStorageRoute` on an Express app with R2 env set and a stub `authenticateRequest` returning null → `GET /files/a.pdf` is 401; returning the owner → 302 whose `Location` host is `<account>.r2.cloudflarestorage.com` (presigner with fake creds, no network); `rejects traversal` — `GET /files/..%2Fx` → 400.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement; regenerate baseline migration; `pnpm build`.
- [ ] **Step 4:** On a throwaway local MySQL 8 (Docker): `DATABASE_URL=… SESSION_SECRET=… pnpm start:railway` — Expected log: migrations applied, `Server listening on port`, bootstrap installs defaults.
- [ ] **Step 5:** `pnpm check && pnpm test && pnpm build` — Expected: pass.
- [ ] **Step 6:** Commit `feat: R2 storage, baseline migration, Railway config`.

### Task 8: End-to-end verification and PR

**Files:**
- Create: `scripts/e2e-phase1.cjs` (Playwright, runs against the Task 7 local server; not part of `pnpm test`).

- [ ] **Step 1:** Script asserts, against a fresh database: setup screen → owner created → Today renders with empty-state text → create job "26-001 Test Erection" → add sequence "Seq 1 — Grids 1–4" (planned 40 t) → add a crew person (Journeyman) → daily report with 8 h and 5 t, Finalize → sequence shows 5 t / 40 t → open RFI with ball-in-court "us" appears on Today → sign out → second setup attempt via `POST /api/auth/setup` returns 403 → sign in works. Screenshot each screen at 1440×900 and 1024×768 (tablet).
- [ ] **Step 2:** Run it — Expected: every assertion PASS; review screenshots for any "Keystone", Manus, Team, Approvals, API or notification UI remnants.
- [ ] **Step 3:** `pnpm check && pnpm test && pnpm build` — final green.
- [ ] **Step 4:** Push `phase1`, open draft PR to `main` titled "Phase 1: TopOut baseline — single PM, owner login, Today, R2, Railway", body listing what was removed, what was added, test counts and screenshots.
