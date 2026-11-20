/**
 * Model: framing read from the drawings (modules/model in SteelBuild). One read per sheet revision page holds the
 * pieces the reader found (all "needs review" until an editor accepts, fixes or rejects them), the page's grids,
 * columns, labels it couldn't place, other views it set aside, and the level / top of steel. Per-job settings hold
 * the lift allowance, base elevation and joist weights.
 *
 * The reader runs in the browser; the server validates and stores what it produced. Saves carry the identity and
 * version they were based on, so deletion/recreation and concurrent reviews cannot silently overwrite a read.
 * Viewing: project.view. Reading, reviewing and settings: project.edit (editors), as in SteelBuild.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { drawingRevisions, drawingSheets, modelJobs, modelReads, projects } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db, type Db } from "../db";
import { hasPriv, requireJobModule } from "../security/guard";
import { logActivity } from "../services/events";
import { bad, notFound, zId } from "./_util";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const num = (lo: number, hi: number) => z.number().finite().min(lo).max(hi);
const line = z.tuple([num(-1e5, 1e5), num(-1e5, 1e5), num(-1e5, 1e5), num(-1e5, 1e5)]);
const str = (max: number) => z.string().max(max);
export const PIECE_STATES = ["auto", "ok", "edit", "add", "no"] as const;

const piece = z.object({
  id: str(40).min(1),
  k: z.enum(["beam", "joist"]).default("beam"),
  mark: str(24).default(""),
  size: str(30).default(""),
  a: line,
  len: num(0, 1000).default(0),
  ends: z.array(z.array(str(40).nullable()).max(6)).max(2).default([]),
  via: z.enum(["", "leader", "hand"]).default(""),
  st: z.enum(PIECE_STATES).default("auto"),
  by: z.number().int().optional(),
  at: str(30).optional(),
  note: str(200).optional(),
});

export const readData = z.object({
  w: num(0, 1e5),
  h: num(0, 1e5),
  /** page units per foot (0: scale not found) and the scale as printed */
  ppf: num(0, 1e4).default(0),
  sl: str(40).default(""),
  lvl: str(30).default(""),
  lvlBy: z.enum(["", "read", "hand"]).default(""),
  /** top of steel, feet; null when not known (blank is not zero) */
  tos: num(-2000, 20000).nullable().default(null),
  tosBy: z.enum(["", "read", "hand"]).default(""),
  grids: z.array(z.object({ n: str(12).min(1), a: line })).max(120).default([]),
  pcs: z.array(piece).max(700).default([]),
  cols: z.array(z.object({ mark: str(24), size: str(30), x: num(-1e5, 1e5), y: num(-1e5, 1e5) })).max(300).default([]),
  left: z
    .array(z.object({ label: str(30), k: z.enum(["beam", "joist"]).default("beam"), mark: str(24), x: num(-1e5, 1e5), y: num(-1e5, 1e5), note: str(60).default("") }))
    .max(400)
    .default([]),
  aside: z.array(z.object({ label: str(30), mark: str(24), view: str(60) })).max(100).default([]),
});
export type ReadData = z.infer<typeof readData>;

export const jobData = z.object({
  /** lift allowance on bare steel, % */
  allow: num(0, 50).default(0),
  /** base elevation, feet (null: not set) */
  base: num(-2000, 20000).nullable().default(null),
  /** joist weights from the supplier's joist list: lb per piece by mark */
  jw: z.array(z.object({ mark: str(24).min(1), lb: num(0, 1e6) })).max(1000).default([]),
});

const isDup = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string }; message?: string };
  return err?.code === "ER_DUP_ENTRY" || err?.cause?.code === "ER_DUP_ENTRY" || /Duplicate entry/.test(err?.message ?? "");
};
const readConflict = () => { throw new TRPCError({ code: "CONFLICT", message: "Someone else changed this read — reload" }); };
const settingsConflict = () => { throw new TRPCError({ code: "CONFLICT", message: "Someone changed these settings meanwhile — reload and try again" }); };

/** Same lock order as Drawings, so discard/removal cannot race an artifact write. */
async function lockProject(tx: Tx, projectId: number) {
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1).for("update");
  if (!p) notFound("Job");
}

async function lockSheetRev(tx: Tx, sheetId: number, projectId: number, rev: number) {
  const [x] = await tx.select().from(drawingSheets).where(eq(drawingSheets.id, sheetId)).limit(1).for("update");
  if (!x || x.projectId !== projectId) notFound("Sheet on this job");
  const [r] = await tx.select().from(drawingRevisions).where(and(eq(drawingRevisions.sheetId, sheetId), eq(drawingRevisions.number, rev))).limit(1).for("update");
  if (!r) bad(`${x.sheetNumber} has no Rev ${rev}`);
  return x;
}

