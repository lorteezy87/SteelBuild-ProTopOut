# SteelBuild Pro TopOut — Phase 2 Implementation Plan ("Run the erection")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five Phase 2 erection features: erection stages and a production chart, the ready-to-erect gate, crane and lift planning, T&M tickets, and the 3-week look-ahead plus weekly GC report.

**Architecture:** Every rule lives in a pure module under `shared/`, and Vitest tests it directly. Server routers in `server/routers/` load rows, call the shared rule and write inside a transaction wherever a write claims state. Screens are job tabs (`client/src/pages/job/*`) and Settings sections. Each printable document (lift plan, T&M ticket, GC report, look-ahead) is a print-styled route that the browser saves as PDF. Each task adds its own Drizzle migration (`drizzle/0001_…` onward); `0000_baseline.sql` is never edited.

**Tech Stack:** Vite 7, React 19, TypeScript 5.9, Express 4 + tRPC 11, Drizzle ORM (MySQL 8), Tailwind 4, Vitest 2, pnpm 10, Playwright (verification only).

**Spec:** `docs/superpowers/specs/2026-11-20-topout-design.md` §7 Phase 2, plus §4 anti-goals and §12 builder's calls.

## Global Constraints

- Product name in user-visible strings: **SteelBuild Pro TopOut** (short **TopOut**). No legacy name anywhere (`server/brand.test.ts` enforces this).
- Erection only; fabrication is by others.
- One login, the owner. Every new procedure is a `protectedProcedure`.
- Unknown stays visibly unknown (§4). A NULL weight, radius, date or quantity is never shown as 0, "OK" or "on time".
- Never lose a saved entry. A refused write returns a TRPCError with a plain-English message, and the draft stays saved.
- Migrations: generate with `DATABASE_URL=mysql://x@localhost/x pnpm drizzle-kit generate --name <name>`. Keep the generated SQL and journal, and never hand-edit `0000_baseline.sql`.
- Crane radius (§12.3): the PM enters or confirms the radius on every pick. The app pre-fills it only when the piece and the crane setup are on the same sheet page and that read has a scale (`ppf > 0`).
- Thresholds: a pick at **≥ 75 %** of chart capacity is a **critical lift**; **> 100 %** is **blocked**.
- Every task ends green on `pnpm check` and `pnpm test`. Task 7 also runs `pnpm build` and the browser checks.
- Commit per task on branch `phase2`; open a PR to `main` at the end.

## Review Focus

1. **A pick with no known weight, or no radius:** status `unknown` ("Enter weight" / "Enter radius"). Never OK, never critical. Test: Task 3 `unknown weight or radius is unknown, not ok`.
2. **A radius beyond the chart's longest row, or inside its shortest:** `blocked`, reason "outside chart". Never extrapolate. Test: Task 3 `radius outside the chart is blocked`.
3. **Editing a signed T&M ticket:** refused ("Signed tickets can't be changed — void and reissue"). The signature, lines and totals stay exactly as signed. Test: Task 5 `signed ticket is locked`.
4. **Finalizing a daily report that starts a sequence with an open gate item:** refused until each such sequence has a reason. With reasons, it posts once and records each reason. Test: Task 2 `finalize needs a reason for each not-ready sequence`.
5. **A weekly GC report for a week with no final daily report:** "No final daily reports this week", not "0.00 t erected". Test: Task 6 `week without final reports is unknown, not zero`.

---

### Task 1: Erection stages and the production chart

**Files:**
- Create: `shared/stages.ts`, `shared/production.ts`, `server/stages.test.ts`, `client/src/features/daily/ProductionChart.tsx`, migration `drizzle/0001_erection_stages.sql`
- Modify: `drizzle/schema.ts` (tasks, dailyReportProgress, projects); `shared/dailyPosting.ts` (`progressByTask` keyed by task and stage); `server/routers/dailyReports.ts` (finalize/reopen post per stage; new `production` query); `server/services/recompute.ts:176-182`; `server/routers/projects.ts` (accept `progressStage`); `client/src/features/daily/ReportLines.tsx` (stage select on progress lines); `client/src/pages/job/Tasks.tsx` (four stage columns on sequence rows); `client/src/pages/job/Overview.tsx` (chart); the job settings form (Progress stage select)

