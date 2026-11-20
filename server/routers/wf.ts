import { BALL_IN_COURT } from "@shared/ballInCourt";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { PRIORITIES, RESPONSIBLE_PARTIES } from "@shared/domain";
import { validateFormula } from "@shared/formula";
import {
  companies,
  customFieldDefs,
  customFieldValues,
  deliveries,
  drawingSheets,
  projectCompanies,
  projects,
  tasks,
  users,
  wfApps,
  wfEvents,
  wfItems,
  wfSlaPolicies,
  wfStates,
  wfTransitions,
} from "../../drizzle/schema";
import { adminProcedure, createCallerFactory, protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { effectivePrivileges } from "../security/access";
import { hasJobModuleAccess, hasPriv, requirePriv, sec } from "../security/guard";
import { orgToday } from "../services/calendars";
import { getDefs, getValues, maskFinancial, saveValues } from "../services/customFields";
import { emit, follow, logActivity, notify } from "../services/events";
import { createItem, getApp, getAppStructure, itemLabel, refreshItem, transitionItem, validateItemLinks } from "../services/wf";
import { projectsRouter } from "./projects";
import { bad, getProjectOr404, zDayOpt, zId, zText } from "./_util";

const enumOf = <T extends Record<string, string>>(o: T) => z.enum(Object.keys(o) as [string, ...string[]]);
type Ctx = Parameters<typeof sec>[0];

/** Can the user see items of this app on this project (or globally for global apps)? */
async function assertItemAccess(ctx: Ctx, app: { scope: string }, projectId: number | null, privilege: "log.view" | "log.create" | "log.edit" | "log.transition") {
  if (app.scope === "global") {
    await requirePriv(ctx, "bid.manage");
    return;
  }
  if (!projectId) bad("Choose a job");
  await requirePriv(ctx, privilege, projectId);
}

async function loadItem(id: number) {
  const d = await db();
  const [item] = await d.select().from(wfItems).where(eq(wfItems.id, id)).limit(1);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Log item not found" });
  return item;
}

async function finFor(ctx: Ctx, projectId: number | null) {
  if (projectId) return hasPriv(ctx, "project.financials", projectId);
  return ctx.user.role === "admin" || (await hasPriv(ctx, "bid.manage"));
}

const itemFields = {
  title: zText(255).min(1),
  description: z.string().max(20000).nullable(),
  priority: enumOf(PRIORITIES),
  assigneeId: zId.nullable(),
  responsibleParty: enumOf(RESPONSIBLE_PARTIES).nullable(),
  ballInCourt: z.enum(BALL_IN_COURT),
  dueDate: zDayOpt,
  linkedTaskId: zId.nullable(),
  linkedDeliveryId: zId.nullable(),
};

/** Designer guard: every referenced state must belong to the app being edited. */
async function assertStatesInApp(appId: number, stateIds: (number | null | undefined)[]) {
  const ids = stateIds.filter((x): x is number => typeof x === "number");
  if (!ids.length) return;
  const d = await db();
  const rows = await d.select({ id: wfStates.id, appId: wfStates.appId }).from(wfStates).where(inArray(wfStates.id, ids));
  if (rows.length !== new Set(ids).size || rows.some(r => r.appId !== appId)) bad("State does not belong to this log type");
}

export const wfRouter = router({
  app: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ input }) => {
    const app = await getApp(input.key);
    const structure = await getAppStructure(app.id);
    const defs = await getDefs(`app:${app.key}`);
    return { app, ...structure, fieldDefs: defs };
  }),

  /** Items of one app — for a job, or across visible jobs when projectId is omitted. */
  list: protectedProcedure
    .input(
      z.object({
        appKey: z.string(),
        projectId: zId.optional(),
        includeClosed: z.boolean().default(false),
        assignedToMe: z.boolean().optional(),
        search: z.string().max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await db();
      const app = await getApp(input.appKey);
      const s = await sec(ctx);
      let projectIds: number[] | null = null;
      if (app.scope === "global") {
        await requirePriv(ctx, "bid.manage");
      } else if (input.projectId) {
        await requirePriv(ctx, "log.view", input.projectId);
        projectIds = [input.projectId];
      } else {
        projectIds = [];
        s.projectIds.forEach(pid => {
          if (effectivePrivileges(s, pid).has("log.view")) projectIds!.push(pid);
        });
        if (!projectIds.length) return { items: [], states: [], fieldDefs: [] };
      }
      const { states } = await getAppStructure(app.id);
      const endIds = states.filter(x => x.category === "end").map(x => x.id);
      const conds = [eq(wfItems.appId, app.id)];
      if (projectIds) conds.push(inArray(wfItems.projectId, projectIds));
      if (input.assignedToMe) conds.push(eq(wfItems.assigneeId, ctx.user.id));
      if (input.search) conds.push(like(wfItems.title, `%${input.search.replace(/[%_]/g, "")}%`));
      let rows = await d
        .select({ item: wfItems, assigneeName: users.name, projectName: projects.name, projectCode: projects.code })
        .from(wfItems)
        .leftJoin(users, eq(users.id, wfItems.assigneeId))
        .leftJoin(projects, eq(projects.id, wfItems.projectId))
        .where(and(...conds))
        .orderBy(app.scoreFormula ? desc(wfItems.score) : desc(wfItems.number))
        .limit(2000);
      if (!input.includeClosed) rows = rows.filter(r => !endIds.includes(r.item.stateId));
      const defs = await getDefs(`app:${app.key}`);
      const values = await getValues(`app:${app.key}`, rows.map(r => r.item.id));
      const finCache = new Map<number | null, boolean>();
      const finOf = (pid: number | null) => {
        if (!finCache.has(pid)) finCache.set(pid, pid ? effectivePrivileges(s, pid).has("project.financials") : true);
        return finCache.get(pid)!;
      };
      return {
        states,
        fieldDefs: defs,
        items: rows.map(r => {
          const fin = finOf(r.item.projectId);
          return {
            ...r.item,
            label: itemLabel(app, r.item),
            costImpact: fin ? r.item.costImpact : null,
            assigneeName: r.assigneeName,
            projectName: r.projectName,
            projectCode: r.projectCode,
            customFields: maskFinancial(defs, values.get(r.item.id) ?? {}, fin),
          };
        }),
      };
    }),

  get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    const item = await loadItem(input.id);
    const app = await getApp(item.appId);
    await assertItemAccess(ctx, app, item.projectId, "log.view");
    const d = await db();
    const structure = await getAppStructure(app.id);
    const defs = await getDefs(`app:${app.key}`);
    const fin = await finFor(ctx, item.projectId);
    const values = (await getValues(`app:${app.key}`, [item.id])).get(item.id) ?? {};
    const events = await d
      .select({ ev: wfEvents, userName: users.name })
      .from(wfEvents)
      .leftJoin(users, eq(users.id, wfEvents.userId))
      .where(eq(wfEvents.itemId, item.id))
      .orderBy(asc(wfEvents.createdAt), asc(wfEvents.id));
    const s = await sec(ctx);
    const privs = item.projectId ? Array.from(effectivePrivileges(s, item.projectId)) : [];
    const canViewLinks = item.projectId != null && hasJobModuleAccess(s) && privs.includes("project.view");
    const linkedTask = canViewLinks && item.linkedTaskId
      ? (await d.select({ id: tasks.id, name: tasks.name, wbs: tasks.wbs }).from(tasks).where(and(eq(tasks.id, item.linkedTaskId), eq(tasks.projectId, item.projectId!))).limit(1))[0] ?? null
      : null;
    const linkedDelivery = canViewLinks && item.linkedDeliveryId
      ? (await d.select().from(deliveries).where(and(eq(deliveries.id, item.linkedDeliveryId), eq(deliveries.projectId, item.projectId!))).limit(1))[0] ?? null
      : null;
    const canEdit = app.scope === "global" ? await hasPriv(ctx, "bid.manage") : privs.includes("log.edit");
    const canTransition = app.scope === "global" ? await hasPriv(ctx, "bid.manage") : privs.includes("log.transition");
    const project = item.projectId ? await getProjectOr404(item.projectId) : null;
    return {
      app,
      ...structure,
      fieldDefs: fin ? defs : defs.filter(x => !x.isFinancial),
      item: { ...item, label: itemLabel(app, item), costImpact: fin ? item.costImpact : null },
      customFields: maskFinancial(defs, values, fin),
      events,
      linkedTask,
      linkedDelivery,
      project: project ? { id: project.id, name: project.name, code: project.code, noticeHours: project.noticeHours } : null,
      canEdit,
      canTransition,
      canFinancials: fin,
      availableTransitions: structure.transitions.filter(t => t.fromStateId === item.stateId && t.userAllowed),
      canConvert:
        app.key === "bid" &&
        (app.config?.convertStates ?? []).includes(structure.states.find(x => x.id === item.stateId)?.name ?? "") &&
        (await hasPriv(ctx, "project.create")),
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        appKey: z.string(),
        projectId: zId.nullable().optional(),
        title: zText(255).min(1),
        description: z.string().max(20000).nullable().optional(),
        priority: enumOf(PRIORITIES).optional(),
        assigneeId: zId.nullable().optional(),
        responsibleParty: enumOf(RESPONSIBLE_PARTIES).nullable().optional(),
        ballInCourt: z.enum(BALL_IN_COURT).optional(),
        dueDate: zDayOpt,
        linkedTaskId: zId.nullable().optional(),
        linkedDeliveryId: zId.nullable().optional(),
        customFields: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await getApp(input.appKey);
      await assertItemAccess(ctx, app, input.projectId ?? null, "log.create");
      return createItem(ctx, {
        appId: app.id,
        projectId: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        responsibleParty: input.responsibleParty ?? null,
        ballInCourt: input.ballInCourt,
        dueDate: input.dueDate ?? null,
        linkedTaskId: input.linkedTaskId ?? null,
        linkedDeliveryId: input.linkedDeliveryId ?? null,
        customFields: input.customFields,
        canFinancial: await finFor(ctx, input.projectId ?? null),
      });
    }),

  update: protectedProcedure
    .input(
      z
        .object({ id: zId, customFields: z.record(z.string(), z.unknown()).optional() })
        .extend(Object.fromEntries(Object.entries(itemFields).map(([k, v]) => [k, v.optional()])) as {
          [K in keyof typeof itemFields]: z.ZodOptional<(typeof itemFields)[K]>;
        })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await loadItem(input.id);
      const app = await getApp(item.appId);
      await assertItemAccess(ctx, app, item.projectId, "log.edit");
      await validateItemLinks(item.projectId, input);
      const { id, customFields, ...rest } = input;
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
      const d = await db();
      if (Object.keys(set).length) await d.update(wfItems).set(set).where(eq(wfItems.id, id));
      if (customFields) {
        await saveValues({
          entityType: `app:${app.key}`,
          entityId: id,
          values: customFields,
          base: { ...item, ...set },
          canFinancial: await finFor(ctx, item.projectId),
          today: await orgToday(),
        });
      }
      await refreshItem(id);
      if (set.assigneeId && set.assigneeId !== item.assigneeId) {
        await follow("logItem", id, set.assigneeId as number);
        await notify(ctx, [set.assigneeId as number], {
          title: `${itemLabel(app, item)} assigned to you: ${item.title}`,
          link: item.projectId ? `/jobs/${item.projectId}/logs/${app.key}/${id}` : `/bids/${id}`,
        });
      }
      await logActivity(ctx, { projectId: item.projectId, entityType: "logItem", entityId: id, action: "update", summary: `updated ${itemLabel(app, item)}` });
      await emit(ctx, "logItem", "update", { id, app: app.key, label: itemLabel(app, item) });
      return { ok: true };
    }),

  transition: protectedProcedure
    .input(z.object({ id: zId, transitionId: zId, comment: z.string().max(5000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const item = await loadItem(input.id);
      const app = await getApp(item.appId);
      await assertItemAccess(ctx, app, item.projectId, "log.transition");
      // Required fields must be filled before leaving the start state.
      const { states } = await getAppStructure(app.id);
      const from = states.find(x => x.id === item.stateId);
      if (from?.category === "start") {
        const defs = await getDefs(`app:${app.key}`);
        const vals = (await getValues(`app:${app.key}`, [item.id])).get(item.id) ?? {};
        const missing = defs.filter(x => x.required && x.fieldType !== "formula" && (vals[x.key] == null || vals[x.key] === ""));
        if (missing.length) bad(`Fill in required fields first: ${missing.map(m => m.label).join(", ")}`);
      }
      return transitionItem(ctx, item.id, { transitionId: input.transitionId, comment: input.comment ?? null });
    }),

  remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const item = await loadItem(input.id);
    const app = await getApp(item.appId);
    await assertItemAccess(ctx, app, item.projectId, "log.edit");
    const d = await db();
    await d.transaction(async tx => {
      // Same first lock as every Drawings mutation. Hold creation and RFI removal cannot pass each other.
      if (item.projectId != null) {
        const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, item.projectId)).limit(1).for("update");
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (app.key === "rfi" && item.projectId != null) {
        const held = await tx.select({ sheetNumber: drawingSheets.sheetNumber }).from(drawingSheets)
          .where(and(eq(drawingSheets.projectId, item.projectId), eq(drawingSheets.status, "HOLD"), eq(drawingSheets.holdRfiId, item.id)))
          .orderBy(asc(drawingSheets.id)).for("update");
        if (held.length) throw new TRPCError({ code: "CONFLICT", message: `This RFI holds drawing ${held.map(x => x.sheetNumber).join(", ")} — close the RFI and resolve/release its drawing holds before deleting it` });
      }
      const [current] = await tx.select().from(wfItems).where(eq(wfItems.id, item.id)).limit(1).for("update");
      if (!current || current.projectId !== item.projectId || current.appId !== item.appId)
        throw new TRPCError({ code: "CONFLICT", message: "Log item changed or was removed — reload before deleting it" });
      await tx.delete(wfEvents).where(eq(wfEvents.itemId, item.id));
      await tx.delete(customFieldValues).where(and(eq(customFieldValues.entityType, `app:${app.key}`), eq(customFieldValues.entityId, item.id)));
      await tx.delete(wfItems).where(eq(wfItems.id, item.id));
    });
    await logActivity(ctx, { projectId: item.projectId, entityType: "logItem", entityId: item.id, action: "delete", summary: `deleted ${itemLabel(app, item)} ${item.title}` });
    await emit(ctx, "logItem", "delete", { id: item.id, app: app.key });
    return { ok: true };
  }),

  /** Open / at-risk / delayed counts per log type for one job. */
  summary: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requirePriv(ctx, "log.view", input.projectId);
    const d = await db();
    const rows = await d
      .select({
        appId: wfItems.appId,
        open: sql<number>`sum(case when ${wfStates.category} <> 'end' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
        atRisk: sql<number>`sum(case when ${wfStates.category} <> 'end' and ${wfItems.slaStatus} = 'at_risk' then 1 else 0 end)`,
        delayed: sql<number>`sum(case when ${wfStates.category} <> 'end' and ${wfItems.slaStatus} = 'delayed' then 1 else 0 end)`,
      })
      .from(wfItems)
      .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
      .where(eq(wfItems.projectId, input.projectId))
      .groupBy(wfItems.appId);
    return rows.map(r => ({ appId: r.appId, open: Number(r.open), total: Number(r.total), atRisk: Number(r.atRisk), delayed: Number(r.delayed) }));
  }),

  /** Jobs where a new project-scoped log can be created. Keeps cross-job create controls privilege-aware. */
  creationJobs: protectedProcedure.query(async ({ ctx }) => {
    const s = await sec(ctx);
    const ids: number[] = [];
    s.projectIds.forEach(projectId => {
      const privileges = effectivePrivileges(s, projectId);
      if (privileges.has("project.view") && privileges.has("log.create")) ids.push(projectId);
    });
    if (!ids.length) return [];
    const d = await db();
    return d.select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects).where(inArray(projects.id, ids)).orderBy(asc(projects.code), asc(projects.name));
  }),

  /** Bid pipeline: create a job from an awarded bid and close the bid as Converted. */
  convertBid: protectedProcedure
    .input(
      z.object({
        id: zId,
        code: zText(32).nullable().optional(),
        name: zText(255).min(1).optional(),
        startDate: zDayOpt,
        deadline: zDayOpt,
        sequenceCount: z.number().int().min(1).max(40).default(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await loadItem(input.id);
      const app = await getApp(item.appId);
      if (app.key !== "bid") bad("Only bids can be converted to jobs");
      await requirePriv(ctx, "bid.manage");
      await requirePriv(ctx, "project.create");
      const { states } = await getAppStructure(app.id);
      const cur = states.find(x => x.id === item.stateId);
      if (!(app.config?.convertStates ?? []).includes(cur?.name ?? "")) bad("Only awarded bids can be converted");
      const vals = (await getValues("app:bid", [item.id])).get(item.id) ?? {};
      const d = await db();
      const links: { companyId: number; role: "gc" }[] = [];
      const gcName = typeof vals.gc_name === "string" ? vals.gc_name.trim() : "";
      if (gcName) {
        const [existing] = await d.select().from(companies).where(eq(companies.name, gcName)).limit(1);
        const companyId = existing?.id ?? (await d.insert(companies).values({ name: gcName, type: "gc" }).$returningId())[0].id;
        links.push({ companyId, role: "gc" });
      }
      const caller = createCallerFactory(projectsRouter)(ctx as never);
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      const { id: projectId } = await caller.create({
        name: input.name ?? item.title,
        code: input.code ?? null,
        description: [item.description, typeof vals.scope_notes === "string" ? `Scope notes: ${vals.scope_notes}` : null].filter(Boolean).join("\n\n") || null,
        projectType: typeof vals.project_type === "string" ? vals.project_type : null,
        siteAddress: typeof vals.location === "string" ? vals.location : null,
        totalTons: num(vals.est_tons),
        contractValue: num(vals.est_value),
        budget: num(vals.est_value) * (1 - Math.min(90, num(vals.est_margin_pct)) / 100),
        startDate: input.startDate ?? null,
        deadline: input.deadline ?? null,
        state: "draft",
        template: "erection",
        sequenceCount: input.sequenceCount,
        companies: links,
      });
      const to = states.find(x => x.name === (app.config?.convertToStateName ?? "Converted"));
      if (to) await transitionItem(ctx, item.id, { toStateId: to.id, auto: true, comment: `Converted to job #${projectId}` });
      return { projectId };
    }),

  /* ---------------- Designer (admin) ---------------- */
  designer: router({
    upsertApp: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Lowercase letters, digits and _ only"),
          name: zText(128).min(1),
          pluralName: zText(128).min(1),
          numberPrefix: z.string().regex(/^[A-Z0-9]{1,10}$/, "Uppercase letters/digits, max 10"),
          description: z.string().max(2000).nullable().optional(),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          icon: zText(32),
          scope: z.enum(["project", "global"]),
          dueDateLabel: zText(64).min(1),
          scoreFormula: z.string().max(2000).nullable().optional(),
          isActive: z.boolean().optional(),
          config: z
            .object({
              costField: z.string().optional(),
              approvedField: z.string().optional(),
              scheduleField: z.string().optional(),
              convertStates: z.array(z.string()).optional(),
              convertToStateName: z.string().optional(),
            })
            .nullable()
            .optional(),
        })
      )
      .mutation(async ({ input }) => {
        if (input.scoreFormula) {
          const err = validateFormula(input.scoreFormula);
          if (err) bad(`Score formula: ${err}`);
        }
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          const { key: _k, ...upd } = rest;
          await d.update(wfApps).set(upd).where(eq(wfApps.id, id));
          return { id };
        }
        const dup = await d.select({ id: wfApps.id }).from(wfApps).where(eq(wfApps.key, rest.key)).limit(1);
        if (dup.length) bad("A log type with this key already exists");
        const [{ id: appId }] = await d.insert(wfApps).values({ ...rest, sortOrder: 100 }).$returningId();
        await d.insert(wfStates).values([
          { appId, name: "Open", category: "start", color: "#D97706", sortOrder: 0 },
          { appId, name: "Closed", category: "end", color: "#16A34A", sortOrder: 1 },
        ]);
        const st = await d.select().from(wfStates).where(eq(wfStates.appId, appId));
        await d.insert(wfTransitions).values({
          appId,
          fromStateId: st.find(s => s.name === "Open")!.id,
          toStateId: st.find(s => s.name === "Closed")!.id,
          name: "Close",
        });
        return { id: appId };
      }),

    upsertState: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          appId: zId,
          name: zText(64).min(1),
          category: z.enum(["start", "active", "end"]),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          sortOrder: z.number().int().min(0).max(1000),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const { id, ...rest } = input;
        if (id) await assertStatesInApp(rest.appId, [id]);
        if (rest.category === "start") {
          const starts = await d.select().from(wfStates).where(and(eq(wfStates.appId, rest.appId), eq(wfStates.category, "start")));
          if (starts.some(s => s.id !== id)) bad("A log type has exactly one start state");
        }
        if (id) {
          const [cur] = await d.select().from(wfStates).where(eq(wfStates.id, id)).limit(1);
          if (cur && cur.category !== rest.category && (cur.category === "start" || cur.category === "end")) {
            const same = await d.select({ id: wfStates.id }).from(wfStates).where(and(eq(wfStates.appId, rest.appId), eq(wfStates.category, cur.category)));
            if (same.filter(x => x.id !== id).length === 0) bad(`A log type needs at least one ${cur.category} state`);
          }
        }
        if (id) {
          await d.update(wfStates).set(rest).where(eq(wfStates.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(wfStates).values(rest).$returningId();
        return { id: newId };
      }),

    removeState: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      const used = await d.select({ id: wfItems.id }).from(wfItems).where(eq(wfItems.stateId, input.id)).limit(1);
      if (used.length) bad("Items are in this state; move them first");
      const [st] = await d.select().from(wfStates).where(eq(wfStates.id, input.id)).limit(1);
      if (!st) return { ok: true };
      if (st.category === "start" || st.category === "end") {
        const same = await d.select({ id: wfStates.id }).from(wfStates).where(and(eq(wfStates.appId, st.appId), eq(wfStates.category, st.category)));
        if (same.filter(x => x.id !== st.id).length === 0) bad(`A log type needs at least one ${st.category} state`);
      }
      const target = await d.select({ id: wfSlaPolicies.id }).from(wfSlaPolicies).where(eq(wfSlaPolicies.toStateId, input.id)).limit(1);
      if (target.length) bad("An SLA policy moves items to this state; change that policy first");
      await d.delete(wfTransitions).where(eq(wfTransitions.fromStateId, input.id));
      await d.delete(wfTransitions).where(eq(wfTransitions.toStateId, input.id));
      await d.delete(wfSlaPolicies).where(eq(wfSlaPolicies.stateId, input.id));
      await d.delete(wfStates).where(eq(wfStates.id, input.id));
      return { ok: true };
    }),

    upsertTransition: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          appId: zId,
          fromStateId: zId,
          toStateId: zId,
          name: zText(64).min(1),
          userAllowed: z.boolean().default(true),
        })
      )
      .mutation(async ({ input }) => {
        if (input.fromStateId === input.toStateId) bad("Pick two different states");
        await assertStatesInApp(input.appId, [input.fromStateId, input.toStateId]);
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          const [cur] = await d.select({ appId: wfTransitions.appId }).from(wfTransitions).where(eq(wfTransitions.id, id)).limit(1);
          if (!cur || cur.appId !== rest.appId) bad("Transition does not belong to this log type");
        }
        if (id) {
          await d.update(wfTransitions).set(rest).where(eq(wfTransitions.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(wfTransitions).values(rest).$returningId();
        return { id: newId };
      }),

    removeTransition: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      await d.delete(wfTransitions).where(eq(wfTransitions.id, input.id));
      return { ok: true };
    }),

    upsertPolicy: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          appId: zId,
          stateId: zId,
          priority: enumOf(PRIORITIES).nullable(),
          source: z.enum(["fixed", "project_notice", "due_date"]),
          hours: z.number().min(0.25).max(24 * 365),
          action: z.enum(["mark_delayed", "transition"]),
          toStateId: zId.nullable().optional(),
          atRiskPct: z.number().min(1).max(99).default(75),
        })
      )
      .mutation(async ({ input }) => {
        if (input.action === "transition" && !input.toStateId) bad("Choose the state to move to on timeout");
        if (input.action === "transition" && input.toStateId === input.stateId) bad("Timeout must move items to a different state");
        await assertStatesInApp(input.appId, [input.stateId, input.action === "transition" ? input.toStateId : null]);
        const d = await db();
        const { id, ...rest } = input;
        if (id) await d.update(wfSlaPolicies).set({ ...rest, toStateId: rest.toStateId ?? null }).where(eq(wfSlaPolicies.id, id));
        else await d.insert(wfSlaPolicies).values({ ...rest, toStateId: rest.toStateId ?? null });
        const items = await d.select({ id: wfItems.id }).from(wfItems).where(eq(wfItems.appId, input.appId));
        for (const it of items) await refreshItem(it.id);
        return { ok: true };
      }),

    removePolicy: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      const [p] = await d.select().from(wfSlaPolicies).where(eq(wfSlaPolicies.id, input.id)).limit(1);
      await d.delete(wfSlaPolicies).where(eq(wfSlaPolicies.id, input.id));
      if (p) {
        const items = await d.select({ id: wfItems.id }).from(wfItems).where(eq(wfItems.appId, p.appId));
        for (const it of items) await refreshItem(it.id);
      }
      return { ok: true };
    }),

    apps: adminProcedure.query(async () => {
      const d = await db();
      return d.select().from(wfApps).orderBy(asc(wfApps.sortOrder));
    }),
  }),

  /** Responsible-party companies on a job (for pre-filling logs). */
  jobCompanies: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requirePriv(ctx, "project.view", input.projectId);
    const d = await db();
    return d
      .select({ role: projectCompanies.role, companyId: companies.id, name: companies.name })
      .from(projectCompanies)
      .innerJoin(companies, eq(companies.id, projectCompanies.companyId))
      .where(eq(projectCompanies.projectId, input.projectId));
  }),

  fieldDefsFor: protectedProcedure.input(z.object({ appKey: z.string() })).query(async ({ input }) => {
    const d = await db();
    return d.select().from(customFieldDefs).where(eq(customFieldDefs.entityType, `app:${input.appKey}`)).orderBy(asc(customFieldDefs.sortOrder));
  }),
});
