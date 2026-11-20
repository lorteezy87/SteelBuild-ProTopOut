import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "@shared/domain";
import {
  activities,
  comments,
  dailyReports,
  documentVersions,
  documents,
  followers,
  notifications,
  projects,
  tasks,
  users,
  wfApps,
  wfItems,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasJobModuleAccess, requireJobModule, requirePriv, sec, visibleProjects } from "../security/guard";
import { follow, logActivity, notify, notifyFollowers, resolveMentions } from "../services/events";
import { getApp } from "../services/wf";
import { storagePut } from "../storage";
import { bad, zId, zText } from "./_util";

const entityType = z.enum(["project", "task", "logItem", "dailyReport"]);
type EntityType = z.infer<typeof entityType>;
type Ctx = Parameters<typeof requirePriv>[0];

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Resolve the owning job of a commentable record and its in-app link. */
async function resolveEntity(type: EntityType, id: number): Promise<{ projectId: number | null; link: string; title: string; isGlobalLog?: boolean }> {
  const d = await db();
  if (type === "project") {
    const [p] = await d.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
    return { projectId: p.id, link: `/jobs/${p.id}`, title: p.name };
  }
  if (type === "task") {
    const [t] = await d.select({ projectId: tasks.projectId, name: tasks.name }).from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    return { projectId: t.projectId, link: `/jobs/${t.projectId}/tasks?task=${id}`, title: t.name };
  }
  if (type === "dailyReport") {
    const [r] = await d.select({ projectId: dailyReports.projectId, date: dailyReports.reportDate }).from(dailyReports).where(eq(dailyReports.id, id)).limit(1);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Daily report not found" });
    return { projectId: r.projectId, link: `/jobs/${r.projectId}/daily/${id}`, title: `Daily report ${r.date}` };
  }
  const [i] = await d.select().from(wfItems).where(eq(wfItems.id, id)).limit(1);
  if (!i) throw new TRPCError({ code: "NOT_FOUND", message: "Log item not found" });
  const app = await getApp(i.appId);
  const label = `${app.numberPrefix}-${String(i.number).padStart(3, "0")}`;
  return {
    projectId: i.projectId,
    link: i.projectId ? `/jobs/${i.projectId}/logs/${app.key}/${i.id}` : `/bids/${i.id}`,
    title: `${label} ${i.title}`,
    isGlobalLog: app.scope === "global",
  };
}

async function assertView(ctx: Ctx, type: EntityType, id: number) {
  const e = await resolveEntity(type, id);
  if (e.isGlobalLog) await requirePriv(ctx, "bid.manage");
  else if (e.projectId) {
    if (type === "logItem") await requirePriv(ctx, "log.view", e.projectId);
    else await requireJobModule(ctx, e.projectId);
  }
  return e;
}