**Interfaces:**
- Produces, in `shared/stages.ts`:
  - `STAGES = { set: "Set (hung)", plumbed: "Plumbed", bolted: "Bolted-up", final: "Detailed-out / Final" } as const`
  - `type Stage = keyof typeof STAGES`
  - `STAGE_KEYS: Stage[]` (in that order)
  - `isStage(x: unknown): x is Stage`
  - `stageColumns(s: Stage): { tons: "erectedTons"|"plumbedTons"|"boltedTons"|"finalTons"; pieces: "erectedPieces"|"plumbedPieces"|"boltedPieces"|"finalPieces" }`. `set` maps to the existing `erectedTons/erectedPieces`, so every Phase 1 reader keeps meaning "hung".
  - `stagePercent(t: StageQty & { plannedTons: number; plannedPieces: number }, stage: Stage, by: "tonnage"|"pieces"): number | null` (null when the planned quantity is 0)
  - `stageWarnings(t: StageQty): string[]`, e.g. `"Plumbed 12 t exceeds Set 10 t"`. A warning, not a block.
  - `type StageQty = Record<"erectedTons"|"plumbedTons"|"boltedTons"|"finalTons", number> & Record<"erectedPieces"|"plumbedPieces"|"boltedPieces"|"finalPieces", number>`
- Produces, in `shared/production.ts`: `productionSeries(rows: { reportDate: string; foremanId: number | null; tons: number; pieces: number }[], plan: { tonsPerDay: number | null; piecesPerDay: number | null }): { days: { date: string; byForeman: Record<string, { tons: number; pieces: number }>; tons: number; pieces: number }[]; plan: { tonsPerDay: number | null; piecesPerDay: number | null } }`. The foreman key is `String(foremanId ?? "none")`. Days are sorted ascending, and only days that have rows appear.
- Changes in `shared/dailyPosting.ts`: `progressByTask(lines: { taskId: number; stage?: string | null; tons: number; pieces: number }[]): Map<string, { taskId: number; stage: Stage; tons: number; pieces: number }>`, keyed `` `${taskId}:${stage}` ``. A missing stage is `set`.
- Produces a tRPC query `daily.production({ projectId, stage?: Stage })`, which returns `productionSeries` output. Rows come from posted progress lines of final reports for that stage (default `set`). The plan rate is the sum of `plannedTons / durationDays` over sequences that have dates, and `null` if there are none.

- [ ] **Step 1: Write the failing tests** in `server/stages.test.ts`:
  - `set maps to the existing erected columns`: `stageColumns("set")` → `{tons:"erectedTons",pieces:"erectedPieces"}`; `stageColumns("bolted").tons` → `"boltedTons"`.
  - `stage percent uses the chosen stage`: planned 100 t, bolted 40 t → `stagePercent(q,"bolted","tonnage")` = 40. Planned 0 t → `null`.
  - `later stage above earlier stage warns`: set 10, plumbed 12 → `["Plumbed 12 t exceeds Set 10 t"]`. Equal quantities → `[]`.
  - `progress groups by task and stage`: lines `{taskId:5,stage:"set",tons:3,pieces:4}`, `{taskId:5,tons:1,pieces:1}`, `{taskId:5,stage:"bolted",tons:2,pieces:2}` → keys `5:set` (4 t, 5 pcs) and `5:bolted` (2 t, 2 pcs).
  - `production by foreman per day`: two rows on `2026-11-02` (foreman 7: 5 t; foreman null: 2 t) → one day, `tons:7`, `byForeman["7"].tons=5`, `byForeman["none"].tons=2`.
  - Update the existing `sums erected tons and pieces per sequence` test in `server/dailyFinalize.test.ts` to the new key shape.
- [ ] **Step 2: Run** `pnpm vitest run server/stages.test.ts server/dailyFinalize.test.ts`. Expected: FAIL (modules or exports missing).
- [ ] **Step 3: Implement** `shared/stages.ts`, `shared/production.ts` and the `progressByTask` change.
- [ ] **Step 4: Schema.** Add `plumbedTons/boltedTons/finalTons` (double, default 0) and `plumbedPieces/boltedPieces/finalPieces` (int, default 0) to `tasks`; `stage varchar(16) default 'set' not null` to `daily_report_progress`; and `progressStage varchar(16) default 'set' not null` to `projects`. Generate `0001_erection_stages`.
- [ ] **Step 5: Server.**
  - Finalize adds each `(task, stage)` total to that stage's columns, using `stageColumns`. Only the `set` stage drives `actualStart`, status and completion, exactly as today.
  - Reopen subtracts per stage, clamping at 0.
  - `recomputeProject` takes tonnage/pieces percent from `project.progressStage`'s columns through `stagePercent`. A null result leaves the stored percent unchanged.
  - The daily save input accepts `stage` on each progress line, as `z.enum(STAGE_KEYS)` with default `set`.
  - `tasks.list` returns the new columns.
