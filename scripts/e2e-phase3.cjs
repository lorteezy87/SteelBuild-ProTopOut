/* Phase 3 end-to-end checks against a running server whose owner already exists (run after e2e-phase2.cjs).
 * Photo uploads go to storage, so start the server with R2_ENDPOINT pointing at scripts/fake-r2.cjs.
 * Usage: node scripts/e2e-phase3.cjs http://localhost:3460 pm@topout.test 'erect-the-steel-26' ./e2e-shots */
const { chromium } = require("playwright");
const fs = require("node:fs");

const [BASE = "http://localhost:3460", EMAIL = "pm@topout.test", PASSWORD = "erect-the-steel-26", OUT = "e2e-shots"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures++;
};
const plusDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
// 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  const job = await must("projects.create", { code: `P3-${Date.now() % 100000}`, name: "Phase 3 check", state: "active", template: "blank", startDate: today });
  const seq = await must("tasks.create", { projectId: job.id, name: "Seq A — Roof", kind: "sequence", durationDays: 5, startDate: today, plannedTons: 60 });

  // 1. QC: a failed bolting entry → one punch item, linked to the sequence.
  const bolt = await must("qc.bolts.create", { projectId: job.id, taskId: seq.id, logDate: today, location: "Grid C/4 L2", grade: "a325", method: "turn_of_nut", lotNumber: "L-4471", inspectorName: "R. Ortiz", result: "fail" });
  const punch = await must("qc.createPunch", { kind: "bolt", id: bolt.id });
  ok(/^PL-\d{3}$/.test(punch.label), `failed bolting entry created punch ${punch.label}`);
  const again = await call("qc.createPunch", { kind: "bolt", id: bolt.id });
  ok(!again.ok && again.error.includes("already created") && again.error.includes(punch.label), `a second punch is refused (${again.error})`);
  const pass = await must("qc.welds.create", { projectId: job.id, taskId: seq.id, logDate: today, location: "Splice D/7", process: "fcaw", ndt: "ut", result: "pass" });
  ok(!(await call("qc.createPunch", { kind: "weld", id: pass.id })).ok, "a passing entry can't create a punch item");
  const item = await must("wf.get", { id: punch.itemId }, "GET");
  ok(item.item.linkedTaskId === seq.id, "punch item is linked to the sequence");
  const sum = await must("qc.summary", { projectId: job.id }, "GET");
  ok(sum.find(s => s.taskId === seq.id)?.status === "deficiency", "sequence QC status is Deficiency");
  ok(await visible(`/jobs/${job.id}/qc`, "Grid C/4 L2"), "QC tab lists the bolting entry");
  ok(await visible(`/print/qc/${job.id}?sequence=${seq.id}`, "Field QC log"), "QC log prints");
  ok((await page.innerText("body")).includes(punch.label), "printed QC log shows the punch label");

  // 2. Safety.
  const jha = await must("safety.jhas.create", { projectId: job.id, title: "Set roof joists", steps: [{ step: "Land joist bundles", hazards: "Overloading deck", controls: "" }], ppe: ["hard_hat", "harness"] });
  const refuse = await call("safety.jhas.update", { id: jha.id, status: "active" });
  ok(!refuse.ok && refuse.error.includes("Step 1 needs hazards and controls") && refuse.error.includes("Name the competent person"), "activating an incomplete JHA is refused with its problems");
  await must("safety.jhas.update", { id: jha.id, status: "active", competentPerson: "J. Ruiz", steps: [{ step: "Land joist bundles", hazards: "Overloading deck", controls: "Land over beams only" }] });
  const crewA = await must("admin.users.create", { name: "Phase3 Operator" });
  const ptp = await must("safety.ptps.create", { projectId: job.id, planDate: today, fromJhaId: jha.id, attendees: [{ userId: crewA.id, name: "Phase3 Operator" }] });
  const ptpRow = await must("safety.ptps.get", { id: ptp.id }, "GET");
  ok(ptpRow.steps.length === 1 && ptpRow.steps[0].controls === "Land over beams only" && ptpRow.jhaTitle === "Set roof joists", "pre-task plan copied the JHA's steps");
  const talk = await must("safety.talks.create", { projectId: job.id, talkDate: today, topic: "100% tie-off", attendees: [{ userId: crewA.id, name: "A" }, { userId: crewA.id, name: "A" }, { userId: null, name: " GC Visitor " }, { userId: null, name: "gc visitor" }] });
  const talkRow = await must("safety.talks.get", { id: talk.id }, "GET");
  ok(talkRow.attendees.length === 2 && talkRow.attendees[1].name === "GC Visitor", `toolbox talk attendees de-duplicated (${talkRow.attendees.length})`);
  const defs = await must("customFields.defs", { entityType: "app:safety" }, "GET");
  ok(["injured_person", "treatment", "osha_recordable", "days_away", "reported_to_gc_on"].every(k => defs.some(d => d.key === k)), "Safety log has the incident fields");
  ok(await visible(`/print/ptp/${ptp.id}`, "Crew sign-in"), "pre-task plan prints with a sign-in");
  ok(await visible(`/print/jha/${jha.id}`, "Job hazard analysis"), "JHA prints");

  // 3. Certifications.
  const role = await must("admin.jobRoles.upsert", { name: `Crane Operator P3 ${Date.now() % 1000}`, costRate: 60, billRate: 95, requiredCerts: ["nccco_operator"] });
  const op = await must("admin.users.create", { name: "No-Card Operator", jobRoleId: role.id });
  const unk = await must("certs.create", { userId: crewA.id, certType: "nccco_rigger1", expiresOn: null });
  const t3 = await must("today.summary", undefined, "GET");
  ok(t3.certsDue.some(c => c.id === unk.id && c.status === "unknown"), "a cert with no expiry date is on Today as unknown");
  ok(await visible("/", "Expiry unknown"), "Today screen shows Expiry unknown");
  const rep = await must("daily.save", { projectId: job.id, reportDate: today, crew: [{ userId: op.id, jobRoleId: role.id, taskId: seq.id, stHours: 8, otHours: 0 }], equipment: [], progress: [] });
  const repView = await must("daily.get", { id: rep.id }, "GET");
  ok((repView.certGaps[String(op.id)] || []).includes("NCCCO Crane Operator"), "daily report flags the operator's missing NCCCO card");
  ok(await visible("/print/certs", "Crew certifications"), "certification matrix prints");

  // 4. Rentals.
  const crane = await must("admin.equipment.upsert", { name: `P3 Rental RT ${Date.now() % 1000}`, type: "crane", ownership: "rented", hourlyRate: 150, standbyRate: 75 });
  const ref = await must("ref.all", undefined, "GET");
  const craneId = (crane && crane.id) || ref.equipment.find(e => e.name.startsWith("P3 Rental RT")).id;
  const onRent = plusDays(today, -10);
  const rent = await must("rentals.create", { projectId: job.id, equipmentId: craneId, description: "Grove RT 90t", vendorName: "Valley Crane", onRentDate: onRent, plannedOffRentDate: plusDays(today, -1), callOffNoticeDays: 1, weekRate: 7000, dayRate: 1500, monthRate: 18000 });
  const unpriced = await must("rentals.create", { projectId: job.id, description: "Manlift 60'", onRentDate: onRent });
  const t4 = await must("today.summary", undefined, "GET");
  ok(t4.rentalsToCallOff.some(r => r.id === rent.id && r.status === "overdue"), "a rental past its planned off-rent date is overdue on Today");
  ok(await visible("/", "Overdue — still on rent"), "Today screen shows Overdue — still on rent");
  const before = (await must("financials.summary", { projectId: job.id }, "GET")).costs;
  const rep2 = await must("daily.save", { projectId: job.id, reportDate: plusDays(today, -2), crew: [], equipment: [{ equipmentId: craneId, operatingHours: 8, standbyHours: 0 }], progress: [] });
  await must("daily.finalize", { id: rep2.id });
  const after = (await must("financials.summary", { projectId: job.id }, "GET")).costs;
  ok(after.equipmentCost === before.equipmentCost && after.equipmentCoveredByRental > 0, `rented crane on a daily report isn't costed twice (equipment ${after.equipmentCost}, covered ${after.equipmentCoveredByRental})`);
  ok(after.rentalCost > 0 && after.rentalsUnpriced === 1, `rental cost counted once and the unpriced rental is flagged (${after.rentalCost}, ${after.rentalsUnpriced} unpriced)`);
  const rows = await must("rentals.list", { projectId: job.id }, "GET");
  ok(rows.find(r => r.id === unpriced.id).cost.total === null, "a rental without rates has an unknown cost, not $0");
  ok(await visible(`/jobs/${job.id}/rentals`, "Rate not entered"), "Rentals tab shows Rate not entered");
  ok(await visible(`/jobs/${job.id}/financials`, "1 rental unpriced"), "Financials shows 1 rental unpriced");
  const badOff = await call("rentals.offRent", { id: rent.id, offRentDate: plusDays(onRent, -1) });
  ok(!badOff.ok && badOff.error.includes("before the on-rent date"), "off-rent before on-rent is refused");

  // 5. Photo log.
  const tk = await must("tm.create", { projectId: job.id, ticketDate: today, description: "Extra bracing" });
  const up = (name, extra) => must("collab.upload", { projectId: job.id, name, category: "photos", revision: "1", ...extra, file: { fileName: name, mimeType: "image/png", base64: PNG } });
  await up("dated.png", { caption: "Roof bracing installed", takenOn: plusDays(today, -1), sequenceTaskId: seq.id });
  await up("undated.png", { caption: "Undated shot" });
  const photos = await must("photos.list", { projectId: job.id }, "GET");
  const dated = photos.find(p => p.caption === "Roof bracing installed");
  const undated = photos.find(p => p.caption === "Undated shot");
  ok(dated && !dated.estimated && dated.day === plusDays(today, -1), "a dated photo files under the day it was taken");
  ok(undated && undated.estimated && undated.takenOn === null, "an undated photo files under its upload day, marked estimated");
  await must("photos.attach", { projectId: job.id, documentIds: [dated.id], entityType: "tmTicket", entityId: tk.id });
  await must("photos.attach", { projectId: job.id, documentIds: [dated.id], entityType: "tmTicket", entityId: tk.id });
  const onTicket = await must("photos.list", { projectId: job.id, entityType: "tmTicket", entityId: tk.id }, "GET");
  ok(onTicket.length === 1 && onTicket[0].id === dated.id, "attaching twice leaves one photo on the ticket");
  ok(await visible(`/print/tm/${tk.id}`, "Roof bracing installed"), "T&M print shows the attached photo");
  ok(await visible(`/jobs/${job.id}/photos`, "Undated shot"), "Photos tab lists the photos");
  ok((await page.innerText("body")).includes("uploaded"), "Photos tab marks the undated photo as uploaded");
  const other = await must("projects.create", { code: `P3X-${Date.now() % 100000}`, name: "Other job", state: "active", template: "blank", startDate: today });
  const cross = await call("photos.attach", { projectId: other.id, documentIds: [dated.id], entityType: "tmTicket", entityId: tk.id });
  ok(!cross.ok, "a photo can't be attached across jobs");

  // 6. New screens fit at desktop and tablet width.
  for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, text, name] of [
      [`/jobs/${job.id}/qc`, "QC by sequence", "qc"],
      [`/jobs/${job.id}/safety`, "Set roof joists", "safety"],
      [`/jobs/${job.id}/rentals`, "Grove RT 90t", "rentals"],
      [`/jobs/${job.id}/photos`, "Photo log", "photos"],
      ["/admin/certifications", "Certifications", "certs"],
      ["/", "Rentals to call off", "today"],
    ]) {
      const seen = await visible(path, text);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      ok(seen && fits, `${path} at ${width}px: renders, no horizontal page scroll`);
      await page.screenshot({ path: `${OUT}/p3-${name}-${width}.png` });
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
