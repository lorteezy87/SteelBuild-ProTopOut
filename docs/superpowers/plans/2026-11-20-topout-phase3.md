# SteelBuild Pro TopOut — Phase 3 Implementation Plan ("Field control & compliance")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five Phase 3 field-control features:
1. QC logs (bolting, welding, special inspections, deficiencies → punch).
2. Safety (JHA/AHA, pre-task plans, toolbox talks, incident/near-miss log).
3. A crew certifications tracker with expiry alerts.
4. Equipment rentals, with call-off reminders and rental cost in job financials.
5. A photo log.

**Architecture:** This follows Phase 2.
- Every rule lives in a pure module under `shared/` and is tested directly by Vitest in `server/*.test.ts`.
- Routers in `server/routers/` load rows, apply the shared rule, and write inside a transaction wherever a write claims state.
- Job features are job tabs. Crew certifications live in Settings, because they belong to people, not jobs.
- Printables are `/print/*` routes inside `PrintShell`.
- Each task adds one Drizzle migration (`0005_…` onward).

**Tech Stack:** Vite 7, React 19, TypeScript 5.9, Express 4 + tRPC 11, Drizzle ORM (MySQL 8), Tailwind 4, Vitest 2 (TZ=UTC), pnpm 10, Playwright (verification only).

**Spec:** `docs/superpowers/specs/2026-11-20-topout-design.md`. This plan covers §7 Phase 3 and the Today line in §7 Phase 1.3 ("certs/rentals expiring (once Phase 3 lands)"), and respects the §4 anti-goals.

## Global Constraints

- **Naming:** user-visible strings say **SteelBuild Pro TopOut** (short: TopOut). No legacy name (`server/brand.test.ts`).
- **Scope:** erection only. One login, the owner. Every new procedure is a `protectedProcedure` and calls `requireJobModule(ctx, projectId)` when it touches a job.
- **Unknown stays unknown (§4).**
  - A missing expiry date, rate, inspection result or photo date is never shown as current, $0, pass or a guessed date.
- **Never lose a saved entry.** A refused write returns a TRPCError with a plain-English message.
- **"Today"** comes from `orgToday()` (`server/services/calendars.ts`), never `new Date()` in a rule. Rules take `today: string` (YYYY-MM-DD).
- **Migrations:** generate with `DATABASE_URL=mysql://x@localhost/x pnpm drizzle-kit generate --name <name>`. Additive only, and never edit `0000_baseline.sql`.
- **Logs:** new log fields on existing deployments come from an idempotent boot step, not only from the empty-database seed.
- **Done means:** every task ends green on `pnpm check` and `pnpm test`. Task 6 adds `pnpm build`, the e2e scripts and the browser checks.
- **Git:** commit per task on branch `phase3`, then open a PR to `main`.

## Review Focus

1. **Missing expiry date.** A certification whose type expires but has no expiry date shows "Expiry unknown" and is listed on Today. It is never "Current".
   - Test: Task 3, `expiring type with no date is unknown, not current`.
2. **Rental with no rate entered.** Cost is unknown: the rental shows "Rate not entered", and Financials reports "1 rental unpriced" rather than adding $0.
   - Test: Task 4, `no rates is unknown cost`.
3. **Rented crane on a daily report.** When a final daily report lists equipment that is on rent to the same job that day, it is costed once, through the rental. The daily-report equipment cost for those rows is excluded.
   - Test: Task 4, `daily equipment covered by a rental is not double counted`.
4. **Rental past its planned off-rent date and not called off.** It shows "Overdue — still on rent" and appears on Today.
   - Test: Task 4, `past planned off-rent is overdue`.
5. **Creating a punch item twice from one failed QC entry.** The second request is refused with "Punch item PL-### already created". Only failed entries can create one.
   - Test: Task 1, `only an unlinked failed entry can create a punch item`.

---

### Task 1: QC logs — bolting, welding, special inspections, deficiencies → punch

**Files:**
- Create: `shared/qc.ts`, `server/qc.test.ts`, `server/routers/qc.ts`, `client/src/pages/job/Qc.tsx`, `client/src/features/qc/{BoltLog,WeldLog,Inspections}.tsx`, `client/src/pages/print/QcLog.tsx`, migration `0005_qc_logs`
- Modify: `drizzle/schema.ts`, `server/routers.ts`, `client/src/pages/job/JobLayout.tsx` (tab `qc`, "QC"), `App.tsx` print route `/print/qc/:projectId`

