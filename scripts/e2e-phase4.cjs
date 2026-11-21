/* Phase 4 end-to-end checks: weather (against scripts/fake-nws.cjs) and offline daily reports and photos.
 * Run after e2e-phase3.cjs, against a production build started with NWS_BASE_URL=http://127.0.0.1:9200 and
 * R2_ENDPOINT pointing at scripts/fake-r2.cjs.
 * Usage: node scripts/e2e-phase4.cjs http://localhost:3460 pm@topout.test 'erect-the-steel-26' ./e2e-shots [http://127.0.0.1:9200] */
const { chromium } = require("playwright");
const fs = require("node:fs");
const crypto = require("node:crypto");

const [BASE = "http://localhost:3460", EMAIL = "pm@topout.test", PASSWORD = "erect-the-steel-26", OUT = "e2e-shots", NWS = "http://127.0.0.1:9200"] = process.argv.slice(2);
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
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const nwsMode = mode => fetch(`${NWS}/__mode`, { method: "POST", body: JSON.stringify({ mode }) });
const phoenixToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function signIn(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const status = await page.evaluate(
    async ({ EMAIL, PASSWORD }) =>
      (await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).status,
    { EMAIL, PASSWORD },
  );
  /** tRPC call from the page; `dates` names input keys sent as Dates (superjson). */
  const call = (proc, input, method = "POST", dates = []) =>
    page.evaluate(
      async ({ proc, input, method, dates }) => {
        const meta = dates.length ? { values: Object.fromEntries(dates.map(k => [k, ["Date"]])) } : undefined;
        const body = { json: input, ...(meta ? { meta } : {}) };
        const url = method === "GET" ? `/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(body))}` : `/api/trpc/${proc}`;
        const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
        const b = await res.json();
        return res.ok ? { ok: true, data: b.result.data.json } : { ok: false, code: b.error?.json?.data?.code, error: b.error?.json?.message ?? JSON.stringify(b).slice(0, 300) };
      },
      { proc, input, method, dates },
    );
  const must = async (proc, input, method, dates) => {
    const r = await call(proc, input, method, dates);
    if (!r.ok) throw new Error(`${proc}: ${r.error}`);
    return r.data;
  };
  return { page, status, call, must };
}