- [ ] **Step 6: Client.**
  - The progress line gets a Stage select.
  - Sequence rows show Set / Plumbed / Bolted / Final tons, with `stageWarnings` as an amber note.
  - Overview gets `ProductionChart`: bars for tons per day stacked by foreman, a dashed plan line when the plan rate isn't null, and a stage selector. With no posted rows it shows the empty state "Finalize daily reports to build the production chart."
- [ ] **Step 7: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 8: Commit** `feat: erection stages per sequence and production chart`.

### Task 2: Ready-to-erect gate

**Files:**
- Create: `shared/gate.ts`, `server/gate.test.ts`, `server/routers/gates.ts`, `client/src/features/tasks/GatePanel.tsx`, migration `0002_ready_to_erect`
- Modify: `drizzle/schema.ts`; `server/routers/index` (the app router file: register `gates`); `server/routers/tasks.ts` (status change); `server/routers/dailyReports.ts` (finalize); `shared/today.ts` and `server/routers/today.ts` (new panel); `client/src/pages/Today.tsx`; `client/src/features/gantt/WbsGrid.tsx` (gate badge); `client/src/features/daily/ReportEditor.tsx` (reason prompt)

**Interfaces:**
- Produces, in `shared/gate.ts`:
  - `GATE_ITEMS = { anchor_bolts: "Anchor bolt survey accepted", concrete: "Concrete strength / cure", site_access: "Site access & laydown", crane_pad: "Crane pad / ground bearing", steel_on_site: "Steel on site", drawings_released: "Drawings released", open_rfis: "No open RFIs on sequence" } as const`
  - `type GateKey = keyof typeof GATE_ITEMS`
  - `MANUAL_GATE_KEYS: GateKey[] = ["anchor_bolts","concrete","site_access","crane_pad"]`
  - `type GateItemState = "met" | "open" | "na" | "unknown"`
  - `derivedGate(input: { plannedTons: number; receivedTons: number | null; sheets: { status: string }[]; openRfiCount: number }): Record<"steel_on_site"|"drawings_released"|"open_rfis", GateItemState>`:
    - `steel_on_site`: `met` when `receivedTons >= plannedTons > 0`; `unknown` when `plannedTons` is 0 or `receivedTons` is null; otherwise `open`.
    - `drawings_released`: `met` when there is at least one sheet and every sheet is `REL`; `unknown` when there are no sheets; otherwise `open`.
    - `open_rfis`: `met` when the count is 0; otherwise `open`.
  - `gateStatus(items: Record<GateKey, GateItemState>): "ready" | "not_ready" | "unknown"`: `not_ready` if any item is `open`; else `unknown` if any is `unknown`; else `ready`. (`na` counts as met.)
  - `startsSequence(before: { status: string }, after: { status?: string }): boolean`: true when the status goes from `not_started` to `in_progress` or `done`.
- Schema, table `sequence_gate_items`: `id, taskId, itemKey varchar(32), state varchar(8) default 'open', note varchar(500), updatedAt`, with `uniqueIndex(taskId,itemKey)`. Table `sequence_gate_overrides`: `id, taskId, reason varchar(500) not null, source varchar(16)` (`task` | `daily`), `sourceId int null, createdAt`.
- Produces these tRPC procedures:
  - `gates.get({ taskId })` → `{ items: { key: GateKey; label: string; state: GateItemState; note: string | null; derived: boolean }[]; status }`
  - `gates.set({ taskId, key: MANUAL_GATE_KEYS[number], state: "met"|"open"|"na", note? })`
  - `gates.forProject({ projectId })` → `Record<taskId, status>`
  - The shared server helper `gateStatusFor(taskIds: number[]): Promise<Map<number, ReturnType<typeof gateStatus>>>` lives in `server/services/gates.ts`.
- Consumes from Task 1: finalize starts a sequence only through `set` stage tons.
- Enforcement:
  - `tasks.update` takes an optional `gateReason: zText(500).min(3)`. When `startsSequence` is true and the gate is not `ready`, the update is refused without a reason ("Ready-to-erect gate is open for <name>: <open items>. Give a reason to start anyway."). With a reason it writes an override row.
  - `daily.finalize` takes an optional `gateReasons: Record<string, string>` (keyed by taskId). Before the claim, it collects every sequence that this finalize would move out of `not_started` and whose gate is not `ready`. If any lacks a reason, it refuses and names them. Inside the transaction it writes one override per reason, with `source:"daily"` and `sourceId:reportId`.
- Today gets a fifth panel, `sequencesNotReady`: sequences on active jobs with `status === "not_started"`, a `startDate` within 14 calendar days of today, and a gate that is not `ready`. A sequence with no start date is excluded.