**Interfaces:**
- **Produces, in `shared/qc.ts`:**
  - `BOLT_METHODS = { snug_tight: "Snug-tight", turn_of_nut: "Turn-of-nut", calibrated_wrench: "Calibrated wrench", twist_off: "Twist-off (TC)", dti: "DTI" }`
  - `BOLT_GRADES = { a325: "A325 / F3125 Gr A325", a490: "A490 / F3125 Gr A490", f1852: "F1852 (TC)", f2280: "F2280 (TC)", a307: "A307", other: "Other" }`
  - `WELD_PROCESSES = { smaw: "SMAW (stick)", fcaw: "FCAW", gmaw: "GMAW", saw: "SAW" }`
  - `NDT_METHODS = { none: "Visual only", ut: "UT", mt: "MT", pt: "PT", rt: "RT" }`
  - `QC_RESULTS = { pending: "Pending", pass: "Pass", fail: "Fail" }`
  - `SI_TYPES = { bolting: "High-strength bolting", welding: "Field welding", deck: "Deck welding / fastening", studs: "Shear studs", anchor_rods: "Anchor rods", other: "Other" }`
  - `SI_RESULTS = { requested: "Requested", scheduled: "Scheduled", passed: "Passed", failed: "Failed", na: "Not required" }`
  - `type QcEntry = { result: keyof typeof QC_RESULTS; punchItemId: number | null }`
  - `canCreatePunch(e: QcEntry): { ok: true } | { ok: false; reason: string }`
    - Not failed → "Only failed entries create punch items".
    - Already linked → "Punch item already created". The router appends the label.
  - `boltPunchTitle(e: { location: string; grade: string; method: string }): string` → `"Bolting deficiency — {location} ({grade label}, {method label})"`
  - `weldPunchTitle(e: { location: string; process: string }): string` → `"Weld deficiency — {location} ({process label})"`
  - `inspectionPunchTitle(e: { type: string; reportNumber: string | null }): string`
  - `sequenceQcStatus(input: { bolt: QcEntry[]; weld: QcEntry[]; inspections: { result: keyof typeof SI_RESULTS }[] }): "deficiency" | "pending" | "clear" | "no_records"`
    - Any `fail` or `failed` → `deficiency`.
    - Otherwise any `pending`, `requested` or `scheduled` → `pending`.
    - No rows at all → `no_records`. This is not clear.
    - Otherwise → `clear`.
- **Schema:**
  - `qc_bolt_logs`: id, projectId, taskId (sequence, nullable), logDate (day), location varchar(200), grade, method, lotNumber varchar(64) nullable, boltCount int nullable, inspectorName varchar(120) nullable, result default `pending`, notes text, punchItemId int nullable, createdAt.
  - `qc_weld_logs`: id, projectId, taskId, logDate, location, welderUserId int nullable, welderName varchar(120) nullable, wps varchar(64) nullable, process, weldSize varchar(32) nullable, ndt default `none`, inspectorName, result, notes, punchItemId, createdAt.
  - `special_inspections`: id, projectId, taskId, type, agency varchar(120) nullable, requestedDate day nullable, scheduledDate day nullable, inspectedDate day nullable, result default `requested`, reportNumber varchar(64) nullable, notes, punchItemId, createdAt.
  - Index `(projectId, taskId)` on each.
- **tRPC `qc`:**
  - `bolts`, `welds` and `inspections`, each with `list({ projectId, taskId? })`, `create`, `update` and `remove`.
  - `summary({ projectId })` returns `{ taskId, name, status }[]` per sequence.
  - `createPunch({ kind: "bolt" | "weld" | "inspection", id })` calls `createItem` from `server/services/wf.ts`:
    - app `punch`
    - the entry's job
    - title from the matching `*PunchTitle`
    - `linkedTaskId` = the entry's sequence
    - custom field `location`
    - custom field `punch_scope = "erector"`
  - It then stores `punchItemId`. The check and the write happen in one transaction that row-locks the entry (`for update`).
  - It returns `{ itemId, label }`.

- [ ] **Step 1: Write the failing tests** in `server/qc.test.ts`:
  - `only an unlinked failed entry can create a punch item`:
    - `{result:"pending",punchItemId:null}` → not ok.
    - `{result:"fail",punchItemId:null}` → ok.
    - `{result:"fail",punchItemId:7}` → not ok, reason contains "already created".
  - `punch titles name the location and method`:
    - `boltPunchTitle({location:"Grid C/4 L2",grade:"a325",method:"turn_of_nut"})` = `"Bolting deficiency — Grid C/4 L2 (A325 / F3125 Gr A325, Turn-of-nut)"`.
  - `sequence QC status`:
    - No rows → `no_records`.
    - One weld `pass` → `clear`.
    - A pass plus an inspection `scheduled` → `pending`.
    - Any bolt `fail` → `deficiency`, even if every inspection `passed`.