const dumpOutbox = p =>
  p.evaluate(
    () =>
      new Promise(res => {
        const r = indexedDB.open("topout-offline");
        r.onsuccess = () => {
          const q = r.result.transaction("outbox").objectStore("outbox").getAll();
          q.onsuccess = () => res(JSON.stringify(q.result.map(i => ({ id: i.id, status: i.status, error: i.error, attempts: i.attempts, dep: i.dependsOn }))));
        };
      })
  );

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, status, call, must } = await signIn(ctx);
  ok(status === 200, `owner signed in (${status})`);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await nwsMode("ok");

  const today = phoenixToday();
  const yesterday = plusDays(today, -1);
  const job = await must("projects.create", { code: `P4-${Date.now() % 100000}`, name: "Phase 4 check", state: "active", template: "blank", startDate: plusDays(today, -20), latitude: 33.4484, longitude: -112.074, weatherDaysAllowed: 10 });
  const bare = await must("projects.create", { code: `P4N-${Date.now() % 100000}`, name: "No location", state: "active", template: "blank", startDate: today });

  // 1. Weather for a past day: observed, summarized in the site's day, flagged, then stored.
  const w1 = await must("weather.day", { projectId: job.id, date: yesterday }, "GET");
  ok(w1.status === "fetched" && w1.summary?.source === "observed", `yesterday's weather fetched from NWS (${w1.status})`);
  ok(w1.summary?.highF === 88 && w1.summary?.lowF === 59 && w1.summary?.maxGustMph === 35 && w1.summary?.precipIn === 0.12, `summary converted: ${JSON.stringify(w1.summary)}`);
  ok(w1.flags.some(f => f.startsWith("Gusts 35 mph")) && w1.flags.some(f => f.startsWith("Precipitation 0.12")), `flags at the default limits: ${w1.flags.join("; ")}`);
  const w2 = await must("weather.day", { projectId: job.id, date: yesterday }, "GET");
  ok(w2.status === "stored", `a finished day is kept (${w2.status})`);
  const old = await must("weather.day", { projectId: job.id, date: plusDays(today, -10) }, "GET");
  ok(old.status === "too_old" && old.summary === null && /by hand/.test(old.reason), `10 days back: not available, enter by hand (${old.status})`);
  const none = await must("weather.day", { projectId: bare.id, date: yesterday }, "GET");
  ok(none.status === "no_location" && none.summary === null, `a job with no location says so (${none.status})`);
  const fc = await must("weather.day", { projectId: job.id, date: plusDays(today, 2) }, "GET");
  ok(fc.status === "fetched" && fc.summary?.source === "forecast" && fc.summary.maxWindMph === 22 && fc.flags.some(f => f.startsWith("Wind 22")), `forecast day: ${JSON.stringify(fc.summary && { wind: fc.summary.maxWindMph, flags: fc.flags })}`);

  // 2. NWS down → "unavailable" with a reason, never an empty "fine" day.
  await nwsMode("error");
  const down = await must("weather.day", { projectId: job.id, date: plusDays(today, -3) }, "GET");
  ok(down.status === "unavailable" && down.summary === null && /error/.test(down.reason), `NWS error reads as unavailable (${down.reason})`);
  const storedStill = await must("weather.day", { projectId: job.id, date: yesterday }, "GET");
  ok(storedStill.status === "stored", "a stored day still shows while NWS is down");
  await nwsMode("ok");

  // 3. Thresholds are the PM's: raising the gust limit clears that flag.
  const t0 = await must("weather.thresholds", undefined, "GET");
  await must("weather.setThresholds", { ...t0, gustMph: 40 });
  const w3 = await must("weather.day", { projectId: job.id, date: yesterday }, "GET");
  ok(!w3.flags.some(f => f.startsWith("Gusts")), `gust limit 40: no gust flag (${w3.flags.join("; ")})`);
  await must("weather.setThresholds", t0);

  // 4. A replayed create (answer lost) doesn't duplicate the report.
  const key = crypto.randomUUID();
  const base = { projectId: job.id, reportDate: yesterday, crew: [], equipment: [], progress: [], workPerformed: "Set columns line C", weatherDelay: "full" };
  const a = await must("daily.save", { ...base, clientKey: key });
  const b = await must("daily.save", { ...base, clientKey: key, workPerformed: "Set columns line C (resent)" });
  const list1 = (await must("daily.list", { projectId: job.id }, "GET")).filter(r => r.reportDate === yesterday);
  ok(a.id === b.id && list1.length === 1, `same clientKey → same report (${a.id}, ${b.id}; ${list1.length} on the day)`);

  // 5. An edit from an old copy is a conflict; from the current copy, or with no base, it saves.
  const cur = await must("daily.get", { id: a.id }, "GET");
  const stale = await call("daily.save", { ...base, id: a.id, baseUpdatedAt: new Date(Date.parse(cur.report.updatedAt) - 60_000).toISOString() }, "POST", ["baseUpdatedAt"]);
  ok(!stale.ok && stale.code === "CONFLICT", `edit from an older copy refused as CONFLICT (${stale.code}: ${stale.error})`);
  const fresh = await call("daily.save", { ...base, id: a.id, baseUpdatedAt: cur.report.updatedAt }, "POST", ["baseUpdatedAt"]);
  ok(fresh.ok, `edit from the current copy saves (${fresh.error ?? "ok"})`);
  ok((await call("daily.save", { ...base, id: a.id, workPerformed: "Keep mine" })).ok, "no base version overwrites (keep mine)");

  // 6. Weather-day register and Today outlook.
  const reg = await must("weather.register", { projectId: job.id }, "GET");
  ok(reg.counts.full === 1 && reg.allowed === 10 && reg.rows.find(r => r.id === a.id)?.summary?.maxGustMph === 35, `register: ${JSON.stringify(reg.counts)}, allowed ${reg.allowed}, conditions stored`);
  const out = await must("weather.outlook", { projectIds: [job.id, bare.id] }, "GET");
  ok(out.flagged.some(f => f.projectId === job.id) && out.noLocation.includes(bare.id), `Today outlook flags the windy forecast and lists the job with no location (${out.flagged.length} flagged)`);

  // 7. Finalized elsewhere → a later save is refused, not merged.
  await must("daily.finalize", { id: a.id });
  const after = await call("daily.save", { ...base, id: a.id });
  ok(!after.ok && /Only draft/.test(after.error), `save after finalize refused (${after.error})`);
  const weekStart = (() => {
    const d = new Date(`${yesterday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const gc = await must("gcReport.weekly", { projectId: job.id, weekStart }, "GET");
  ok(gc.weather.days.some(w => w.date === yesterday && w.delay === "full") && gc.weather.toDate.full >= 1, `GC weekly report lists the weather day (${JSON.stringify(gc.weather.toDate)})`);

  // 8. A replayed photo upload returns the first one.
  const pk = crypto.randomUUID();
  const up = () => must("collab.upload", { projectId: job.id, name: "Rain at C4.png", category: "photos", revision: "1", clientKey: pk, file: { fileName: "rain.png", mimeType: "image/png", base64: PNG } });
  const p1 = await up();
  const p2 = await up();
  const photos = (await must("photos.list", { projectId: job.id }, "GET")).filter(p => p.name === "Rain at C4.png");
  ok(p1.id === p2.id && photos.length === 1, `same photo clientKey → one photo (${p1.id}, ${p2.id}; ${photos.length})`);

  // 9. Offline on the tablet: the app opens, a report and a photo save on the device, then sync once.
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 1300 }, hasTouch: true });
  const tab = await signIn(tablet);
  const t = tab.page;
  t.on("pageerror", e => errors.push(`tablet: ${e.message}`));
  await t.goto(`${BASE}/jobs/${job.id}/daily`, { waitUntil: "networkidle" });
  await t.evaluate(() => navigator.serviceWorker.ready);
  await t.reload({ waitUntil: "networkidle" });
  await t.getByText("Field report register").first().waitFor({ timeout: 15000 });
  await t.waitForTimeout(2500); // on-device cache write is throttled
  ok(await t.evaluate(() => !!navigator.serviceWorker.controller), "service worker controls the page");

  await tablet.setOffline(true);
  await t.reload({ waitUntil: "load" });
  const openedOffline = await t.getByText("Field report register").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  ok(openedOffline, "with no connection the job's daily reports still open");
  await t.screenshot({ path: `${OUT}/p4-offline-list.png` });
  ok(await t.getByRole("button", { name: /Sync: Offline/ }).isVisible(), "top bar says Offline");

  await t.getByRole("button", { name: "New report" }).click();
  const workBox = t.locator('div:has(> div.label-caps:text-is("Work performed")) textarea');
  await workBox.waitFor({ timeout: 10000 });
  await workBox.fill("Offline: hung joists bay 3");
  await t.getByRole("button", { name: "Save", exact: true }).click();
  const savedLocal = await t.getByText("Saved on this device").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  ok(savedLocal, "saving with no connection keeps the report on the device");
  await t.waitForURL(/\/daily\/local-/, { timeout: 10000 }).catch(() => {});
  ok(/\/daily\/local-/.test(t.url()), `the report opens as an on-device draft (${t.url().replace(BASE, "")})`);
  await t.screenshot({ path: `${OUT}/p4-offline-draft.png`, fullPage: true });
  await t.locator('input[type=file][aria-label="Add photos"]').setInputFiles({ name: "bay3.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  const photoQueued = await t.getByText("uploads after the report syncs").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  ok(photoQueued, "a photo on the unsynced report waits on the device");
  ok(await t.getByText("Weather lookup needs a connection").first().isVisible(), "offline, the weather panel says it needs a connection (not 'no weather')");
  await t.keyboard.press("Escape"); // the report drawer is modal; the top bar is behind it
  const two = await t.getByRole("button", { name: /Sync: Offline · 2 on this device/ }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  ok(two, "top bar counts 2 items on this device");
  if (!two) {
    console.log("outbox:", await dumpOutbox(t), "| badge:", await t.getByRole("button", { name: /^Sync:/ }).getAttribute("aria-label").catch(() => "none"));
    await t.screenshot({ path: `${OUT}/p4-count.png` });
  }
  await t.screenshot({ path: `${OUT}/p4-offline-editor.png` });

  await tablet.setOffline(false);
  await t.evaluate(() => window.dispatchEvent(new Event("online")));
  const synced = await t.getByRole("button", { name: /^Sync:/ }).waitFor({ state: "detached", timeout: 30000 }).then(() => true, () => false);
  ok(synced, "back online: everything syncs and the badge clears");
  for (let i = 0; i < 30 && !(await must("photos.list", { projectId: job.id }, "GET")).some(p => p.name === "bay3.png"); i++) await page.waitForTimeout(1000);
  const offlineReports = (await must("daily.list", { projectId: job.id }, "GET")).filter(r => r.reportDate === today);
  ok(offlineReports.length === 1, `exactly one report reached the server (${offlineReports.length})`);
  const offlineRep = offlineReports[0] && (await must("daily.get", { id: offlineReports[0].id }, "GET"));
  ok(offlineRep?.report.workPerformed === "Offline: hung joists bay 3", "it carries what was typed offline");
  await page.waitForTimeout(500);
  const repPhotos = offlineReports[0] ? await must("photos.list", { projectId: job.id, entityType: "dailyReport", entityId: offlineReports[0].id }, "GET") : [];
  ok(repPhotos.length === 1 && repPhotos[0].name === "bay3.png", `the queued photo attached to that report (${repPhotos.length})`);
  ok(!(await t.getByText("On this device", { exact: true }).first().isVisible().catch(() => false)), "the register no longer lists it as on this device");

  // 10. Two devices: the tablet edits offline while the desktop changes the same report → held, PM keeps theirs.
  const rid = offlineReports[0].id;
  await t.goto(`${BASE}/jobs/${job.id}/daily/${rid}`, { waitUntil: "networkidle" });
  await workBox.waitFor({ timeout: 10000 });
  await t.waitForTimeout(2500);
  await tablet.setOffline(true);
  await workBox.fill("Tablet: hung joists bay 3 and 4");
  await t.getByRole("button", { name: "Save", exact: true }).click();
  await t.getByText("Saved on this device").first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1100); // stored times are whole seconds
  await must("daily.save", { projectId: job.id, id: rid, reportDate: today, crew: [], equipment: [], progress: [], workPerformed: "Desktop: changed meanwhile" });
  await t.keyboard.press("Escape");
  await tablet.setOffline(false);
  await t.evaluate(() => window.dispatchEvent(new Event("online")));
  const held = await t.getByRole("button", { name: /Sync: 1 needs attention/ }).waitFor({ timeout: 30000 }).then(() => true, () => false);
  ok(held, "the conflicting tablet edit is held as needing attention");
  if (!held) {
    await t.screenshot({ path: `${OUT}/p4-conflict-missing.png` });
    console.log(
      "outbox:",
      await t.evaluate(
        () =>
          new Promise(res => {
            const r = indexedDB.open("topout-offline");
            r.onsuccess = () => {
              const q = r.result.transaction("outbox").objectStore("outbox").getAll();
              q.onsuccess = () => res(JSON.stringify(q.result.map(i => ({ id: i.id, status: i.status, error: i.error, attempts: i.attempts, base: i.input.baseUpdatedAt }))));
            };
          })
      )
    );
  }
  ok((await must("daily.get", { id: rid }, "GET")).report.workPerformed === "Desktop: changed meanwhile", "nothing was overwritten while held");
  await t.getByRole("button", { name: /Sync: 1 needs attention/ }).click();
  await t.getByText("Changed on another device").first().waitFor({ timeout: 10000 });
  await t.screenshot({ path: `${OUT}/p4-conflict.png` });
  await t.getByRole("button", { name: "Keep mine" }).first().click();
  await t.getByRole("button", { name: "Keep mine" }).last().click(); // confirm
  await t.getByText("Nothing waiting").first().waitFor({ timeout: 30000 }).catch(() => {});
  ok((await must("daily.get", { id: rid }, "GET")).report.workPerformed === "Tablet: hung joists bay 3 and 4", "Keep mine: the tablet's copy replaced the desktop's");

  // 11. Screens render: weather panel, register, settings, Today, job form.
  const visible = async (p, path, text) => {
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    return p.getByText(text).locator("visible=true").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  };
  ok(await visible(page, `/jobs/${job.id}/daily/${a.id}`, "Weather (National Weather Service)"), "daily report shows the Weather panel");
  ok(await page.getByText("Gusts 35 mph (limit 30)").first().isVisible().catch(() => false), "…with the gust flag");
  await page.screenshot({ path: `${OUT}/p4-report-weather.png` });
  ok(await visible(page, `/jobs/${job.id}/daily`, "Weather days"), "Daily reports page shows the Weather days register");
  ok(await page.getByText("1 full · 0 partial · 10 allowed").first().isVisible().catch(() => false), "…with the count against the allowance");
  await page.screenshot({ path: `${OUT}/p4-weather-days.png`, fullPage: true });
  ok(await visible(page, "/admin/weather", "Weather limits"), "Settings → Weather limits renders");
  ok(await visible(page, "/", "Weather risk — next 3 days"), "Today shows the weather risk panel");
  await page.screenshot({ path: `${OUT}/p4-today.png`, fullPage: true });

  ok(!errors.length, `no page errors or 5xx (${errors.slice(0, 3).join(" | ") || "none"})`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch(async e => {
  console.log(`FAIL exception: ${e.message}`);
  await nwsMode("ok").catch(() => {});
  process.exit(1);
});