export const modelRouter = router({
  /** Every read on the job (pieces included) and the job's settings. */
  job: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const d = await db();
    const [reads, [job], canEdit] = await Promise.all([
      d.select().from(modelReads).where(eq(modelReads.projectId, input.projectId)),
      d.select().from(modelJobs).where(eq(modelJobs.projectId, input.projectId)).limit(1),
      hasPriv(ctx, "project.edit", input.projectId),
    ]);
    return {
      canEdit,
      reads: reads.map(r => ({ ...r, data: readData.parse(r.data) })),
      settings: { data: jobData.parse(job?.data ?? {}), version: job?.version ?? 0 },
    };
  }),

  /** Save only the expected read identity/version; { id: null, version: 0 } creates without overwriting. */
  saveRead: protectedProcedure
    .input(
      z.object({
        sheetId: zId,
        rev: z.number().int().min(0).max(999),
        page: z.number().int().min(1).max(500).default(1),
        readerVersion: z.number().int().min(0).max(10000).default(0),
        data: readData,
        expected: z.object({ id: zId.nullable(), version: z.number().int().min(0) }),
        /** what changed, for the sheet's history ("read framing: 42 pieces", "accepted 12 pieces") */
        summary: z.string().max(300).optional(),
        /** a fresh read replaces the page's pieces; otherwise it must be the same read being reviewed */
        fresh: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [x] = await d.select().from(drawingSheets).where(eq(drawingSheets.id, input.sheetId)).limit(1);
      if (!x) notFound("Sheet");
      await requireJobModule(ctx, x.projectId, "project.edit");
      const ids = new Set<string>();
      for (const p of input.data.pcs) {
        if (ids.has(p.id)) bad(`Piece ${p.id} is listed twice`);
        ids.add(p.id);
      }
      const now = new Date();
      const result = await d.transaction(async tx => {
        await lockProject(tx, x.projectId);
        await lockSheetRev(tx, input.sheetId, x.projectId, input.rev);
        if (input.expected.id !== null) {
          const version = input.expected.version + 1;
          const [updated] = await tx
            .update(modelReads)
            .set({
              data: input.data,
              version,
              updatedBy: ctx.user.id,
              ...(input.fresh ? { readerVersion: input.readerVersion, readBy: ctx.user.id, readAt: now } : {}),
            })
            .where(and(
              eq(modelReads.id, input.expected.id), eq(modelReads.version, input.expected.version),
              eq(modelReads.projectId, x.projectId), eq(modelReads.sheetId, input.sheetId),
              eq(modelReads.rev, input.rev), eq(modelReads.page, input.page)
            ));
          if (updated.affectedRows !== 1) readConflict();
          return { id: input.expected.id, version };
        }
        if (input.expected.version !== 0) readConflict();
        try {
          const [{ id }] = await tx.insert(modelReads).values({
            projectId: x.projectId,
            sheetId: x.id,
            rev: input.rev,
            page: input.page,
            readerVersion: input.readerVersion,
            data: input.data,
            version: 1,
            readBy: ctx.user.id,
            readAt: now,
            updatedBy: ctx.user.id,
          }).$returningId();
          return { id, version: 1 };
        } catch (e) {
          if (isDup(e)) readConflict();
          throw e;
        }
      });
      await logActivity(ctx, {
        projectId: x.projectId,
        entityType: "drawingSheet",
        entityId: x.id,
        action: "framing",
        summary: `${input.summary || (input.fresh ? `read framing of ${x.sheetNumber}` : `reviewed framing of ${x.sheetNumber}`)} · Rev ${input.rev}${input.page > 1 ? ` p${input.page}` : ""}`,
      });
      return result;
    }),

  removeRead: protectedProcedure.input(z.object({ id: zId, version: z.number().int().min(1) })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const [r] = await d.select().from(modelReads).where(eq(modelReads.id, input.id)).limit(1);
    if (!r) readConflict();
    await requireJobModule(ctx, r.projectId, "project.edit");
    await d.transaction(async tx => {
      await lockProject(tx, r.projectId);
      const [removed] = await tx.delete(modelReads).where(and(eq(modelReads.id, input.id), eq(modelReads.version, input.version), eq(modelReads.projectId, r.projectId)));
      if (removed.affectedRows !== 1) readConflict();
    });
    await logActivity(ctx, { projectId: r.projectId, entityType: "drawingSheet", entityId: r.sheetId, action: "framing", summary: `cleared the framing read of Rev ${r.rev}` });
    return { ok: true };
  }),

  saveSettings: protectedProcedure
    .input(z.object({ projectId: zId, data: jobData, expectedVersion: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.edit");
      const d = await db();
      return d.transaction(async tx => {
        await lockProject(tx, input.projectId);
        // model_jobs has no generated row ID: projectId is its stable primary-key identity.
        if (input.expectedVersion > 0) {
          const [updated] = await tx.update(modelJobs)
            .set({ data: input.data, version: input.expectedVersion + 1, updatedBy: ctx.user.id })
            .where(and(eq(modelJobs.projectId, input.projectId), eq(modelJobs.version, input.expectedVersion)));
          if (updated.affectedRows !== 1) settingsConflict();
        } else {
          try {
            await tx.insert(modelJobs).values({ projectId: input.projectId, data: input.data, version: 1, updatedBy: ctx.user.id });
          } catch (e) {
            if (isDup(e)) settingsConflict();
            throw e;
          }
        }
        return { version: input.expectedVersion + 1 };
      });
    }),
});
