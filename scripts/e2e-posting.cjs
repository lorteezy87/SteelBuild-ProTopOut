/* Posting integrity against a running server whose owner already exists (run after e2e-phase1.cjs).
 * Usage: node scripts/e2e-posting.cjs http://localhost:3460 pm@topout.test 'erect-the-steel-26' */
const { chromium } = require("playwright");

const [BASE = "http://localhost:3460", EMAIL = "pm@topout.test", PASSWORD = "erect-the-steel-26"] = process.argv.slice(2);
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const login = await page.evaluate(async ({ EMAIL, PASSWORD }) => {
    const r = await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    return r.status;
  }, { EMAIL, PASSWORD });
  ok(login === 200, `owner signed in (${login})`);
  const call = (proc, input, method = "POST") =>
    page.evaluate(
      async ({ proc, input, method }) => {
        const url = method === "GET" ? `/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `/api/trpc/${proc}`;
        const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ json: input }) });
        const body = await res.json();
        return res.ok ? { ok: true, data: body.result.data.json } : { ok: false, error: JSON.stringify(body).slice(0, 300) };
      },
      { proc, input, method }
    );
  const must = async (proc, input, method) => {
    const r = await call(proc, input, method);
    if (!r.ok) throw new Error(`${proc}: ${r.error}`);
    return r.data;
  };

  const today = (await must("today.summary", undefined, "GET")).today;
  const job = await must("projects.create", { code: `P-${Date.now() % 100000}`, name: "Posting check", state: "active", template: "blank", startDate: today });
  const seq = await must("tasks.create", { projectId: job.id, name: "Seq A", kind: "sequence", durationDays: 5, startDate: today, plannedTons: 100 });
  const crew = await must("admin.users.create", { name: "Posting Crew" });
  const save = () =>
    must("daily.save", { projectId: job.id, reportDate: today, crew: [{ userId: crew.id, taskId: seq.id, stHours: 8, otHours: 2 }], equipment: [], progress: [{ taskId: seq.id, tons: 7, pieces: 20, note: null }] });

  // 1. Double-click: two finalize calls at once must post exactly once.
  const rep = await save();
  // Phase 2: the sequence starts with its ready-to-erect gate open, so finalize carries a reason.
  const why = { [seq.id]: "e2e: gate reviewed in the field" };
  const both = await Promise.all([call("daily.finalize", { id: rep.id, gateReasons: why }), call("daily.finalize", { id: rep.id, gateReasons: why })]);
  ok(both.filter(r => r.ok).length === 1, `concurrent finalize: exactly one succeeds (${both.map(r => (r.ok ? "ok" : "refused")).join(", ")})`);
  const tasks1 = (await must("tasks.list", { projectId: job.id }, "GET")).tasks.find(t => t.id === seq.id);
  ok(tasks1.erectedTons === 7, `tons posted once (${tasks1.erectedTons} t)`);
  const bill = await must("time.billable", { projectId: job.id }, "GET");
  ok(bill.length === 2, `hours posted once: ${bill.length} time lines (8 ST + 2 OT)`);

  // 2. Invoiced hours: reopen must be refused and nothing deleted.
  await must("time.markInvoiced", { ids: bill.map(b => b.e.id) });
  const reopen = await call("daily.reopen", { id: rep.id });
  ok(!reopen.ok && /already invoiced/.test(reopen.error), `reopen after invoicing refused (${reopen.ok ? "allowed" : "refused"})`);
  const tasks2 = (await must("tasks.list", { projectId: job.id }, "GET")).tasks.find(t => t.id === seq.id);
  ok(tasks2.erectedTons === 7, `tons untouched after refused reopen (${tasks2.erectedTons} t)`);

  // 3. A report with recorded (not invoiced) hours still reopens cleanly.
  const rep2 = await save();
  await must("daily.finalize", { id: rep2.id, gateReasons: why });
  const re2 = await call("daily.reopen", { id: rep2.id });
  ok(re2.ok, "reopen of a non-invoiced report works");
  const tasks3 = (await must("tasks.list", { projectId: job.id }, "GET")).tasks.find(t => t.id === seq.id);
  ok(tasks3.erectedTons === 7, `reopen reverses its own tons only (${tasks3.erectedTons} t)`);

  // 4. Changing the password signs out other devices.
  const other = await (await browser.newContext()).newPage();
  await other.goto(BASE, { waitUntil: "networkidle" });
  await other.evaluate(async ({ EMAIL, PASSWORD }) => {
    await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  }, { EMAIL, PASSWORD });
  const me = p => p.evaluate(async () => (await (await fetch("/api/trpc/auth.me", { credentials: "include" })).json()).result.data.json);
  ok(!!(await me(other)), "second device signed in");
  const NEXT = PASSWORD + "-x";
  await must("account.changePassword", { current: PASSWORD, next: NEXT });
  ok(!(await me(other)), "password change signs the other device out");
  ok(!!(await me(page)), "this device stays signed in after changing the password");
  await must("account.changePassword", { current: NEXT, next: PASSWORD });

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.log(`FAIL exception: ${e.message}`);
  process.exit(1);
});