export const collabRouter = router({
  /* ---------------- Comments ---------------- */
  comments: protectedProcedure.input(z.object({ entityType, entityId: zId })).query(async ({ ctx, input }) => {
    await assertView(ctx, input.entityType, input.entityId);
    const d = await db();
    const rows = await d
      .select({ c: comments, userName: users.name })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(and(eq(comments.entityType, input.entityType), eq(comments.entityId, input.entityId)))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    return rows.map(r => ({ ...r.c, userName: r.userName, mine: r.c.userId === ctx.user.id }));
  }),

  addComment: protectedProcedure
    .input(z.object({ entityType, entityId: zId, body: z.string().trim().min(1).max(10000) }))
    .mutation(async ({ ctx, input }) => {
      const e = await assertView(ctx, input.entityType, input.entityId);
      if (e.isGlobalLog) await requirePriv(ctx, "bid.manage");
      else if (e.projectId) await requirePriv(ctx, "comment.create", e.projectId);
      const d = await db();
      const [{ id }] = await d
        .insert(comments)
        .values({ entityType: input.entityType, entityId: input.entityId, projectId: e.projectId, userId: ctx.user.id, body: input.body })
        .$returningId();
      await follow(input.entityType, input.entityId, ctx.user.id);
      const mentioned = await resolveMentions(input.body);
      for (const m of mentioned) await follow(input.entityType, input.entityId, m);
      const who = ctx.user.name ?? "Someone";
      await notify(ctx, mentioned, { title: `${who} mentioned you on ${e.title}`, body: input.body.slice(0, 300), link: e.link });
      await notifyFollowers(
        ctx,
        input.entityType,
        input.entityId,
        { title: `${who} commented on ${e.title}`, body: input.body.slice(0, 300), link: e.link },
        []
      );
      await logActivity(ctx, { projectId: e.projectId, entityType: input.entityType, entityId: input.entityId, action: "comment", summary: `commented on ${e.title}` });
      return { id };
    }),

  removeComment: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const [c] = await d.select().from(comments).where(eq(comments.id, input.id)).limit(1);
    if (!c) bad("Comment not found");
    if (c.userId !== ctx.user.id && ctx.user.role !== "admin") bad("You can delete only your own comments");
    await assertView(ctx, c.entityType as EntityType, c.entityId);
    await d.delete(comments).where(eq(comments.id, input.id));
    return { ok: true };
  }),

  /* ---------------- Followers ---------------- */
  followState: protectedProcedure.input(z.object({ entityType, entityId: zId })).query(async ({ ctx, input }) => {
    await assertView(ctx, input.entityType, input.entityId);
    const d = await db();
    const rows = await d
      .select({ userId: followers.userId, name: users.name })
      .from(followers)
      .leftJoin(users, eq(users.id, followers.userId))
      .where(and(eq(followers.entityType, input.entityType), eq(followers.entityId, input.entityId)));
    return { following: rows.some(r => r.userId === ctx.user.id), followers: rows.map(r => ({ userId: r.userId, name: r.name })) };
  }),

  setFollow: protectedProcedure
    .input(z.object({ entityType, entityId: zId, follow: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertView(ctx, input.entityType, input.entityId);
      const d = await db();
      if (input.follow) await follow(input.entityType, input.entityId, ctx.user.id);
      else
        await d
          .delete(followers)
          .where(and(eq(followers.entityType, input.entityType), eq(followers.entityId, input.entityId), eq(followers.userId, ctx.user.id)));
      return { ok: true };
    }),

  /* ---------------- Notifications ---------------- */
  notifications: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const d = await db();
      const conds = [eq(notifications.userId, ctx.user.id)];
      if (input.unreadOnly) conds.push(eq(notifications.isRead, false));
      const rows = await d.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(input.limit);
      const [{ n }] = await d
        .select({ n: sql<number>`count(*)` })
        .from(notifications)
        .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.isRead, false)));
      return { items: rows, unread: Number(n) };
    }),

  markRead: protectedProcedure.input(z.object({ ids: z.array(zId).max(500).optional() })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const conds = [eq(notifications.userId, ctx.user.id)];
    if (input.ids?.length) conds.push(inArray(notifications.id, input.ids));
    await d.update(notifications).set({ isRead: true }).where(and(...conds));
    return { ok: true };
  }),

  /* ---------------- Activity ---------------- */
  activity: protectedProcedure
    .input(z.object({ projectId: zId.optional(), limit: z.number().int().min(1).max(200).default(60) }))
    .query(async ({ ctx, input }) => {
      const d = await db();
      let ids: number[];
      if (!hasJobModuleAccess(await sec(ctx))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your access type only includes Logs and Timesheets" });
      }
      if (input.projectId) {
        await requireJobModule(ctx, input.projectId);
        ids = [input.projectId];
      } else {
        ids = await visibleProjects(ctx);
      }
      if (!ids.length) return [];
      const rows = await d
        .select({ a: activities, userName: users.name, projectCode: projects.code, projectName: projects.name, appKey: wfApps.key })
        .from(activities)
        .leftJoin(users, eq(users.id, activities.userId))
        .leftJoin(projects, eq(projects.id, activities.projectId))
        .leftJoin(wfItems, and(eq(activities.entityType, "logItem"), eq(wfItems.id, activities.entityId), eq(wfItems.projectId, activities.projectId)))
        .leftJoin(wfApps, eq(wfApps.id, wfItems.appId))
        .where(inArray(activities.projectId, ids))
        .orderBy(desc(activities.createdAt), desc(activities.id))
        .limit(input.limit);
      return rows.map(r => ({ ...r.a, userName: r.userName, projectCode: r.projectCode, projectName: r.projectName, appKey: r.appKey }));
    }),

  /* ---------------- Documents ---------------- */
  documents: protectedProcedure
    .input(z.object({ projectId: zId, category: z.string().optional(), entityType: z.string().optional(), entityId: zId.optional() }))
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      const conds = [eq(documents.projectId, input.projectId), eq(documents.isDeleted, false)];
      if (input.category) conds.push(eq(documents.category, input.category));
      if (input.entityType && input.entityId) {
        conds.push(eq(documents.entityType, input.entityType), eq(documents.entityId, input.entityId));
      }
      const docs = await d.select().from(documents).where(and(...conds)).orderBy(asc(documents.category), asc(documents.sheetNumber), asc(documents.name));
      const ids = docs.map(x => x.id);
      const versions = ids.length
        ? await d
            .select({ v: documentVersions, uploader: users.name })
            .from(documentVersions)
            .leftJoin(users, eq(users.id, documentVersions.uploadedBy))
            .where(inArray(documentVersions.documentId, ids))
            .orderBy(desc(documentVersions.uploadedAt), desc(documentVersions.id))
        : [];
      return docs.map(doc => {
        const vs = versions.filter(v => v.v.documentId === doc.id).map(v => ({ ...v.v, uploaderName: v.uploader }));
        return { ...doc, latest: vs[0] ?? null, versions: vs };
      });
    }),

  /** Upload a new document, or a new revision of an existing one (older revisions are kept). */
  upload: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        documentId: zId.optional(),
        name: zText(255).min(1).optional(),
        category: z.enum(Object.keys(DOCUMENT_CATEGORIES) as [string, ...string[]]).optional(),
        sheetNumber: zText(64).nullable().optional(),
        revision: zText(16).min(1),
        notes: zText(500).nullable().optional(),
        entityType: z.enum(["task", "logItem", "dailyReport", "delivery"]).optional(),
        entityId: zId.optional(),
        file: z.object({ fileName: zText(255).min(1), mimeType: zText(128), base64: z.string().min(1) }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "document.upload");
      const buf = Buffer.from(input.file.base64, "base64");
      if (buf.length > MAX_FILE_BYTES) bad("File is larger than 25 MB");
      const d = await db();
      let docId = input.documentId;
      if (docId) {
        const [doc] = await d.select().from(documents).where(eq(documents.id, docId)).limit(1);
        if (!doc || doc.projectId !== input.projectId) bad("Document not found on this job");
        const dup = await d
          .select({ id: documentVersions.id })
          .from(documentVersions)
          .where(and(eq(documentVersions.documentId, docId), eq(documentVersions.revision, input.revision)))
          .limit(1);
        if (dup.length) bad(`Revision ${input.revision} already exists — use the next revision`);
      } else {
        if (!input.name) bad("Enter a document name");
        [{ id: docId }] = await d
          .insert(documents)
          .values({
            projectId: input.projectId,
            name: input.name!,
            category: input.category ?? "other",
            sheetNumber: input.sheetNumber ?? null,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            currentRevision: input.revision,
            createdBy: ctx.user.id,
          })
          .$returningId();
      }
      const safe = input.file.fileName.replace(/[^\w.-]+/g, "_");
      const put = await storagePut(`documents/${input.projectId}/${docId}/${Date.now()}_${safe}`, buf, input.file.mimeType);
      await d.insert(documentVersions).values({
        documentId: docId!,
        revision: input.revision,
        fileKey: put.key,
        url: put.url,
        fileName: input.file.fileName,
        size: buf.length,
        mimeType: input.file.mimeType,
        notes: input.notes ?? null,
        uploadedBy: ctx.user.id,
      });
      await d
        .update(documents)
        .set({
          currentRevision: input.revision,
          ...(input.sheetNumber !== undefined ? { sheetNumber: input.sheetNumber } : {}),
          ...(input.category ? { category: input.category } : {}),
        })
        .where(eq(documents.id, docId!));
      await logActivity(ctx, {
        projectId: input.projectId,
        entityType: "document",
        entityId: docId!,
        action: input.documentId ? "revision" : "upload",
        summary: `${input.documentId ? "uploaded revision" : "uploaded"} ${input.name ?? input.file.fileName} rev ${input.revision}`,
      });
      return { id: docId! };
    }),

  updateDocument: protectedProcedure
    .input(
      z.object({
        id: zId,
        name: zText(255).min(1).optional(),
        category: z.enum(Object.keys(DOCUMENT_CATEGORIES) as [string, ...string[]]).optional(),
        sheetNumber: zText(64).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [doc] = await d.select().from(documents).where(eq(documents.id, input.id)).limit(1);
      if (!doc) bad("Document not found");
      await requireJobModule(ctx, doc.projectId, "document.upload");
      const { id, ...rest } = input;
      const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length) await d.update(documents).set(set).where(eq(documents.id, id));
      return { ok: true };
    }),

  removeDocument: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const [doc] = await d.select().from(documents).where(eq(documents.id, input.id)).limit(1);
    if (!doc) bad("Document not found");
    await requireJobModule(ctx, doc.projectId, "document.upload");
    await d.update(documents).set({ isDeleted: true }).where(eq(documents.id, input.id));
    await logActivity(ctx, { projectId: doc.projectId, entityType: "document", entityId: doc.id, action: "delete", summary: `removed document ${doc.name}` });
    return { ok: true };
  }),
});