- [ ] **Step 2: Run** `pnpm vitest run server/qc.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `shared/qc.ts`.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Schema and migration.** Add the three tables and generate `0005_qc_logs`.
- [ ] **Step 6: Router** `server/routers/qc.ts`, registered as `qc`. Each `create` or `update` that sets a `taskId` checks that the task belongs to the job and has kind `sequence`.
- [ ] **Step 7: Client.**
  - The **QC tab** has a sequence filter, three sub-tabs (Bolting / Welding / Special inspections) and a per-sequence status strip:
    - "Deficiency" red, "Pending" amber, "Clear" green.
    - "No QC records" grey, never green.
  - On a failed row, "Create punch item" shows the created label (`PL-###`) and links to it afterward.
  - The welder picker draws on the crew roster, with a free-text fallback.
  - "Print QC log" opens `/print/qc/:projectId?sequence=` with three tables and an inspector signature line.
- [ ] **Step 8: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 9: Commit** `feat: QC logs for bolting, welding and special inspections with punch deficiencies`.

### Task 2: Safety — JHA/AHA, pre-task plans, toolbox talks, incident log

**Files:**
- Create: `shared/safety.ts`, `server/safety.test.ts`, `server/routers/safety.ts`, `client/src/pages/job/Safety.tsx`, `client/src/features/safety/{JhaEditor,PtpEditor,ToolboxEditor,Attendees}.tsx`, `client/src/pages/print/{Jha,Ptp,Toolbox}.tsx`, migration `0006_safety`
- Modify: `drizzle/schema.ts`, `server/routers.ts`, `server/bootstrap/presets.ts` (safety log fields), `server/bootstrap/index.ts` (`ensureAppFields` on every boot), `JobLayout.tsx` (tab `safety`, "Safety"), `App.tsx` print routes

**Interfaces:**
- **Produces, in `shared/safety.ts`:**
  - `type JhaStep = { step: string; hazards: string; controls: string }`
  - `type Attendee = { userId: number | null; name: string }`
  - `JHA_STATUSES = { draft: "Draft", active: "Active", archived: "Archived" }`
  - `PPE_ITEMS = { hard_hat, safety_glasses, hi_vis, gloves, boots, harness, srl, face_shield, hearing, respirator }`, each with a plain label such as "Harness" or "SRL / lanyard".
  - `jhaProblems(j: { title: string; steps: JhaStep[]; competentPerson: string | null }): string[]`
    - Empty title → "Enter the activity".
    - No steps → "Add at least one step".
    - A step missing hazards or controls → `"Step {n} needs hazards and controls"`.
    - No competent person → "Name the competent person".
    - An empty list means it can go `active`.
  - `normalizeAttendees(list: Attendee[]): Attendee[]`
    - Trims names and drops blank names.
    - Removes duplicates: by `userId` when set, else by lower-cased name. First wins.
  - `INCIDENT_FIELDS: FieldPreset[]` (keys below), exported for presets.
- **Schema:**
  - `jhas`: id, projectId, taskId nullable, title varchar(200), status default `draft`, steps json `JhaStep[]`, ppe json `string[]`, competentPerson varchar(120) nullable, reviewedOn day nullable, createdAt, updatedAt.
  - `pre_task_plans`: id, projectId, planDate day, foremanId int nullable, taskId nullable, jhaId nullable, workDescription text, steps json `JhaStep[]`, ppe json, attendees json `Attendee[]`, createdAt.
  - `toolbox_talks`: id, projectId, talkDate day, topic varchar(200), presenter varchar(120) nullable, notes text, attendees json, createdAt.
- **Incident / near-miss log:** reuse the existing `safety` log app. Add these fields to its preset and to `ensureAppFields`:
  - `injured_person` (text)
  - `treatment` (select: none / first_aid / medical / lost_time)
  - `osha_recordable` (select: yes / no / tbd)
  - `days_away` (number)
  - `reported_to_gc_on` (date)
  - `ensureAppFields(d, preset)`, in `server/bootstrap/index.ts`, inserts any preset field missing by `(entity, key)` for an app that already exists. It runs on every boot and never changes or deletes existing fields.
- **tRPC `safety`:**
  - `jhas`, `ptps` and `talks`, each with `list({ projectId })`, `get`, `create`, `update` and `remove`.
  - `jhas.update` to `active` with problems → PRECONDITION_FAILED, listing the problems.
  - `ptps.create({ fromJhaId })` copies that JHA's steps and PPE.
  - Attendees pass through `normalizeAttendees` on write.

