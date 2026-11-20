import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { DASHBOARD_WIDGET_CAP, REPORT_SOURCES, type SourceKey } from "@shared/reports";
import { dashboards, reportStars, reports, users, type ReportConfig } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasJobModuleAccess, hasPriv, sec } from "../security/guard";
import { assertReportSourceAccess, runReport, sourceColumns } from "../services/reports";
import { bad, zId, zText } from "./_util";

const sourceKey = z.enum(Object.keys(REPORT_SOURCES) as [SourceKey, ...SourceKey[]]);

const configSchema = z.object({
  source: sourceKey,
  appKey: z.string().max(48).optional(),
  columns: z.array(z.string().max(80)).max(40),
  filters: z.array(z.object({ field: z.string().max(80), op: z.string().max(16), value: z.unknown() })).max(20),
  groupBy: z.string().max(80).optional(),
  sort: z.array(z.object({ field: z.string().max(80), dir: z.enum(["asc", "desc"]) })).max(4).optional(),
  output: z.enum(["table", "bar", "line", "pie"]),
  metric: z
    .object({ field: z.string().max(80).optional(), agg: z.enum(["count", "sum", "avg", "min", "max"]) })
    .optional(),
  dateBucket: z.enum(["day", "week", "month"]).optional(),
  cumulative: z.boolean().optional(),
  limit: z.number().int().min(1).max(15000).optional(),
});

type Ctx = Parameters<typeof sec>[0];

async function canAuthor(ctx: Ctx) {
  return ctx.user.role === "admin" || (await hasPriv(ctx, "report.create"));
}

async function loadReport(ctx: Ctx, id: number) {
  const d = await db();
  const [r] = await d.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
  if (r.ownerId !== ctx.user.id && !r.isShared && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "This report is private" });
  }
  return r;
}

async function loadDashboard(ctx: Ctx, id: number) {
  const d = await db();
  const [b] = await d.select().from(dashboards).where(eq(dashboards.id, id)).limit(1);
  if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
  if (b.ownerId !== ctx.user.id && !b.isShared && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "This dashboard is private" });
  }
  return b;
}

