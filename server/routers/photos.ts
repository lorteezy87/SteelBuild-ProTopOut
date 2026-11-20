import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { PHOTO_ENTITY_TYPES, isPhoto, photoDay, photosForRecord, type PhotoEntity } from "@shared/photos";
import { dailyReports, documentVersions, documents, photoLinks, tasks, tmTickets, wfItems } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { getSetting } from "../bootstrap";
import { requireJobModule } from "../security/guard";
import { bad, defined, zDayOpt, zId, zText } from "./_util";

const zEntity = z.enum(PHOTO_ENTITY_TYPES);

/** The calendar day a timestamp falls on in the org's time zone. */
async function dayFn() {
  const org = await getSetting<{ timezone?: string }>("org", {});
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: org.timezone || "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" });
  return (d: Date) => f.format(d);
}

/** The record must exist on this job. */
export async function assertPhotoEntity(projectId: number, entityType: PhotoEntity, entityId: number) {
  const d = await db();
  const t = { dailyReport: dailyReports, logItem: wfItems, tmTicket: tmTickets }[entityType];
  const [row] = await d.select({ projectId: t.projectId }).from(t).where(eq(t.id, entityId)).limit(1);
  if (!row || row.projectId !== projectId) bad("That record isn't on this job");
}

async function assertSequence(projectId: number, taskId: number | null | undefined) {
  if (taskId == null) return;
  const d = await db();
  const [t] = await d.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || t.projectId !== projectId) bad("Pick a sequence on this job");
}

const docIsPhoto = (_category: string, mime: string | null, fileName: string) => isPhoto(mime, fileName);

/** Photos on a job: every image document (whatever it was uploaded to), with its latest file. */
export async function jobPhotos(projectId: number) {
  const d = await db();
  const docs = await d.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.isDeleted, false)));
  if (!docs.length) return [];
  const versions = await d
    .select()
    .from(documentVersions)
    .where(inArray(documentVersions.documentId, docs.map(x => x.id)))
    .orderBy(desc(documentVersions.id));
  const links = await d.select().from(photoLinks).where(inArray(photoLinks.documentId, docs.map(x => x.id)));
  const toDay = await dayFn();
  return docs
    .map(doc => ({ doc, v: versions.find(v => v.documentId === doc.id) }))
    .filter((x): x is { doc: typeof x.doc; v: NonNullable<typeof x.v> } => !!x.v && (docIsPhoto(x.doc.category, x.v.mimeType, x.v.fileName) || isPhoto(null, x.doc.name)))
    .map(({ doc, v }) => {
      const uploadedDay = toDay(v.uploadedAt);
      const { day, estimated } = photoDay({ takenOn: doc.takenOn, uploadedDay });
      return {
        id: doc.id,
        name: doc.name,
        caption: doc.caption,
        takenOn: doc.takenOn,
        uploadedDay,
        day,
        estimated,
        sequenceTaskId: doc.sequenceTaskId,
        url: v.url,
        fileName: v.fileName,
        owner: doc.entityType && doc.entityId ? { entityType: doc.entityType, entityId: doc.entityId } : null,
        links: links.filter(l => l.documentId === doc.id).map(l => ({ entityType: l.entityType, entityId: l.entityId })),
      };
    });
}

export const photosRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        sequenceTaskId: zId.optional(),
        from: zDayOpt,
        to: zDayOpt,
        entityType: zEntity.optional(),
        entityId: zId.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      let rows = await jobPhotos(input.projectId);
      if (input.entityType && input.entityId) {
        const owned = rows.filter(r => r.owner?.entityType === input.entityType && r.owner?.entityId === input.entityId).map(r => r.id);
        const linked = rows.filter(r => r.links.some(l => l.entityType === input.entityType && l.entityId === input.entityId)).map(r => r.id);
        const ids = photosForRecord(owned, linked);
        rows = ids.map(id => rows.find(r => r.id === id)!);
      }
      if (input.sequenceTaskId) rows = rows.filter(r => r.sequenceTaskId === input.sequenceTaskId);
      if (input.from) rows = rows.filter(r => r.day >= input.from!);
      if (input.to) rows = rows.filter(r => r.day <= input.to!);
      return rows.sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id);
    }),

  update: protectedProcedure
    .input(z.object({ id: zId, caption: zText(500).nullable().optional(), takenOn: zDayOpt, sequenceTaskId: zId.nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [doc] = await d.select().from(documents).where(eq(documents.id, input.id)).limit(1);
      if (!doc) bad("Photo not found");
      await requireJobModule(ctx, doc.projectId, "document.upload");
      await assertSequence(doc.projectId, input.sequenceTaskId);
      const { id, ...rest } = input;
      const set = defined(rest);
      if (Object.keys(set).length) await d.update(documents).set(set).where(eq(documents.id, id));
      return { ok: true };
    }),

  /** Attach photos already in the log to a daily report, log item or T&M ticket. Repeats are ignored. */
  attach: protectedProcedure
    .input(z.object({ projectId: zId, documentIds: z.array(zId).min(1).max(100), entityType: zEntity, entityId: zId }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "document.upload");
      await assertPhotoEntity(input.projectId, input.entityType, input.entityId);
      const d = await db();
      const docs = await d.select({ id: documents.id, projectId: documents.projectId }).from(documents).where(inArray(documents.id, input.documentIds));
      if (docs.length !== new Set(input.documentIds).size || docs.some(x => x.projectId !== input.projectId)) bad("Pick photos on this job");
      await d
        .insert(photoLinks)
        .values(docs.map(x => ({ documentId: x.id, entityType: input.entityType, entityId: input.entityId })))
        .onDuplicateKeyUpdate({ set: { entityId: input.entityId } });
      return { ok: true };
    }),

  detach: protectedProcedure
    .input(z.object({ documentId: zId, entityType: zEntity, entityId: zId }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [doc] = await d.select({ projectId: documents.projectId }).from(documents).where(eq(documents.id, input.documentId)).limit(1);
      if (!doc) bad("Photo not found");
      await requireJobModule(ctx, doc.projectId, "document.upload");
      await d
        .delete(photoLinks)
        .where(and(eq(photoLinks.documentId, input.documentId), eq(photoLinks.entityType, input.entityType), eq(photoLinks.entityId, input.entityId)));
      return { ok: true };
    }),
});