- [ ] **Step 1: Write the failing tests** in `server/safety.test.ts`:
  - `a JHA needs an activity, steps with hazards and controls, and a competent person`:
    - Empty → all four messages, in the order above.
    - Step 2 missing controls → contains `"Step 2 needs hazards and controls"`.
    - A complete JHA → `[]`.
  - `attendees are trimmed and de-duplicated`:
    - `[{userId:3,name:"A"},{userId:3,name:"A again"},{userId:null,name:" Joe "},{userId:null,name:"joe"},{userId:null,name:"  "}]` → `[{userId:3,name:"A"},{userId:null,name:"Joe"}]`.
  - `ensureAppFields adds only missing fields`:
    - Uses the pure helper `missingFields(existingKeys: string[], preset: FieldPreset[]): FieldPreset[]` from `shared/safety.ts`. `ensureAppFields` uses it too.
    - Existing `["observation_type","location"]` with the safety preset → exactly the five incident keys plus `corrective_action` when missing.
- [ ] **Step 2: Run** `pnpm vitest run server/safety.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/safety.ts`.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Schema, migration `0006_safety`, router, and the `ensureAppFields` boot step.**
- [ ] **Step 6: Client.**
  - The **Safety tab** has four sub-tabs:
    - JHA/AHA: list, editor and status badge. Activating shows the problems inline.
    - Pre-task plans: by date, "Start from JHA…".
    - Toolbox talks.
    - Incidents: links into the Safety log, filtered to observation type incident or near miss.
  - The `Attendees` picker uses crew roster checkboxes plus "Add visitor" by name.
  - Print pages:
    - JHA: steps table, PPE ticks, competent-person signature line.
    - PTP: the same, plus a sign-in table with blank signature cells.
    - Toolbox talk: topic, notes, sign-in table.
- [ ] **Step 7: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 8: Commit** `feat: safety — JHA/AHA, pre-task plans, toolbox talks, incident fields`.

### Task 3: Certifications tracker with expiry alerts

**Files:**
- Create: `shared/certs.ts`, `server/certs.test.ts`, `server/routers/certs.ts`, `client/src/features/settings/Certifications.tsx`, `client/src/pages/print/CertMatrix.tsx`, migration `0007_certifications`
- Modify: `drizzle/schema.ts` (`certifications`; `job_roles.requiredCerts json string[]` default `[]`), `server/routers.ts`, `shared/today.ts` + `server/routers/today.ts` + `client/src/pages/Today.tsx` (panel), `client/src/pages/admin/AdminLayout.tsx` (section "Certifications"), the job-role editor (required certs multi-select), `client/src/features/daily/ReportLines.tsx` (crew warning)

**Interfaces:**
- **Produces, in `shared/certs.ts`:**
  - `CERT_TYPES`: `Record<string, { label: string; expires: boolean }>`, in this order:

    | Key | Label | Expires |
    |---|---|---|
    | `nccco_operator` | NCCCO Crane Operator | yes |
    | `nccco_rigger1` | NCCCO Rigger Level I | yes |
    | `nccco_rigger2` | NCCCO Rigger Level II | yes |
    | `nccco_signal` | NCCCO Signalperson | yes |
    | `fall_protection` | Fall Protection | yes |
    | `cpr_first_aid` | CPR / First Aid | yes |
    | `osha10` | OSHA 10 | no |
    | `osha30` | OSHA 30 | no |
    | `aws_welder` | AWS / D1.1 Welder Qualification | yes |
    | `other` | Other | yes |

  - `CERT_WARN_DAYS = 30`
  - `type CertStatus = "current" | "expiring" | "expired" | "unknown" | "no_expiry"`
  - `certStatus(c: { certType: string; expiresOn: string | null }, today: string): CertStatus`
    - Type doesn't expire → `no_expiry`.
    - No date → `unknown`.
    - `expiresOn < today` → `expired`. The expiry day itself still counts as valid.
    - `expiresOn <= today + 30` → `expiring`.
    - Otherwise → `current`.
  - `CERT_STATUS_LABEL = { current: "Current", expiring: "Expires {date}", expired: "Expired {date}", unknown: "Expiry unknown", no_expiry: "No expiry" }`. The client fills in `{date}`.
  - `crewCertGaps(required: string[], certs: { certType: string; expiresOn: string | null }[], onDate: string): string[]`
    - Returns the labels of required types with no cert that is `current`, `expiring` or `no_expiry` on `onDate`.
    - An `unknown` cert does not satisfy the requirement. It is reported as `"{label} (expiry unknown)"`.
  - Extends `todaySummary` with input `certs?: { id, userId, name, certType, expiresOn }[]` and output `certsDue: { id, label, date, status }[]`.
    - It lists `expired`, `expiring` and `unknown`, sorted expired first, then by date, with nulls last.
    - `label` = `"{name} · {type label}"`.