export const reportsRouter = router({
  sources: protectedProcedure.query(async ({ ctx }) => {
    const moduleAccess = hasJobModuleAccess(await sec(ctx));
    return Object.values(REPORT_SOURCES)
      .filter(s => moduleAccess || s.key === "logs")
      .map(s => ({ key: s.key, label: s.label, defaultColumns: s.defaultColumns }));
  }),

  columns: protectedProcedure
    .input(z.object({ source: sourceKey, appKey: z.string().max(48).optional() }))
    .query(async ({ ctx, input }) => {
      assertReportSourceAccess(await sec(ctx), input.source);
      return sourceColumns(input.source, input.appKey);
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const rows = await d
      .select({ r: reports, ownerName: users.name })
      .from(reports)
      .leftJoin(users, eq(users.id, reports.ownerId))
      .where(ctx.user.role === "admin" ? undefined : or(eq(reports.ownerId, ctx.user.id), eq(reports.isShared, true)))
      .orderBy(desc(reports.updatedAt));
    const stars = await d.select().from(reportStars).where(eq(reportStars.userId, ctx.user.id));
    const starred = new Set(stars.map(s => s.reportId));
    return rows.map(x => ({ ...x.r, ownerName: x.ownerName, starred: starred.has(x.r.id), mine: x.r.ownerId === ctx.user.id }));
  }),

  get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    const r = await loadReport(ctx, input.id);
    return { ...r, mine: r.ownerId === ctx.user.id, canEdit: r.ownerId === ctx.user.id || ctx.user.role === "admin" };
  }),

  run: protectedProcedure.input(z.object({ config: configSchema })).query(async ({ ctx, input }) => {
    return runReport(await sec(ctx), input.config as ReportConfig);
  }),

  runSaved: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    const r = await loadReport(ctx, input.id);
    return { report: r, result: await runReport(await sec(ctx), r.config) };
  }),

  save: protectedProcedure
    .input(
      z.object({
        id: zId.optional(),
        name: zText(200).min(1),
        description: z.string().max(2000).nullable().optional(),
        isShared: z.boolean().default(false),
        config: configSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await canAuthor(ctx))) bad("You don't have permission to create reports");
      const d = await db();
      if (input.id) {
        const r = await loadReport(ctx, input.id);
        if (r.ownerId !== ctx.user.id && ctx.user.role !== "admin") bad("Only the owner can edit this report");
        await d
          .update(reports)
          .set({ name: input.name, description: input.description ?? null, isShared: input.isShared, config: input.config as ReportConfig })
          .where(eq(reports.id, input.id));
        return { id: input.id };
      }
      const [{ id }] = await d
        .insert(reports)
        .values({
          name: input.name,
          description: input.description ?? null,
          isShared: input.isShared,
          config: input.config as ReportConfig,
          ownerId: ctx.user.id,
        })
        .$returningId();
      return { id };
    }),

  remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const r = await loadReport(ctx, input.id);
    if (r.ownerId !== ctx.user.id && ctx.user.role !== "admin") bad("Only the owner can delete this report");
    const d = await db();
    await d.delete(reportStars).where(eq(reportStars.reportId, r.id));
    await d.delete(reports).where(eq(reports.id, r.id));
    return { ok: true };
  }),

  star: protectedProcedure.input(z.object({ id: zId, starred: z.boolean() })).mutation(async ({ ctx, input }) => {
    await loadReport(ctx, input.id);
    const d = await db();
    if (input.starred) {
      await d.insert(reportStars).values({ reportId: input.id, userId: ctx.user.id }).onDuplicateKeyUpdate({ set: { userId: ctx.user.id } });
    } else {
      await d.delete(reportStars).where(and(eq(reportStars.reportId, input.id), eq(reportStars.userId, ctx.user.id)));
    }
    return { ok: true };
  }),

  /* ---------------- Dashboards ---------------- */
  dashboards: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const rows = await d
      .select({ b: dashboards, ownerName: users.name })
      .from(dashboards)
      .leftJoin(users, eq(users.id, dashboards.ownerId))
      .where(ctx.user.role === "admin" ? undefined : or(eq(dashboards.ownerId, ctx.user.id), eq(dashboards.isShared, true)))
      .orderBy(desc(dashboards.updatedAt));
    return rows.map(x => ({ ...x.b, ownerName: x.ownerName, mine: x.b.ownerId === ctx.user.id }));
  }),

  dashboard: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    const b = await loadDashboard(ctx, input.id);
    const d = await db();
    const ids = b.widgets.map(w => w.reportId);
    const reps = ids.length ? await d.select().from(reports).where(inArray(reports.id, ids)) : [];
    const s = await sec(ctx);
    const widgets = [];
    for (const w of b.widgets) {
      const r = reps.find(x => x.id === w.reportId);
      const visible = r && (r.ownerId === ctx.user.id || r.isShared || ctx.user.role === "admin");
      if (!r || !visible) {
        widgets.push({ ...w, report: null, result: null, error: "Report unavailable" });
        continue;
      }
      try {
        widgets.push({ ...w, report: { id: r.id, name: r.name, config: r.config }, result: await runReport(s, { ...r.config, limit: Math.min(r.config.limit ?? 50, 200) }), error: null });
      } catch (e) {
        widgets.push({ ...w, report: { id: r.id, name: r.name, config: r.config }, result: null, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    return { ...b, mine: b.ownerId === ctx.user.id, canEdit: b.ownerId === ctx.user.id || ctx.user.role === "admin", widgets };
  }),

  saveDashboard: protectedProcedure
    .input(
      z.object({
        id: zId.optional(),
        name: zText(200).min(1),
        isShared: z.boolean().default(false),
        widgets: z
          .array(z.object({ reportId: zId, size: z.enum(["sm", "md", "lg"]), title: zText(120).optional() }))
          .max(DASHBOARD_WIDGET_CAP, `A dashboard holds up to ${DASHBOARD_WIDGET_CAP} widgets`),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      if (input.id) {
        const b = await loadDashboard(ctx, input.id);
        if (b.ownerId !== ctx.user.id && ctx.user.role !== "admin") bad("Only the owner can edit this dashboard");
        await d.update(dashboards).set({ name: input.name, isShared: input.isShared, widgets: input.widgets }).where(eq(dashboards.id, input.id));
        return { id: input.id };
      }
      const [{ id }] = await d
        .insert(dashboards)
        .values({ name: input.name, isShared: input.isShared, widgets: input.widgets, ownerId: ctx.user.id })
        .$returningId();
      return { id };
    }),

  removeDashboard: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const b = await loadDashboard(ctx, input.id);
    if (b.ownerId !== ctx.user.id && ctx.user.role !== "admin") bad("Only the owner can delete this dashboard");
    const d = await db();
    await d.delete(dashboards).where(eq(dashboards.id, b.id));
    return { ok: true };
  }),
});