- [ ] **Step 1: Write the failing tests** in `server/gate.test.ts`:
  - `steel on site needs received tons at least planned`: (100, 100) → met; (100, 60) → open; (0, 50) → unknown; (100, null) → unknown.
  - `drawings released needs every sheet REL`: `[]` → unknown; `[REL, REL]` → met; `[REL, HOLD]` → open.
  - `any open item makes the gate not ready`, `unknown without open is unknown`, `na counts as met`.
  - `starting means leaving not_started`: not_started→in_progress true; in_progress→done false; not_started→not_started false.
  - `finalize needs a reason for each not-ready sequence`: test the pure helper `missingGateReasons(starting: {taskId:number;name:string;status:"ready"|"not_ready"|"unknown"}[], reasons: Record<string,string>): {taskId:number;name:string}[]` (exported from `shared/gate.ts`). Two not-ready sequences and one reason → returns the other one. A blank reason counts as missing. A `ready` sequence is never returned.
  - In `server/today.test.ts`: `not-ready sequences starting within 14 days show on Today; no start date is excluded`.
- [ ] **Step 2: Run** `pnpm vitest run server/gate.test.ts server/today.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/gate.ts` and `todaySummary`'s new input `gates: { id; projectId; name; status: string; startDate: string | null; gate: "ready"|"not_ready"|"unknown" }[]` and output `sequencesNotReady: TodayRow[]`.
- [ ] **Step 4: Schema + migration** `0002_ready_to_erect`.
- [ ] **Step 5: Server.**
  - `server/services/gates.ts` computes derived items:
    - `receivedTons` is the sum of `deliveries.tons` with `receivedDate` not null for `sequenceTaskId`, or null when the sequence has no loads at all.
    - `sheets` are the `drawing_sheets` rows with that `sequenceTaskId`.
    - `openRfiCount` counts `wf_items` of app `rfi` with `linkedTaskId = taskId` and a state category other than `end`.
  - Add the `gates` router and the enforcement in `tasks.update` and `daily.finalize`.
  - Today queries the gates for candidate sequences only.
- [ ] **Step 6: Client.**
  - `GatePanel` sits in the sequence detail. Each of the seven rows shows a state chip. Derived rows are read-only and say why ("Steel on site: 60 of 100 t received"). Manual rows get Met / Open / N/A and a note.
  - The WBS grid shows a gate dot: green ready, amber not ready, grey unknown.
  - When a status change or finalize is refused for a gate, a dialog asks for a reason per sequence and retries.
  - Today shows "Not ready to erect".
- [ ] **Step 7: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 8: Commit** `feat: ready-to-erect gate per sequence`.

### Task 3: Crane library, setups and lift checks

**Files:**
- Create: `shared/lift.ts`, `server/lift.test.ts`, `server/routers/cranes.ts`, `client/src/features/settings/Cranes.tsx`, `client/src/pages/job/Lifts.tsx`, `client/src/features/lifts/SetupForm.tsx`, `client/src/features/lifts/PickTable.tsx`, migration `0003_cranes_lifts`
- Modify: `drizzle/schema.ts`; app router (register `cranes`); `client/src/pages/admin/*` (Settings → Cranes section); `client/src/pages/job/JobLayout.tsx` (tab `lifts`, "Cranes & Lifts", after Model)

**Interfaces:**
- Produces, in `shared/lift.ts`:
  - `type ChartRow = { radiusFt: number; capacityLb: number }`
  - `parseChart(text: string): { rows: ChartRow[]; errors: string[] }`. Each line holds two numbers (radius ft, capacity lb) separated by whitespace, a comma or a tab; a `k` suffix on the capacity means ×1000; blank lines and `#` comments are skipped. Rows are sorted by radius. A duplicate radius or a non-positive value adds an error naming the line number.
  - `capacityAt(rows: ChartRow[], radiusFt: number): number | null`. Returns the capacity of the **first row whose radius ≥ radiusFt** (the conservative "next longer radius" rule, with no interpolation). Returns null when the radius is below the first row or above the last.
  - `LIFT_CRITICAL_PCT = 75`, `LIFT_BLOCKED_PCT = 100`
  - `liftCheck(p: { pieceLb: number | null; riggingLb: number | null; radiusFt: number | null }, rows: ChartRow[]): { status: "ok"|"critical"|"blocked"|"unknown"; totalLb: number | null; capacityLb: number | null; pct: number | null; reason: string }`:
    - Null piece weight → `unknown`, reason "Enter weight". Null radius → `unknown`, "Enter radius". Null rigging is treated as 0 and the reason says "rigging not entered".
    - Capacity null → `blocked`, "Radius outside chart".
    - Otherwise compute `pct = round1(total / capacity × 100)`. `> 100` → blocked; `≥ 75` → critical; else ok.
  - `gridPoint(grids: { n: string; a: [number,number,number,number] }[], g1: string, g2: string): { x: number; y: number } | null`. Returns the intersection of the two named grid lines (infinite-line intersection), or null when a name is missing or the lines are parallel.
  - `pieceRadiusFt(setupPt: { x: number; y: number }, offsetFt: { x: number; y: number }, piece: { a: [number,number,number,number] }, ppf: number): number | null`. Takes the distance from (setup point + offset × ppf) to the piece midpoint and divides by ppf, rounded to 0.1. Returns null when `ppf <= 0`.