- **Schema:** `certifications`: id, userId, certType varchar(32), certNumber varchar(64) nullable, issuer varchar(120) nullable, issuedOn day nullable, expiresOn day nullable, fileKey varchar(500) nullable, fileUrl varchar(1000) nullable, notes varchar(500) nullable, createdAt, updatedAt. Index `(userId)`.
- **tRPC `certs`:**
  - `list({ userId? })` returns `{ ...cert, userName, status }`.
  - `create`, `update` and `remove`.
  - `upload({ id, file:{fileName,mimeType,base64} })` stores the card scan via `storagePut` under `certs/{userId}/…` (25 MB cap, like documents).
  - `matrix()` returns `{ users:[{id,name,classification}], types: string[], cells: Record<"userId:type", { status, expiresOn }> }`. It covers active crew only, and when someone holds several certs of one type, the latest expiry wins.
  - `daily.get` returns `certGaps: Record<crewLineUserId, string[]>` for crew lines whose classification has `requiredCerts`, evaluated on the report date.

- [ ] **Step 1: Write the failing tests** in `server/certs.test.ts` (today = `2026-11-20`):
  - `expiring type with no date is unknown, not current` → `certStatus({certType:"nccco_operator",expiresOn:null}, today)` = `"unknown"`.
  - `OSHA cards never expire` → `osha30` with a null date = `"no_expiry"`.
  - `expiry boundaries`:
    - `2026-11-19` → `expired`.
    - `2026-11-20` → `expiring`.
    - `2026-12-20` → `expiring` (day 30).
    - `2026-12-21` → `current`.
  - `required cert gaps on the report date`:
    - Required `["nccco_operator","osha10"]` with certs `[{nccco_operator, expiresOn:"2026-11-10"}]` on `2026-11-20` → `["NCCCO Crane Operator","OSHA 10"]`.
    - The same with the operator cert at `expiresOn:null` → `["NCCCO Crane Operator (expiry unknown)","OSHA 10"]`.
  - `Today lists expired, expiring and unknown certs`: three certs (expired 11-01, unknown, current 2027-06-01) → ids in order `[expired, unknown]`.
- [ ] **Step 2: Run** `pnpm vitest run server/certs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/certs.ts` and the `todaySummary` extension.
- [ ] **Step 4: Run** the same test plus `server/today.test.ts`. Expected: PASS.
- [ ] **Step 5: Schema, migration `0007_certifications`, router, `daily.get` gaps, Today wiring.**
- [ ] **Step 6: Client.**
  - **Settings → Certifications** has two views:
    - Matrix: crew × types, colored cells, with "Expiry unknown" shown in amber.
    - List: add, edit, upload the card, view the card.
  - Print matrix at `/print/certs`, for GC orientation packets.
  - The job-role editor gets a required-certs multi-select.
  - Daily-report crew lines show an amber "Missing: …" note. It warns and never blocks.
  - Today panel "Certifications due": `{name} · {type}` with the status label, linking to Settings → Certifications.
- [ ] **Step 7: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 8: Commit** `feat: crew certifications tracker with expiry alerts on Today`.

### Task 4: Equipment rentals — call-off reminders and cost in job financials

**Files:**
- Create: `shared/rentals.ts`, `server/rentals.test.ts`, `server/routers/rentals.ts`, `client/src/pages/job/Rentals.tsx`, migration `0008_equipment_rentals`
- Modify: `drizzle/schema.ts`, `server/routers.ts`, `server/services/recompute.ts` (`projectCosts`), `server/routers/financials.ts` + `client/src/pages/job/Financials.tsx` (Rentals line), `shared/today.ts` + `server/routers/today.ts` + `Today.tsx` (panel), `JobLayout.tsx` (tab `rentals`, "Rentals")

