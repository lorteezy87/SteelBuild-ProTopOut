import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "@shared/domain";
import {
  activities,
  dailyReports,
  documentVersions,
  documents,
  projects,
  tasks,
  users,
  wfApps,
  wfItems,
} from "../../drizzle/schema";
import { assertPhotoEntity } from "./photos";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasJobModuleAccess, requireJobModule, requirePriv, sec, visibleProjects } from "../security/guard";
import { follow, logActivity, notify, notifyFollowers } from "../services/events";
import { getApp } from "../services/wf";
import { storagePut } from "../storage";
import { bad, zDay, zId, zText } from "./_util";

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
        entityType: z.enum(["task", "logItem", "dailyReport", "delivery", "tmTicket"]).optional(),
        entityId: zId.optional(),
        /** Photo log fields (Phase 3). */
        caption: zText(500).nullable().optional(),
        takenOn: zDay.nullable().optional(),
        sequenceTaskId: zId.nullable().optional(),
        file: z.object({ fileName: zText(255).min(1), mimeType: zText(128), base64: z.string().min(1) }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "document.upload");
      if (input.entityType === "tmTicket" && input.entityId) await assertPhotoEntity(input.projectId, "tmTicket", input.entityId);
      if (input.sequenceTaskId) {
        const [t] = await (await db()).select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, input.sequenceTaskId)).limit(1);
        if (!t || t.projectId !== input.projectId) bad("Pick a sequence on this job");
      }
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
            caption: input.caption ?? null,
            takenOn: input.takenOn ?? null,
            sequenceTaskId: input.sequenceTaskId ?? null,
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