- Schema:
  - `crane_models`: `id, name varchar(120), maxCapacityLb double, chart json ChartRow[], chartNote varchar(500), isActive bool`
  - `crane_setups`: `id, projectId, craneModelId, equipmentId int null, name varchar(120), sheetId int null, page int default 1, grid1 varchar(16) null, grid2 varchar(16) null, offsetXFt double default 0, offsetYFt double default 0, boomFt double null, counterweight varchar(120) null, notes text null`
  - `lift_picks`: `id, projectId, setupId, sequenceTaskId int null, mark varchar(32), description varchar(200) null, pieceLb double null, riggingLb double null, radiusFt double null, radiusSource varchar(8) default 'entered'` (`entered`|`model`), `sheetId int null, page int null, pieceKey varchar(64) null, signoffs json null`, `createdAt, updatedAt`
- Produces these tRPC procedures:
  - `cranes.models.list/create/update` (input `chartText` is parsed server-side with `parseChart`; any error is refused with the line errors)
  - `cranes.setups.list({projectId})/create/update/remove`
  - `cranes.picks.list({projectId})` → rows plus `check: ReturnType<typeof liftCheck>`, computed server-side from the setup's model chart
  - `cranes.picks.create/update/remove`
  - `cranes.picks.bulkFromModel({ projectId, setupId, picks: { mark; pieceLb: number|null; sequenceTaskId: number|null; sheetId; page; pieceKey; radiusFt: number|null }[] })`. The client computes the prefilled radius with `pieceRadiusFt` from the model read, and the server stores `radiusSource:"model"` only when `radiusFt` is non-null.
- Consumes: the model lift list rows (`client/src/features/model/domain.ts` `Row`: `sid, pg, a, mark, lb, seq`) and the read's `ppf` and `grids` via `useModel`.

- [ ] **Step 1: Write the failing tests** in `server/lift.test.ts`:
  - `parses a pasted chart`: `"# 100t\n20 100000\n30, 72k\n\n40\t51000"` → three rows, capacity 72000 at 30 ft, no errors. `"30 0\n30 5000"` → errors naming lines 1 and 2.
  - `capacity uses the next longer radius`: rows 20/100000, 30/72000, 40/51000 → `capacityAt(25)` = 72000; `capacityAt(30)` = 72000; `capacityAt(40)` = 51000.
  - `radius outside the chart is blocked`: `liftCheck({pieceLb:1000,riggingLb:0,radiusFt:45}, rows)` → blocked, "Radius outside chart". `radiusFt:15` → blocked.
  - `75 percent is critical, over 100 is blocked`: total 54000 at 30 ft → 75 %, critical. 72000 → 100 %, critical (not blocked). 72001 → blocked.
  - `unknown weight or radius is unknown, not ok`: pieceLb null → unknown "Enter weight". radius null → unknown "Enter radius".
  - `grid intersection and radius from the model`: vertical grid `A` at x=100 and horizontal grid `1` at y=200 → `gridPoint` = {100,200}. A piece from (100,500) to (500,500) with ppf 10 → `pieceRadiusFt` = hypot(200,300)/10 = 36.1. ppf 0 → null. A missing grid name → null.