**Interfaces:**
- **Produces, in `shared/rentals.ts`:**
  - `type Rates = { dayRate: number | null; weekRate: number | null; monthRate: number | null }`
  - `RENTAL_MONTH_DAYS = 28`
  - `billedDays(onRent: string, offRent: string | null, today: string): number`
    - Calendar days from `onRent` to `offRent`, or to `today` while still on rent.
    - The pickup day is not billed. The minimum is 1.
    - Returns 0 when `onRent` is after `today` (not yet on rent).
  - `rentalCharge(days: number, r: Rates): number | null`
    - Returns `null` when all three rates are null, or 0 when `days` is 0.
    - Algorithm (rental-house cheapest billing):

    ```
    day   = r.dayRate  ?? (r.weekRate != null ? r.weekRate / 7 : r.monthRate! / 28)
    week  = r.weekRate ?? day * 7
    month = r.monthRate ?? week * 4
    months = floor(days / 28); rem = days % 28
    weeks  = floor(rem / 7);   odd = rem % 7
    oddCost  = min(odd * day, week)
    remCost  = min(weeks * week + oddCost, month)
    return round2(months * month + remCost)
    ```

  - `type RentalIn = Rates & { id: number; equipmentId: number | null; onRentDate: string; offRentDate: string | null; plannedOffRentDate: string | null; callOffNoticeDays: number; calledOffOn: string | null; deliveryCharge: number | null; pickupCharge: number | null }`
  - `rentalCost(r: RentalIn, today: string): { days: number; charge: number | null; total: number | null }`
    - `total` = charge + delivery + pickup, treating a null charge as 0.
    - If `charge` is null, `total` is null.
  - `type CallOff = "off_rent" | "called_off" | "overdue" | "call_off_now" | "call_off_soon" | "on_rent" | "no_planned_date" | "not_yet_on_rent"`
  - `callOffStatus(r: RentalIn, today: string): { status: CallOff; callBy: string | null }`
    - `callBy` = `plannedOffRentDate − callOffNoticeDays` calendar days.
    - Checks run in this order:
      1. `offRentDate` set → `off_rent`.
      2. `onRentDate > today` → `not_yet_on_rent`.
      3. `calledOffOn` set → `called_off`.
      4. No planned date → `no_planned_date`.
      5. `today > plannedOffRentDate` → `overdue`.
      6. `today >= callBy` → `call_off_now`.
      7. `today >= callBy − 3` → `call_off_soon`.
      8. Otherwise → `on_rent`.
  - `CALL_OFF_LABEL`:

    | Status | Label |
    |---|---|
    | `overdue` | Overdue — still on rent |
    | `call_off_now` | Call off today |
    | `call_off_soon` | Call off by {date} |
    | `no_planned_date` | No planned off-rent date |
    | `not_yet_on_rent` | Not yet on rent |
    | `called_off` | Called off {date} |
    | `off_rent` | Off rent {date} |
    | `on_rent` | On rent |

  - `coveredByRental(rentals: Pick<RentalIn,"equipmentId"|"onRentDate"|"offRentDate">[], equipmentId: number, date: string): boolean`
    - The window runs from `onRentDate` to `offRentDate`, inclusive. An open rental covers every date from `onRentDate` on.
  - `standbyDays(rows: { reportDate: string; standbyHours: number; operatingHours: number }[], r: Pick<RentalIn,"onRentDate"|"offRentDate">): number`
    - Counts distinct report dates inside the window that have `standbyHours > 0` and `operatingHours == 0`.
    - The figure is informational (delay-claim backup). It is not added to cost.
- **Schema:** `equipment_rentals`:
  - id, projectId, equipmentId nullable, description varchar(200), vendorCompanyId nullable, vendorName varchar(120) nullable, poNumber varchar(64) nullable
  - onRentDate day, offRentDate day nullable, plannedOffRentDate day nullable, callOffNoticeDays int default 1, calledOffOn day nullable, callOffConfirmation varchar(64) nullable
  - dayRate / weekRate / monthRate / deliveryCharge / pickupCharge double nullable
  - notes text, createdAt, updatedAt
  - Index `(projectId)`.
- **tRPC `rentals`:**
  - `list({ projectId })` returns rows plus `cost`, `callOff` and `standbyDays`. Standby comes from final daily reports' equipment rows for `equipmentId`.
  - `create`, `update` and `remove`.
  - `callOff({ id, calledOffOn, confirmation? })`.
  - `offRent({ id, offRentDate })`. It refuses a date before `onRentDate`.
- **`projectCosts` changes:**
  - Adds `rentalCost` (the sum of known totals through `offRentDate` or today) and `rentalsUnpriced` (a count).
  - `equipmentCost` now excludes final-report equipment rows where `coveredByRental(jobRentals, row.equipmentId, report.reportDate)`.
  - `total` includes `rentalCost`.
- **`todaySummary`** gains input `rentals?: (RentalIn & { projectId; description })[]` and output `rentalsToCallOff: { id, projectId, label, date, status }[]`.
  - It lists `overdue`, `call_off_now` and `call_off_soon`, overdue first.
  - `date` = `callBy`.

