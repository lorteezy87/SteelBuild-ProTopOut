/* End-to-end check of a fresh TopOut install. Not part of `pnpm test`.
 * Usage: node scripts/e2e-phase1.cjs http://localhost:3460 ./e2e-shots
 * Needs: a running server on an EMPTY database (no owner yet) and Playwright. */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.argv[2] || "http://localhost:3460";
const OUT = process.argv[3] || "e2e-shots";
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures++;
};
const OWNER = { name: "Pat Morales", email: "pm@topout.test", password: "erect-the-steel-26" };
// The old product name is policed source-wide by server/brand.test.ts.
const BANNED = /Manus|Approvals|API tokens|Notifications|Security roles|Workspace/;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });

  /** tRPC call from the signed-in page (superjson envelope). */
  const call = (proc, input, method = "POST") =>
    page.evaluate(
      async ({ proc, input, method }) => {
        const url = method === "GET" ? `/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `/api/trpc/${proc}`;
        const res = await fetch(url, {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: method === "GET" ? undefined : JSON.stringify({ json: input }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(`${proc} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
        return body.result.data.json;
      },
      { proc, input, method }
    );
  const shot = async name => {
    await page.screenshot({ path: `${OUT}/${name}-1440.png` });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}-1024.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  const visit = async (path, name, expectText) => {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    if (expectText) await page.getByText(expectText).locator("visible=true").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const text = await page.innerText("body");
    ok(!BANNED.test(text), `${path}: no legacy or multi-user UI (${(text.match(BANNED) || ["none"])[0]})`);
    await shot(name);
    return text;
  };

  // 1. First run: setup creates the owner
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Set up SteelBuild Pro TopOut").waitFor({ timeout: 15000 });
  ok(true, "fresh install shows owner setup");
  await shot("01-setup");
  await page.fill("#si-name", OWNER.name);
  await page.fill("#si-email", OWNER.email);
  await page.fill("#si-password", OWNER.password);
  await page.click("button[type=submit]");
  await page.getByText("What needs you").waitFor({ timeout: 15000 });
  ok(true, "owner created and signed in to Today");
  const empty = await page.innerText("body");
  ok((empty.match(/Nothing needs you here\./g) || []).length === 5, "Today shows five empty panels (Phase 2 adds Not ready to erect)");
  await shot("02-today-empty");

  // 2. Job, sequence, crew, daily report through the app's own API
  const today = (await call("today.summary", undefined, "GET")).today;
  const job = await call("projects.create", { code: "26-001", name: "Test Erection", state: "active", template: "blank", startDate: today, totalTons: 40 });
  ok(job && job.id > 0, `job created (#${job.id})`);
  const seq = await call("tasks.create", { projectId: job.id, name: "Seq 1 — Grids 1–4", kind: "sequence", durationDays: 5, startDate: today, plannedTons: 40, plannedPieces: 120 });
  ok(seq && seq.id > 0, "sequence created (40 t planned)");
  const ref = await call("ref.all", undefined, "GET");
  const jm = ref.jobRoles.find(r => /journeyman/i.test(r.name));
  const crew = await call("admin.users.create", { name: "Ray Ortiz", jobRoleId: jm ? jm.id : null });
  ok(crew && crew.id > 0, "crew member added (Journeyman)");
  const report = await call("daily.save", {
    projectId: job.id,
    reportDate: today,
    foremanId: null,
    workPerformed: "Set columns and beams at grids 1–2.",
    crew: [{ userId: crew.id, taskId: seq.id, stHours: 8, otHours: 0 }],
    equipment: [],
    progress: [{ taskId: seq.id, tons: 5, pieces: 15, note: null }],
  });
  // Phase 2: starting a sequence with its ready-to-erect gate open needs a reason.
  const fin = await call("daily.finalize", { id: report.id, gateReasons: { [seq.id]: "e2e: gate reviewed in the field" } });
  ok(fin.posted.hours === 8 && fin.posted.tons === 5 && fin.posted.pieces === 15, `daily report finalized: ${JSON.stringify(fin.posted)}`);
  const seqAfter = (await call("tasks.list", { projectId: job.id }, "GET")).tasks.find(t => t.id === seq.id);
  ok(seqAfter && seqAfter.erectedTons === 5 && seqAfter.plannedTons === 40, `sequence shows ${seqAfter && seqAfter.erectedTons} t / ${seqAfter && seqAfter.plannedTons} t`);
  let again = null;
  try {
    await call("daily.finalize", { id: report.id, gateReasons: { [seq.id]: "e2e" } });
  } catch (e) {
    again = e.message;
  }
  ok(again && /already final/.test(again), "finalizing twice is refused");

  // 3. RFI with the ball in our court shows on Today
  const rfi = await call("wf.create", { appKey: "rfi", projectId: job.id, title: "Embed plate conflict at grid C/4", ballInCourt: "us" });
  ok(rfi && rfi.id > 0, "RFI created with ball in our court");
  const todayText = await visit("/", "03-today", "What needs you");
  ok(/Embed plate conflict at grid C\/4/.test(todayText), "RFI appears under Logs needing action");

  // 4. Main screens render without server errors or legacy UI
  await visit(`/jobs/${job.id}/schedule`, "04-schedule", "Seq 1");
  await visit(`/jobs/${job.id}/tasks`, "05-sequences", "Add sequence / task");
  await visit(`/jobs/${job.id}/daily`, "06-daily");
  await visit(`/jobs/${job.id}/logs`, "07-logs", "Embed plate conflict");
  await visit("/portfolio", "08-portfolio");
  await visit("/admin/users", "09-crew", "Ray Ortiz");
  await visit("/account", "10-account", "Change password");
  await visit("/timesheet", "11-hours");

  // 5. Sign out; setup is closed; sign back in
  await call("auth.logout", undefined);
  const setupAgain = await page.evaluate(async () => {
    const r = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X", email: "x@y.z", password: "another-password-1" }) });
    return r.status;
  });
  ok(setupAgain === 403, `second setup refused (${setupAgain})`);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Sign in to SteelBuild Pro TopOut").waitFor({ timeout: 15000 });
  await page.fill("#si-email", OWNER.email);
  await page.fill("#si-password", "wrong-password-123");
  await page.click("button[type=submit]");
  await page.getByRole("alert").waitFor({ timeout: 10000 });
  ok(/incorrect/.test(await page.getByRole("alert").innerText()), "wrong password refused");
  await page.fill("#si-password", OWNER.password);
  await page.click("button[type=submit]");
  await page.getByText("What needs you").waitFor({ timeout: 15000 });
  ok(true, "owner signs back in");

  ok(errors.length === 0, `no page errors or 5xx responses${errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.log(`FAIL exception: ${e.message}`);
  process.exit(1);
});
