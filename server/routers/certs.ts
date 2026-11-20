import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { CERT_TYPE_KEYS, certStatus } from "@shared/certs";
import { certifications, jobRoles, users } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { orgToday } from "../services/calendars";
import { storagePut } from "../storage";
import { bad, defined, partialFields, zDayOpt, zId, zText } from "./_util";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const fields = {
  certType: z.enum(CERT_TYPE_KEYS as [string, ...string[]]),
  certNumber: zText(64).nullable().optional(),
  issuer: zText(120).nullable().optional(),
  issuedOn: zDayOpt,
  expiresOn: zDayOpt,
  notes: zText(500).nullable().optional(),
};

async function certOr404(id: number) {
  const d = await db();
  const [c] = await d.select().from(certifications).where(eq(certifications.id, id)).limit(1);
  if (!c) bad("Certification not found");
  return c;
}

/** Certifications belong to crew members (people records), not jobs. Only the owner signs in. */
export const certsRouter = router({
  list: protectedProcedure.input(z.object({ userId: zId.optional() }).optional()).query(async ({ input }) => {
    const d = await db();
    const today = await orgToday();
    const rows = await d
      .select({ c: certifications, userName: users.name })
      .from(certifications)
      .innerJoin(users, eq(users.id, certifications.userId))
      .where(input?.userId ? eq(certifications.userId, input.userId) : undefined)
      .orderBy(asc(users.name), asc(certifications.certType));
    return rows.map(r => ({ ...r.c, userName: r.userName, status: certStatus(r.c, today) }));
  }),

  create: protectedProcedure.input(z.object({ userId: zId, ...fields })).mutation(async ({ input }) => {
    const d = await db();
    const [u] = await d.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!u) bad("Crew member not found");
    const [{ id }] = await d
      .insert(certifications)
      .values({ ...input, certNumber: input.certNumber ?? null, issuer: input.issuer ?? null, issuedOn: input.issuedOn ?? null, expiresOn: input.expiresOn ?? null, notes: input.notes ?? null })
      .$returningId();
    return { id };
  }),

  update: protectedProcedure
    .input(z.object({ id: zId, ...partialFields(fields) }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      await certOr404(id);
      const set = defined(rest);
      const d = await db();
      if (Object.keys(set).length) await d.update(certifications).set(set).where(eq(certifications.id, id));
      return { ok: true };
    }),

  remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
    await certOr404(input.id);
    const d = await db();
    await d.delete(certifications).where(eq(certifications.id, input.id));
    return { ok: true };
  }),

  /** Attach a scan or photo of the card. */
  upload: protectedProcedure
    .input(z.object({ id: zId, file: z.object({ fileName: zText(255).min(1), mimeType: zText(128), base64: z.string().min(1) }) }))
    .mutation(async ({ input }) => {
      const c = await certOr404(input.id);
      const buf = Buffer.from(input.file.base64, "base64");
      if (buf.length > MAX_FILE_BYTES) bad("File is larger than 25 MB");
      const safe = input.file.fileName.replace(/[^\w.-]+/g, "_");
      const put = await storagePut(`certs/${c.userId}/${c.id}/${Date.now()}_${safe}`, buf, input.file.mimeType);
      const d = await db();
      await d.update(certifications).set({ fileKey: put.key, fileUrl: put.url, fileName: input.file.fileName }).where(eq(certifications.id, c.id));
      return { url: put.url };
    }),

  /** Crew × certification grid for active crew. With several cards of one type, the latest expiry counts. */
  matrix: protectedProcedure.query(async () => {
    const d = await db();
    const today = await orgToday();
    const [crew, roles, certs] = await Promise.all([
      d.select({ id: users.id, name: users.name, jobRoleId: users.jobRoleId }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name)),
      d.select({ id: jobRoles.id, name: jobRoles.name, requiredCerts: jobRoles.requiredCerts }).from(jobRoles),
      d.select().from(certifications),
    ]);
    const cells: Record<string, { status: ReturnType<typeof certStatus> | "missing"; expiresOn: string | null; required: boolean }> = {};
    const better = (a: string | null, b: string | null) => (a == null ? b : b == null ? a : a > b ? a : b);
    for (const u of crew) {
      const role = roles.find(r => r.id === u.jobRoleId);
      const required = new Set(role?.requiredCerts ?? []);
      for (const type of CERT_TYPE_KEYS) {
        const mine = certs.filter(c => c.userId === u.id && c.certType === type);
        if (!mine.length) {
          if (required.has(type)) cells[`${u.id}:${type}`] = { status: "missing", expiresOn: null, required: true };
          continue;
        }
        // Prefer a card with a date over one without; among dated cards, the latest.
        const dated = mine.filter(c => c.expiresOn != null);
        const expiresOn = dated.length ? dated.map(c => c.expiresOn).reduce(better, null) : null;
        cells[`${u.id}:${type}`] = { status: certStatus({ certType: type, expiresOn }, today), expiresOn, required: required.has(type) };
      }
    }
    return {
      today,
      users: crew.map(u => ({ id: u.id, name: u.name, classification: roles.find(r => r.id === u.jobRoleId)?.name ?? null })),
      types: CERT_TYPE_KEYS,
      cells,
    };
  }),
});