- [ ] **Step 1: Write the failing tests** in `server/rentals.test.ts` (today = `2026-11-20`):
  - `billed days exclude the pickup day, minimum one`:
    - on `11-01`, off `11-08` → 7.
    - on and off `11-01` → 1.
    - on `11-01`, still on rent → 19.
    - on `11-25` → 0.
  - `cheapest rental billing`:
    - Rates day 500, week 1500, month 4000.
    - 3 days → 1500 (capped at the week).
    - 2 days → 1000.
    - 10 days → 1500 + min(1500, 1500) = 3000.
    - 27 days → min(3·1500 + min(3000,1500), 4000) = 4000.
    - 30 days → 4000 + 1000 = 5000.
  - `missing lower rates prorate from the next rate up`: month 2800 only, 7 days → 700.
  - `no rates is unknown cost` → `rentalCharge(5, {all null})` = null; `rentalCost(...).total` = null.
  - `past planned off-rent is overdue` → planned `11-18`, not called off → `overdue`.
  - Call-off windows, with planned `11-25` and notice 2 (callBy `11-23`):
    - today `11-20` → `call_off_soon`.
    - today `11-23` → `call_off_now`.
    - `calledOffOn` set → `called_off`.
    - planned null → `no_planned_date`.
  - `daily equipment covered by a rental is not double counted`:
    - Rental of equipment 4 from `11-01`, off `11-10`.
    - `coveredByRental` is true for `11-10` and false for `11-11` and for equipment 5.
  - `standby days count idle days in the window only`:
    - Rows on `11-02` (standby 8, op 0), `11-02` again (duplicate date), `11-03` (standby 4, op 4), `11-12` (standby 8, op 0, after off-rent `11-10`) → 1.
  - `Today lists rentals to call off, overdue first`.
- [ ] **Step 2: Run** `pnpm vitest run server/rentals.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/rentals.ts` and the `todaySummary` extension.
- [ ] **Step 4: Run** the same test plus `server/today.test.ts` and `server/services/recompute.test.ts`. Expected: PASS.
- [ ] **Step 5: Schema, migration `0008_equipment_rentals`, router, `projectCosts` change.**
  - Add a `recompute.test.ts` case if that file tests `projectCosts` pieces purely. Otherwise the e2e covers it in Task 6.
