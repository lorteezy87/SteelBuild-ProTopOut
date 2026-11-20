/* Phase 2 end-to-end checks against a running server whose owner already exists (run after e2e-phase1.cjs).
 * Signing a T&M ticket stores its signature, so start the server with R2_ENDPOINT pointing at scripts/fake-r2.cjs.
 * Usage: node scripts/e2e-phase2.cjs http://localhost:3460 pm@topout.test 'erect-the-steel-26' ./e2e-shots */
const { chromium } = require("playwright");
const fs = require("node:fs");

const [BASE = "http://localhost:3460", EMAIL = "pm@topout.test", PASSWORD = "erect-the-steel-26", OUT = "e2e-shots"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  const login = await page.evaluate(
    async ({ EMAIL, PASSWORD }) =>
      (await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).status,
    { EMAIL, PASSWORD },
  );
  ok(login === 200, `owner signed in (${login})`);
  const call = (proc, input, method = "POST") =>
    page.evaluate(
      async ({ proc, input, method }) => {
        const url = method === "GET" ? `/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `/api/trpc/${proc}`;
        const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ json: input }) });
        const body = await res.json();
        return res.ok ? { ok: true, data: body.result.data.json } : { ok: false, error: body.error?.json?.message ?? JSON.stringify(body).slice(0, 300) };
      },
      { proc, input, method },
    );
  const must = async (proc, input, method) => {
    const r = await call(proc, input, method);
    if (!r.ok) throw new Error(`${proc}: ${r.error}`);
    return r.data;
  };
  const visible = async (path, text) => {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    try {
      await page.getByText(text).locator("visible=true").first().waitFor({ timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  };

  const today = (await must("today.summary", undefined, "GET")).today;
  const job = await must("projects.create", { code: `P2-${Date.now() % 100000}`, name: "Phase 2 check", state: "active", template: "blank", startDate: today });
  const seq = await must("tasks.create", { projectId: job.id, name: "Seq 1 — Level 2", kind: "sequence", durationDays: 5, startDate: today, plannedTons: 100 });
  const seqRow = async () => (await must("tasks.list", { projectId: job.id }, "GET")).tasks.find(t => t.id === seq.id);

  // 1. Gate open → Today lists the sequence.
  const t1 = await must("today.summary", undefined, "GET");
  ok(t1.sequencesNotReady.some(r => r.id === seq.id), "Today: sequence starting today with an open gate is 'Not ready to erect'");
  ok(await visible("/", "Not ready to erect"), "Today screen shows the Not ready to erect panel");
  const gate = await must("gates.get", { taskId: seq.id }, "GET");
  ok(gate.items.length === 7 && gate.status === "not_ready", `gate has 7 items and is not ready (${gate.status})`);

  // 2. Finalize without a reason is refused; with one it posts.
  const crew = await must("admin.users.create", { name: "Gate Crew" });
  const rep1 = await must("daily.save", { projectId: job.id, reportDate: today, crew: [{ userId: crew.id, taskId: seq.id, stHours: 8, otHours: 2 }], equipment: [], progress: [{ taskId: seq.id, tons: 10, pieces: 30, note: null, stage: "set" }] });
  const refused = await call("daily.finalize", { id: rep1.id });
  ok(!refused.ok && refused.error.includes("GATE_REASON_NEEDED") && refused.error.includes("Seq 1 — Level 2"), "finalize with an open gate is refused and names the sequence");
  ok((await seqRow()).erectedTons === 0, "refused finalize posted nothing");
  await must("daily.finalize", { id: rep1.id, gateReasons: { [seq.id]: "AB survey accepted verbally by GC super" } });
  const s1 = await seqRow();
  ok(s1.erectedTons === 10 && s1.status === "in_progress", `finalize with a reason posts Set 10 t and starts the sequence (${s1.erectedTons} t, ${s1.status})`);

  // 3. A later stage.
  const rep2 = await must("daily.save", { projectId: job.id, reportDate: today, crew: [], equipment: [], progress: [{ taskId: seq.id, tons: 4, pieces: 12, note: null, stage: "bolted" }] });
  await must("daily.finalize", { id: rep2.id });
  const s2 = await seqRow();
  ok(s2.boltedTons === 4 && s2.erectedTons === 10, `bolted stage posts separately (Set ${s2.erectedTons} t, Bolted ${s2.boltedTons} t)`);
  const prodSet = await must("daily.production", { projectId: job.id, stage: "set" }, "GET");
  const prodBolt = await must("daily.production", { projectId: job.id, stage: "bolted" }, "GET");
  ok(prodSet.days.length === 1 && prodSet.days[0].tons === 10 && prodBolt.days[0].tons === 4, "production chart data per stage");
  ok(prodSet.plan.tonsPerDay === 20, `planned rate 100 t / 5 days = ${prodSet.plan.tonsPerDay} t/day`);
  ok(await visible(`/jobs/${job.id}/tasks`, "Bolted"), "Sequences table shows tons by stage");

  // 4. Crane, setup, critical pick, lift plan.
  const crane = await must("cranes.models.create", { name: `E2E 100t AT ${Date.now() % 1000}`, chartText: "20 100000\n30 72k\n40 51000" });
  const badChart = await call("cranes.models.create", { name: "Bad", chartText: "20 abc" });
  ok(!badChart.ok && /line 1/.test(badChart.error), "a bad load chart is refused naming the line");
  const setup = await must("cranes.setups.create", { projectId: job.id, craneModelId: crane.id, name: "Setup 1 — east", grid1: "C", grid2: "4" });
  const pick = await must("cranes.picks.create", { setupId: setup.id, mark: "G12", sequenceTaskId: seq.id, pieceLb: 55000, riggingLb: 4040, radiusFt: 30 });
  const unknown = await must("cranes.picks.create", { setupId: setup.id, mark: "B7", pieceLb: null, radiusFt: 25 });
  const picks = await must("cranes.picks.list", { projectId: job.id }, "GET");
  const p1 = picks.find(p => p.id === pick.id);
  ok(p1.check.status === "critical" && p1.check.pct === 82, `59,040 lb at 30 ft on 72,000 lb is critical (${p1.check.status}, ${p1.check.pct} %)`);
  ok(picks.find(p => p.id === unknown.id).check.status === "unknown", "a pick without a weight is unknown");
  ok(await visible(`/print/lift/${pick.id}`, "Critical lift plan"), "lift plan prints as Critical lift plan");
  ok(await page.getByText("Not entered").first().isVisible(), "lift plan shows Not entered for the missing boom");
  ok(await visible(`/jobs/${job.id}/lifts`, "Setup 1 — east"), "Cranes & Lifts tab lists the setup");

  // 5. T&M ticket from the first report, signed, then locked.
  const tk = await must("tm.create", { projectId: job.id, ticketDate: today, description: "Field-drill embeds", fromDailyReportId: rep1.id });
  const tv = await must("tm.get", { id: tk.id }, "GET");
  ok(tv.lines.some(l => l.kind === "labor" && l.qty === 8 && l.otQty === 2), "ticket prefilled with the report's labor (8 ST + 2 OT)");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 100;
    const g = c.getContext("2d");
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(10, 80);
    g.bezierCurveTo(60, 0, 120, 100, 290, 20);
    g.stroke();
    return c.toDataURL("image/png");
  });
  const signed = await must("tm.sign", { id: tk.id, signedName: "Dana GC-Super", signedTitle: "Superintendent", signaturePng: png });
  ok(signed.ticket.status === "signed", "ticket signed on screen");
  const edit = await call("tm.update", { id: tk.id, description: "changed after signing" });
  ok(!edit.ok && edit.error.includes("Signed tickets can't be changed"), "signed ticket can't be edited");
  await page.goto(`${BASE}/print/tm/${tk.id}`, { waitUntil: "networkidle" });
  await page.getByText("Acknowledged by").waitFor({ timeout: 15000 });
  const imgOk = await page.evaluate(() => {
    const img = document.querySelector('img[alt="Signature"]');
    return !!img && img.complete && img.naturalWidth > 0;
  });
  ok(imgOk, "printed ticket shows the signature image");

  // 6. GC weekly report: this week vs an empty past week.
  const monday = d => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  ok(await visible(`/print/gc/${job.id}/${monday(today)}`, "Steel erected"), "weekly GC report renders");
  ok(/3-week look-ahead/i.test(await page.innerText("body")), "weekly GC report includes the look-ahead");
  ok(!(await page.innerText("body")).includes("No final daily reports this week"), "this week has final reports");
  ok(await visible(`/print/gc/${job.id}/2026-01-05`, "No final daily reports this week"), "an empty week says so instead of 0 t");
  ok(await visible(`/print/lookahead/${job.id}/${today}`, "Seq 1 — Level 2"), "3-week look-ahead lists the sequence");

  // 7. New screens fit at desktop and tablet width.
  for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, text, name] of [
      [`/jobs/${job.id}/lifts`, "Crane setups", "lifts"],
      [`/jobs/${job.id}/tickets`, "T&M-001", "tickets"],
      [`/jobs/${job.id}/overview`, "Reports for the GC", "overview"],
      ["/admin/cranes", "Cranes", "cranes"],
      ["/", "Not ready to erect", "today"],
    ]) {
      const seen = await visible(path, text);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      ok(seen && fits, `${path} at ${width}px: renders, no horizontal page scroll`);
      await page.screenshot({ path: `${OUT}/p2-${name}-${width}.png` });
    }
  }
  ok(!errors.length, `no page errors or 5xx (${errors.slice(0, 3).join(" | ") || "none"})`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.log(`FAIL exception: ${e.message}`);
  process.exit(1);
});
