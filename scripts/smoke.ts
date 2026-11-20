/* eslint-disable no-console */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { db } from "../server/db";
import { ensureBootstrap } from "../server/bootstrap";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

const WIPE = process.argv.includes("--wipe");

async function main() {
  await ensureBootstrap();
  const d = await db();
  const openId = "local:smoketest-admin";
  let [u] = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!u) {
    await d.insert(users).values({ openId, name: "Smoke Admin", email: "smoke@example.com", role: "admin", accessType: "full", loginMethod: "test" });
    [u] = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  }
  const ctx = { req: { headers: {} } as TrpcContext["req"], res: { cookie() {}, clearCookie() {} } as unknown as TrpcContext["res"], user: u, quiet: true } as TrpcContext;
  const c = appRouter.createCaller(ctx);
  const t0 = Date.now();
  const step = async <T>(name: string, fn: () => Promise<T>, show?: (r: T) => unknown) => {
    const s = Date.now();
    try {
      const r = await fn();
      console.log(`OK   ${name} (${Date.now() - s} ms)`, show ? JSON.stringify(show(r)).slice(0, 400) : "");
      return r;
    } catch (e) {
      console.log(`FAIL ${name}:`, e instanceof Error ? e.message.slice(0, 600) : e);
      if (e instanceof Error && e.stack) console.log(e.stack.split("\n").slice(0, 6).join("\n"));
      return undefined;
    }
  };

  const demo = await step("admin.loadDemo", () => c.admin.loadDemo(), r => r);
  const jobs = await step("projects.list", () => c.projects.list({}), r => (r as { code: string; scheduleHealth: string; costHealth: string; percentComplete: number }[]).map(j => [j.code, j.scheduleHealth, j.costHealth, j.percentComplete]));
  const pid = (demo as { projectIds?: number[] } | undefined)?.projectIds?.[0];
  if (pid) {
    await step("projects.get", () => c.projects.get({ id: pid }), r => ({ code: (r as { code: string }).code }));
    await step("tasks.list", () => c.tasks.list({ projectId: pid }), r => (r as { tasks?: unknown[] }).tasks?.length ?? r);
    await step("baselines.compare", async () => {
      const bl = await c.baselines.list({ projectId: pid });
      return c.baselines.compare({ projectId: pid, baselineId: bl.baselines[0].id });
    }, r => Object.keys(r as object));
    await step("deliveries.list", () => c.deliveries.list({ projectId: pid }), r => (r as unknown[]).length);
    await step("daily.list", () => c.daily.list({ projectId: pid }), r => (r as unknown[]).length);
    await step("financials.summary", () => c.financials.summary({ projectId: pid }), r => r);
    await step("wf.summary", () => c.wf.summary({ projectId: pid }), r => r);
    await step("wf.list rfi", () => c.wf.list({ appKey: "rfi", projectId: pid } as never), r => (r as { items?: unknown[] }).items?.length ?? r);
    await step("dashboard.jobTons", () => c.dashboard.jobTons({ projectId: pid }), r => (r as unknown[]).slice(0, 4));
    await step("collab.activity", () => c.collab.activity({ projectId: pid, limit: 5 }), r => (r as { summary: string }[]).map(a => a.summary));
    await step("collab.addComment", () => c.collab.addComment({ entityType: "project", entityId: pid, body: "Smoke test comment @Smoke" }));
  }
  await step("dashboard.portfolio", () => c.dashboard.portfolio(), r => {
    const p = r as Record<string, unknown>;
    return { counts: p.counts, scheduleRag: p.scheduleRag, costRag: p.costRag, money: p.money, crew: (p.crewHours as { total: number }).total, deliveries: (p.deliveries as unknown[]).length, rfi: p.rfiAging, tons: (p.tons as unknown[]).length };
  });
  await step("resources.workload", () => c.resources.workload({ weekStart: "2026-11-02", weeks: 4 }), r => Object.keys(r as object));
  const reps = await step("reports.list", () => c.reports.list(), r => (r as { name: string }[]).map(x => x.name));
  for (const rep of (reps as { id: number; name: string }[] | undefined) ?? []) {
    await step(`reports.runSaved ${rep.name}`, () => c.reports.runSaved({ id: rep.id }), r => {
      const x = (r as { result: { totalRows: number; series?: unknown[]; rows: unknown[] } }).result;
      return { total: x.totalRows, series: x.series?.slice(0, 5), rows: x.rows.length };
    });
  }
  const dashes = await step("reports.dashboards", () => c.reports.dashboards(), r => (r as { name: string }[]).map(x => x.name));
  const dash = (dashes as { id: number }[] | undefined)?.[0];
  if (dash) await step("reports.dashboard", () => c.reports.dashboard({ id: dash.id }), r => (r as { widgets: { error: string | null }[] }).widgets.map(w => w.error));
  await step("time.week", () => c.time.week({ weekStart: "2026-11-02" }), r => Object.keys(r as object));
  await step("ref.all", () => c.ref.all(), r => Object.keys(r as object));
  await step("collab.notifications", () => c.collab.notifications({ unreadOnly: false, limit: 5 }), r => (r as { unread: number }).unread);

  // REST API
  const tok = await step("integration.createToken", () => c.integration.createToken({ name: "smoke" }));
  if (tok) {
    const base = "http://localhost:3000/api/v2";
    const h = { Authorization: `Bearer ${(tok as { token: string }).token}` };
    for (const path of ["/jobs?fields=code,name,scheduleHealth", "/tasks?filter=" + encodeURIComponent(JSON.stringify({ kind: "sequence" })) + "&sort=startDate", "/logItems?app=rfi", "/deliveries?filter=" + encodeURIComponent(JSON.stringify({ risk: ["late", "at_risk"] })), "/timeEntries", "/users", "/dailyReports"]) {
      await step(`REST GET ${path.split("?")[0]}`, async () => {
        const r = await fetch(base + path, { headers: h });
        const j = (await r.json()) as { data?: unknown[]; totalRecords?: number; error?: unknown };
        if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
        return { status: r.status, total: j.totalRecords, usage: r.headers.get("x-steelbuild-api-usage"), first: j.data?.[0] };
      }, r => r);
    }
    await step("REST PATCH task", async () => {
      const list = (await (await fetch(`${base}/tasks?filter=${encodeURIComponent(JSON.stringify({ kind: "sequence" }))}`, { headers: h })).json()) as { data: { id: number }[] };
      const r = await fetch(`${base}/tasks/${list.data[0].id}`, { method: "PATCH", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ notes: "API patch" }) });
      return { status: r.status, body: await r.json() };
    }, r => r);
  }
  console.log(`total ${Date.now() - t0} ms`);

  if (WIPE) {
    const [rows] = (await d.execute(sql`show tables`)) as unknown as [Record<string, string>[]];
    const names = rows.map(r => Object.values(r)[0]).filter(n => !n.startsWith("__drizzle"));
    await d.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    for (const n of names) await d.execute(sql.raw(`TRUNCATE TABLE \`${n}\``));
    await d.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    console.log(`wiped ${names.length} tables`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