- [ ] **Step 6: Client.**
  - The **Rentals tab**:
    - Table columns: equipment/description, vendor, on-rent, planned off, status chip (`CALL_OFF_LABEL`), days, cost so far ("Rate not entered" when null), standby days.
    - Row actions: "Called off…" (date + confirmation #) and "Off rent…".
  - Financials shows a "Rentals" cost line, plus "{n} rental(s) unpriced" when n > 0.
  - Today panel "Rentals to call off".
- [ ] **Step 7: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 8: Commit** `feat: equipment rentals with call-off reminders and rental cost in financials`.

### Task 5: Photo log

**Files:**
- Create: `shared/photos.ts`, `server/photos.test.ts`, `server/routers/photos.ts`, `client/src/pages/job/Photos.tsx`, `client/src/features/photos/{PhotoGrid,PhotoUpload,AttachPhotos}.tsx`, migration `0009_photo_log`
- Modify: `drizzle/schema.ts` (`documents.caption varchar(500)`, `documents.takenOn day`, `documents.sequenceTaskId int`; new `photo_links`), `server/routers/collab.ts` (upload accepts `caption`, `takenOn`, `sequenceTaskId`, entityType `tmTicket`), `server/routers/gcReport.ts` (photos from the photo log), `client/src/features/daily/ReportEditor.tsx`, `client/src/features/tm/TicketEditor.tsx`, the log item drawer (`client/src/features/logs/*`), `client/src/pages/print/{TmTicket,GcWeekly}.tsx`, `JobLayout.tsx` (tab `photos`, "Photos")

**Interfaces:**
- **Produces, in `shared/photos.ts`:**
  - `isPhoto(mimeType: string | null, fileName: string): boolean` (image/* or `.jpg/.jpeg/.png/.heic/.webp`). This replaces the `PHOTO` regex in `gcReport.ts`.
  - `PHOTO_ENTITY_TYPES = ["dailyReport", "logItem", "tmTicket"] as const`
  - `type PhotoEntity = (typeof PHOTO_ENTITY_TYPES)[number]`
  - `photoDay(p: { takenOn: string | null; uploadedDay: string }): { day: string; estimated: boolean }`
    - Returns `takenOn` if set, else the upload day with `estimated: true`. The UI marks those "uploaded {date}" and never claims a taken date.
  - `groupByDay<T extends { takenOn: string | null; uploadedDay: string }>(photos: T[]): { day: string; photos: (T & { estimated: boolean })[] }[]`
    - Days are sorted descending.
  - `photosForRecord(owned: number[], linked: number[]): number[]`
    - Returns the de-duplicated union, owned first.
- **Schema:** `photo_links`: id, documentId, entityType varchar(32), entityId int, createdAt. Unique `(documentId, entityType, entityId)`.
- **tRPC `photos`:**
  - `list({ projectId, sequenceTaskId?, from?, to?, entityType?, entityId? })` returns image documents on the job (any owner) with the latest version URL, `caption`, `takenOn`, `sequenceTaskId` and `links`. With an entity filter, it returns that record's owned and linked photos via `photosForRecord`.
  - `update({ id, caption?, takenOn?, sequenceTaskId? })`.
  - `attach({ documentIds, entityType, entityId })`. Repeat links are ignored, and the call validates that the entity is on the same job.
  - `detach({ documentId, entityType, entityId })`.
- **GC weekly report:** photos are those with `photoDay(...).day` inside the week, plus any owned by or linked to that week's final reports. Still capped at 12.

- [ ] **Step 1: Write the failing tests** in `server/photos.test.ts`:
  - `isPhoto` → true for `("image/jpeg","x")` and `(null,"IMG_1.HEIC")`; false for `("application/pdf","a.pdf")`.
  - `a photo with no taken date uses the upload day, marked estimated` → `photoDay({takenOn:null,uploadedDay:"2026-11-19"})` = `{day:"2026-11-19",estimated:true}`.
  - `groups photos by day, newest first`.
  - `record photos are owned plus linked, no duplicates` → `photosForRecord([1,2],[2,3])` = `[1,2,3]`.
  - Update the gcReport photo test (if present) to use `isPhoto`.
- [ ] **Step 2: Run** `pnpm vitest run server/photos.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/photos.ts`.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Schema, migration `0009_photo_log`, `photos` router, upload changes, gcReport change.**
- [ ] **Step 6: Client.**
  - The **Photos tab** shows a grid grouped by day, with filters for sequence and date range.
  - Multi-file upload takes a shared caption, taken date (default today) and sequence. Each photo's caption, date and sequence can be edited afterward.
  - "Attach to…" picks a daily report, log item or T&M ticket.
  - Daily report, log item and T&M ticket screens get a Photos strip: owned plus linked, "Add from photo log" and "Upload".
  - The T&M print shows attached photos, up to 6.
- [ ] **Step 7: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 8: Commit** `feat: photo log with captions, dates, sequences and attachments`.

### Task 6: End-to-end verification and PR

**Files:**
- Create: `scripts/e2e-phase3.cjs`
- Modify: `README.md` (Phase 3 section), `scripts/e2e-phase1.cjs` (Today panel count), `DEPLOY.md` (migrations 0005–0009 apply automatically)

- [ ] **Step 1: Write `scripts/e2e-phase3.cjs`**, which runs against `pnpm start:railway` on a fresh MySQL 8 with `scripts/fake-r2.cjs`, as Phase 2 does. It checks:
  - **QC:** a failed bolt entry → punch PL-001 is created with the sequence linked, and a second create is refused. The QC print renders.
  - **Safety:** activating an incomplete JHA is refused with its problems, then succeeds when completed. A PTP from the JHA copies its steps. A toolbox talk de-duplicates attendees. The incident fields exist on the Safety log.
  - **Certs:** a cert with no expiry is on Today as "Expiry unknown". A daily-report crew line for a classification requiring an NCCCO operator cert shows "Missing". The matrix print renders.
  - **Rentals:**
    - A crane rented `on 11-01`, planned off yesterday → Today shows "Overdue — still on rent".
    - That crane on a final daily report during the rental → Financials equipment cost excludes it, and the rental cost is included once.
    - A rental with no rates → "1 rental unpriced".
  - **Photos:**
    - Upload two photos with captions, one undated, and attach one to a T&M ticket.
    - The ticket print shows it, and the Photos tab groups by day with the undated photo marked "uploaded".
  - **Layout:** 1280 px and 820 px screenshots of QC, Safety, Rentals, Photos and Settings → Certifications show no horizontal overflow.
- [ ] **Step 2: Run** on a fresh database:
  - `pnpm check`, `pnpm test`, `pnpm build`
  - then e2e-phase1, e2e-posting, e2e-phase2 and e2e-phase3
  - Expected: all pass.
- [ ] **Step 3: Whole-branch review** (fresh reviewer, most capable model). Fix Critical and Important findings test-first, and defer minors to the PR body.
- [ ] **Step 4: Commit, push** `phase3`, and open a draft PR to `main`.