- [ ] **Step 2: Run** `pnpm vitest run server/lift.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/lift.ts`.
- [ ] **Step 4: Schema + migration** `0003_cranes_lifts`, plus the `cranes` router.
- [ ] **Step 5: Client.**
  - Settings → Cranes: list crane models; a form with a chart textarea (paste from the manufacturer's load chart) and a live parsed preview table with errors.
  - The job tab Cranes & Lifts has:
    - a setups list with a form (model, linked equipment, sheet page, grid 1 × grid 2, offsets, boom, counterweight)
    - a picks table: mark, sequence, weight, rigging, radius (with a "from model" tag), capacity, % and a status chip (Critical in amber, Blocked in red, Unknown in grey with the reason)
    - "Add picks from lift list", which lists the model's heaviest pieces for the chosen setup with a prefilled radius when the sheet page matches and the scale is set, and leaves it blank otherwise
  - Radius is editable on every row. Editing a model-sourced radius sets `radiusSource` to `entered`.
- [ ] **Step 6: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 7: Commit** `feat: crane library, setups and lift capacity checks`.

### Task 4: Lift plan print page

**Files:**
- Create: `client/src/pages/print/LiftPlan.tsx`, `client/src/pages/print/PrintShell.tsx`, `client/src/styles/print.css`, `server/printShell.test.ts`
- Modify: `client/src/App.tsx` (routes outside AppShell: `/print/lift/:pickId`, plus `/print/tm/:ticketId`, `/print/gc/:projectId/:weekStart` and `/print/lookahead/:projectId/:from` for Tasks 5–6); `client/src/features/lifts/PickTable.tsx` ("Lift plan" action on critical rows)

**Interfaces:**
- Produces:
  - `PrintShell({ title, subtitle, children })`: TopOut wordmark, the org name from settings, the job code and name, a "Print / Save PDF" button (`window.print()`, hidden in print) and an `@page { size: letter; margin: 0.5in }` layout.
  - `liftPlanFields(pick, setup, model, check) → { label: string; value: string }[]` in `shared/lift.ts`. The rows are: Crane, Setup location (`grid1/grid2 + offsets`), Boom, Counterweight, Piece mark, Piece weight, Rigging weight, Total load, Radius (with "from model, confirmed by PM" or "entered"), Chart capacity at radius, % of chart, Status. Null values render as `"Not entered"`.
  - A `signoffs` block with Lift supervisor, Crane operator, Rigger and Signal person, each with name, signature and date lines.
- Consumes: `cranes.picks.list` (Task 3).

- [ ] **Step 1: Write the failing test** `server/printShell.test.ts`, case `lift plan shows not entered for unknowns`: `liftPlanFields` with a null rigging weight and a null boom → those rows read `"Not entered"`, and the Status row reads `"Critical lift — 82.0 % of chart"` for an 82 % pick.
- [ ] **Step 2: Run** `pnpm vitest run server/printShell.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `liftPlanFields`, `PrintShell` and `LiftPlan`, plus the route. A non-critical pick still prints, with the heading "Lift plan" instead of "Critical lift plan".
- [ ] **Step 4: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: printable lift plan`.

### Task 5: T&M / extra-work tickets

**Files:**
- Create: `shared/tm.ts`, `server/tm.test.ts`, `server/routers/tm.ts`, `client/src/pages/job/Tickets.tsx`, `client/src/features/tm/TicketEditor.tsx`, `client/src/features/tm/SignaturePad.tsx`, `client/src/pages/print/TmTicket.tsx`, migration `0004_tm_tickets`
- Modify: `drizzle/schema.ts`; app router (register `tm`); `JobLayout.tsx` (tab `tickets`, "T&M Tickets", after Daily Reports); `client/src/features/daily/ReportEditor.tsx` ("Create T&M ticket" action on a final report)

**Interfaces:**
- Produces, in `shared/tm.ts`:
  - `TM_LINE_KINDS = { labor: "Labor", equipment: "Equipment", material: "Material" } as const`
  - `TM_STATUSES = { draft: "Draft", signed: "Signed", void: "Void" } as const`
  - `type TmLine = { kind: keyof typeof TM_LINE_KINDS; description: string; qty: number; unit: string; rate: number; otQty?: number; otRate?: number }`
  - `lineAmount(l: TmLine): number`, which is `round2(qty × rate + (otQty ?? 0) × (otRate ?? 0))`
  - `ticketTotals(lines: TmLine[], markupPct: { labor: number; equipment: number; material: number }): { byKind: Record<kind, { subtotal: number; markup: number; total: number }>; grandTotal: number }`
  - `linesFromDailyReport(r: { crew: { name: string; classification: string | null; stHours: number; otHours: number; billRate: number; otMultiplier: number }[]; equipment: { name: string; operatingHours: number; standbyHours: number; hourlyRate: number; standbyRate: number }[] }): TmLine[]`
    - Labor gets one line per worker: `qty = st`, `otQty = ot`, `otRate = billRate × otMultiplier`, description `"<name> — <classification>"`.
    - Equipment gets an operating line, plus a separate `"<name> — standby"` line when there are standby hours.
    - Zero-hour lines are skipped.
  - `assertTicketEditable(status: string): void`, which throws "Signed tickets can't be changed — void and reissue" on `signed` and "Void tickets can't be changed" on `void`.
- Schema:
  - `tm_tickets`: `id, projectId, number int, ticketDate date, description text, coItemId int null, dailyReportId int null, status varchar(8) default 'draft', markup json {labor,equipment,material}, signedName varchar(120) null, signedTitle varchar(120) null, signedAt timestamp null, signatureKey varchar(255) null, voidReason varchar(500) null, createdAt, updatedAt`, with `uniqueIndex(projectId, number)`
  - `tm_ticket_lines`: `id, ticketId, sortOrder, kind, description varchar(300), qty double, unit varchar(16), rate double, otQty double null, otRate double null`
- Produces these tRPC procedures:
  - `tm.list({projectId})`, `tm.get({id})` (ticket + lines + totals)
  - `tm.create({projectId, ticketDate, description, coItemId?, fromDailyReportId?})`. It numbers the ticket inside a transaction with `max(number)+1` and retries once on a unique-key collision. With `fromDailyReportId` it pre-fills lines through `linesFromDailyReport`, which needs the report to be final ("Finalize the daily report first").
  - `tm.update({id, ...fields, lines})`, guarded by `assertTicketEditable`
  - `tm.sign({id, signedName, signedTitle, signaturePng: base64 string ≤ 300 kB})`. It uploads to R2 at `tm/<projectId>/<id>-signature.png` and claims draft→signed with a conditional UPDATE (affectedRows must be 1).
  - `tm.void({id, reason})`
- Consumes: the R2 `storagePut` from `server/storage.ts`, `rateFor` (export it from `dailyReports.ts` into `server/services/rates.ts`), and the CO log items (`wf_items` of app `co`) for the link picker.

- [ ] **Step 1: Write the failing tests** in `server/tm.test.ts`:
  - `line amount includes overtime`: qty 8 @ 95, otQty 2 @ 142.5 → 1045.
  - `totals apply markup per kind`: labor 1000 at 15 %, equipment 500 at 10 %, material 200 at 0 → grand total 1900.
  - `daily report prefill`:
    - one worker with 8 ST and 2 OT at bill 95 ×1.5 → one labor line, `otRate` 142.5
    - a crane with 6 operating and 2 standby → two equipment lines
    - a worker with 0 and 0 → skipped
  - `signed ticket is locked`: `assertTicketEditable("signed")` throws the exact message; `"draft"` does not throw.
- [ ] **Step 2: Run** `pnpm vitest run server/tm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/tm.ts`, move `rateFor` into `server/services/rates.ts` (re-imported by `dailyReports.ts`), then the schema, migration `0004_tm_tickets` and the router.
- [ ] **Step 4: Client.**
  - The Tickets tab: list (number `T&M-###`, date, CO, status, total) → editor (lines grid with add/remove and kind, totals with markup).
  - `SignaturePad`: a pointer-events canvas with Clear and Accept, exporting a PNG data URL. It sits behind a "Sign on screen" button that shows the ticket total and asks for the GC super's name and title.
  - After signing, the editor is read-only and shows the signature.
  - Print page `/print/tm/:ticketId`: ticket header, lines by kind, totals, signature image (through `/files/…`) and signed name/date.
- [ ] **Step 5: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: T&M tickets with on-screen signature`.

### Task 6: 3-week look-ahead and weekly GC report

**Files:**
- Create: `shared/lookahead.ts`, `server/lookahead.test.ts`, `server/routers/gcReport.ts`, `client/src/pages/print/Lookahead.tsx`, `client/src/pages/print/GcWeekly.tsx`
- Modify: app router (register `gcReport`); `client/src/pages/job/Overview.tsx` (buttons "3-week look-ahead" and "Weekly GC report", with a week picker defaulting to the current Monday)

**Interfaces:**
- Produces, in `shared/lookahead.ts`:
  - `weekStartOf(day: string): string` (the Monday on or before `day`, in UTC date arithmetic on `YYYY-MM-DD`)
  - `lookahead(tasks: { id; name; kind; isSummary: boolean; startDate: string|null; finishDate: string|null; status: string; percentComplete: number }[], from: string, weeks = 3): { weeks: { start: string; end: string }[]; rows: { id; name; kind; startDate: string; finishDate: string; status: string; days: boolean[] }[] }`. It keeps non-summary tasks whose date range overlaps `[from, from + 7·weeks − 1]`. `days` has `7·weeks` booleans, one per calendar day. Tasks without both dates are excluded and counted in a returned `undated: number`.
  - `weeklyTons(seqs: { id; name; plannedTons: number; erectedTons: number }[], posted: { taskId: number; stage: string; reportDate: string; tons: number }[], weekStart: string): { rows: { id; name; plannedTons: number; toDate: number; thisWeek: number | null; pct: number | null }[]; finalReportsThisWeek: number }`. `thisWeek` is null for every row when `finalReportsThisWeek` is 0. Only the `set` stage counts as erected.
- Produces these tRPC queries:
  - `gcReport.lookahead({ projectId, from })`
  - `gcReport.weekly({ projectId, weekStart })` → `{ job, weekStart, weekEnd, tons: weeklyTons(...), lookahead: lookahead(tasks, nextMonday, 3), openRfis, openCos, openDelays, deliveries: { thisWeek, nextWeek }, photos: { id; name; url; reportDate }[] }`
    - Open logs are `wf_items` of apps `rfi` / `co` / `delay` with a state category other than `end`, each with its number, title, ball-in-court and due date.
    - Photos are image documents (`documents.entityType = "dailyReport"`, name ending `.jpg/.jpeg/.png/.heic/.webp`) attached to final reports dated in the week, capped at 12.
- Consumes: Task 1's `stage` on progress rows; the delay app key `"delay"` and the RFI/CO keys `"rfi"`/`"co"`.

- [ ] **Step 1: Write the failing tests** in `server/lookahead.test.ts`:
  - `week starts on Monday`: `2026-11-20` (a Friday) → `2026-11-16`; `2026-11-16` → `2026-11-16`; `2026-11-22` (a Sunday) → `2026-11-16`.
  - `look-ahead keeps overlapping dated tasks`: from `2026-11-23` over 3 weeks:
    - a task from `2026-11-20` to `2026-11-24` is kept, with `days[0..1]` true
    - a task starting `2026-12-14` (day 22) is excluded
    - a summary task is excluded
    - a task without a finish date is excluded, and `undated` is 1
  - `week without final reports is unknown, not zero`: `posted` is empty → every `thisWeek` is null and `finalReportsThisWeek` is 0.
  - `this week counts only set-stage tons inside the week`: set rows of 5 t on Tuesday and 4 t on the previous Friday, plus a bolted row of 3 t on Tuesday → `thisWeek` = 5.
- [ ] **Step 2: Run** `pnpm vitest run server/lookahead.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/lookahead.ts` and the `gcReport` router. `finalReportsThisWeek` counts final daily reports for the job in the week, passed in alongside `posted`.
- [ ] **Step 4: Client print pages.**
  - Look-ahead: a grid with one column per day, Monday through Sunday and three weeks, bars shaded per `days`, and sequences in bold. The footer notes the number of undated tasks when it isn't zero.
  - GC weekly report:
    - a tons table (planned, to date, this week, %), with `"No final daily reports this week"` in place of the this-week column when it's null
    - the look-ahead
    - three open-log tables
    - deliveries this week and next
    - a photo grid
- [ ] **Step 5: Run** `pnpm check && pnpm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: 3-week look-ahead and weekly GC report`.

### Task 7: End-to-end verification and PR

**Files:**
- Create: `scripts/e2e-phase2.cjs`
- Modify: `README.md` (Phase 2 feature list), `DEPLOY.md` (note: migrations 0001–0004 apply automatically on start)

- [ ] **Step 1: Write** `scripts/e2e-phase2.cjs`. It is Playwright against a running server with an existing owner, in the same style as `scripts/e2e-posting.cjs`, and checks the following:
  1. Create a job and a sequence (100 t, starting today) → Today lists it under "Not ready to erect".
  2. Finalize a daily report with 10 t set on that sequence without a reason → refused naming the sequence. With a reason → posts. The sequence shows Set 10 t.
  3. Add 4 t `bolted` in a second report → the sequence shows Bolted 4 t, and `daily.production` has 2 days.
  4. Create a crane model by pasting a 3-row chart, then a setup and a pick at 82 % → status critical, and `/print/lift/:id` renders "Critical lift plan".
  5. Create a T&M ticket from the first report → it has labor lines. Sign it with a drawn signature → status signed. `tm.update` is refused, and `/print/tm/:id` shows the signature image.
  6. `/print/gc/:projectId/:weekStart` renders tons and look-ahead. For an empty past week it shows "No final daily reports this week".
  7. Each new screen at 1280 px and 820 px: no horizontal page scroll.
- [ ] **Step 2: Run** on a fresh MySQL 8: `pnpm build`, then `pnpm start:railway` (migrations 0000–0004 apply), then `node scripts/e2e-phase1.cjs`, then `node scripts/e2e-posting.cjs`, then `node scripts/e2e-phase2.cjs`. Expected: ALL PASSED for each.
- [ ] **Step 3: Run** `pnpm check && pnpm test && pnpm build`. Expected: clean and green.
- [ ] **Step 4: Commit** `test: phase 2 end-to-end checks; docs`, push `phase2`, and open a draft PR to `main` with a summary, verification and deferred minors.
