import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_MARKUP, TM_KIND_KEYS, assertTicketEditable, linesFromDailyReport, ticketLabel, ticketTotals, unpricedLines, type TmKind, type TmLine } from "@shared/tm";
import {
  dailyReportCrew,
  dailyReportEquipment,
  dailyReports,
  equipment,
  jobRoles,
  timeCodes,
  tmTicketLines,
  tmTickets,
  users,
  wfApps,
  wfItems,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule } from "../security/guard";
import { logActivity } from "../services/events";
import { rateFor } from "../services/rates";
import { itemLabel } from "../services/wf";
import { storagePut } from "../storage";
import { bad, getProjectOr404, zDay, zId, zText } from "./_util";

const MAX_SIGNATURE_BYTES = 300 * 1024;
const affected = (res: unknown) => Number((res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
const isDup = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string }; message?: string };
  return err?.code === "ER_DUP_ENTRY" || err?.cause?.code === "ER_DUP_ENTRY" || /Duplicate entry/.test(err?.message ?? "");
};
const guard = (status: string) => {
  try {
    assertTicketEditable(status);
  } catch (e) {
    bad(e instanceof Error ? e.message : String(e));
  }
};

const line = z.object({
  kind: z.enum(TM_KIND_KEYS as [TmKind, ...TmKind[]]),
  description: zText(300).min(1),
  qty: z.number().min(0).max(100000),
  unit: zText(16).min(1),
  rate: z.number().min(0).max(1_000_000),
  otQty: z.number().min(0).max(100000).nullable().optional(),
  otRate: z.number().min(0).max(1_000_000).nullable().optional(),
});
const markup = z.object({ labor: z.number().min(0).max(100), equipment: z.number().min(0).max(100), material: z.number().min(0).max(100) });

async function ticketOr404(id: number) {
  const d = await db();
  const [t] = await d.select().from(tmTickets).where(eq(tmTickets.id, id)).limit(1);
  if (!t) bad("Ticket not found");
  return t;
}
async function assertCo(projectId: number, coItemId: number | null | undefined) {
  if (!coItemId) return;
  const d = await db();
  const [x] = await d
    .select({ projectId: wfItems.projectId, key: wfApps.key })
    .from(wfItems)
    .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
    .where(eq(wfItems.id, coItemId))
    .limit(1);
  if (!x || x.key !== "co" || x.projectId !== projectId) bad("Link a change order on this job");
}

/** Lines a finalized daily report prices out to: crew at bill rate (OT at the Overtime code's multiplier), equipment operating + standby. */
async function prefillFrom(reportId: number, projectId: number): Promise<TmLine[]> {
  const d = await db();
  const [r] = await d.select().from(dailyReports).where(eq(dailyReports.id, reportId)).limit(1);
  if (!r || r.projectId !== projectId) bad("Daily report not found on this job");
  if (r.status !== "final") bad("Finalize the daily report first");
  const [crew, eq_, codes] = await Promise.all([
    d.select().from(dailyReportCrew).where(eq(dailyReportCrew.reportId, r.id)),
    d.select({ line: dailyReportEquipment, e: equipment }).from(dailyReportEquipment).innerJoin(equipment, eq(equipment.id, dailyReportEquipment.equipmentId)).where(eq(dailyReportEquipment.reportId, r.id)),
    d.select().from(timeCodes),
  ]);
  const ot = codes.find(c => c.name.toLowerCase().startsWith("overtime"));
  const otMultiplier = ot?.multiplier ?? 1.5;
  const ids = crew.map(c => c.userId).filter((x): x is number => !!x);
  const people = ids.length ? await d.select({ id: users.id, name: users.name, jobRoleId: users.jobRoleId }).from(users).where(inArray(users.id, ids)) : [];
  const roleIds = Array.from(new Set([...crew.map(c => c.jobRoleId), ...people.map(p => p.jobRoleId)].filter((x): x is number => !!x)));
  const roles = roleIds.length ? await d.select().from(jobRoles).where(inArray(jobRoles.id, roleIds)) : [];
  const crewIn = [];
  for (const c of crew) {
    const person = people.find(p => p.id === c.userId);
    const roleId = c.jobRoleId ?? person?.jobRoleId ?? null;
    const role = roles.find(x => x.id === roleId);
    const bill = c.userId ? (await rateFor(c.userId)).bill : role?.billRate ?? 0;
    crewIn.push({ name: person?.name ?? c.workerName ?? "Crew", classification: role?.name ?? null, stHours: c.stHours, otHours: c.otHours, billRate: bill, otMultiplier });
  }
  return linesFromDailyReport({
    crew: crewIn,
    equipment: eq_.map(x => ({ name: x.e.name, operatingHours: x.line.operatingHours, standbyHours: x.line.standbyHours, hourlyRate: x.e.hourlyRate, standbyRate: x.e.standbyRate })),
  });
}

async function view(id: number) {
  const d = await db();
  const t = await ticketOr404(id);
  const lines = await d.select().from(tmTicketLines).where(eq(tmTicketLines.ticketId, id)).orderBy(asc(tmTicketLines.sortOrder), asc(tmTicketLines.id));
  const [co] = t.coItemId
    ? await d.select({ item: wfItems, prefix: wfApps.numberPrefix }).from(wfItems).innerJoin(wfApps, eq(wfApps.id, wfItems.appId)).where(eq(wfItems.id, t.coItemId)).limit(1)
    : [];
  const typed = lines.map(l => ({ ...l, kind: l.kind as TmKind }));
  return {
    ticket: { ...t, label: ticketLabel(t.number) },
    lines: typed,
    totals: ticketTotals(typed, t.markup ?? DEFAULT_MARKUP),
    co: co ? { id: co.item.id, label: `${itemLabel({ numberPrefix: co.prefix }, co.item)} · ${co.item.title}` } : null,
  };
}

/** T&M / extra-work tickets: numbered per job, priced, signed on screen by the GC's super, then locked. */
export const tmRouter = router({
  list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId, "project.view");
    const d = await db();
    const rows = await d.select().from(tmTickets).where(eq(tmTickets.projectId, input.projectId)).orderBy(desc(tmTickets.number));
    const ids = rows.map(r => r.id);
    const lines = ids.length ? await d.select().from(tmTicketLines).where(inArray(tmTicketLines.ticketId, ids)) : [];
    return rows.map(r => ({
      ...r,
      label: ticketLabel(r.number),
      total: ticketTotals(lines.filter(l => l.ticketId === r.id).map(l => ({ ...l, kind: l.kind as TmKind })), r.markup ?? DEFAULT_MARKUP).grandTotal,
    }));
  }),

  get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
    const t = await ticketOr404(input.id);
    await requireJobModule(ctx, t.projectId, "project.view");
    return view(t.id);
  }),

  /** Change orders on the job, for the link picker. */
  changeOrders: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId, "project.view");
    const d = await db();
    const rows = await d
      .select({ item: wfItems, prefix: wfApps.numberPrefix })
      .from(wfItems)
      .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
      .where(and(eq(wfApps.key, "co"), eq(wfItems.projectId, input.projectId)))
      .orderBy(desc(wfItems.number));
    return rows.map(r => ({ id: r.item.id, label: `${itemLabel({ numberPrefix: r.prefix }, r.item)} · ${r.item.title}` }));
  }),

  create: protectedProcedure
    .input(z.object({ projectId: zId, ticketDate: zDay, description: z.string().max(5000).nullable().optional(), coItemId: zId.nullable().optional(), fromDailyReportId: zId.nullable().optional(), markup: markup.optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "dailyreport.create");
      await getProjectOr404(input.projectId);
      await assertCo(input.projectId, input.coItemId);
      const lines = input.fromDailyReportId ? await prefillFrom(input.fromDailyReportId, input.projectId) : [];
      const d = await db();
      // Next number per job; the unique (projectId, number) index settles a race, and we retry once.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const id = await d.transaction(async tx => {
            const [{ n }] = await tx.select({ n: max(tmTickets.number) }).from(tmTickets).where(eq(tmTickets.projectId, input.projectId));
            const [{ id }] = await tx
              .insert(tmTickets)
              .values({
                projectId: input.projectId,
                number: (n ?? 0) + 1,
                ticketDate: input.ticketDate,
                description: input.description ?? null,
                coItemId: input.coItemId ?? null,
                dailyReportId: input.fromDailyReportId ?? null,
                markup: input.markup ?? DEFAULT_MARKUP,
                createdBy: ctx.user.id,
              })
              .$returningId();
            if (lines.length) await tx.insert(tmTicketLines).values(lines.map((l, i) => ({ ...l, otQty: l.otQty ?? null, otRate: l.otRate ?? null, ticketId: id, sortOrder: i })));
            return id;
          });
          const v = await view(id);
          await logActivity(ctx, { projectId: input.projectId, entityType: "tmTicket", entityId: id, action: "create", summary: `created ${v.ticket.label}` });
          return { id };
        } catch (e) {
          if (!isDup(e) || attempt === 1) throw e;
        }
      }
      bad("Couldn't number the ticket — try again");
    }),

  update: protectedProcedure
    .input(z.object({ id: zId, ticketDate: zDay.optional(), description: z.string().max(5000).nullable().optional(), coItemId: zId.nullable().optional(), markup: markup.optional(), lines: z.array(line).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const t = await ticketOr404(input.id);
      await requireJobModule(ctx, t.projectId, "dailyreport.create");
      guard(t.status);
      await assertCo(t.projectId, input.coItemId);
      const d = await db();
      await d.transaction(async tx => {
        // Re-check inside the transaction: a signature that landed meanwhile wins.
        const [cur] = await tx.select({ status: tmTickets.status }).from(tmTickets).where(eq(tmTickets.id, t.id)).limit(1).for("update");
        guard(cur?.status ?? "void");
        const set: Record<string, unknown> = {};
        if (input.ticketDate !== undefined) set.ticketDate = input.ticketDate;
        if (input.description !== undefined) set.description = input.description;
        if (input.coItemId !== undefined) set.coItemId = input.coItemId;
        if (input.markup !== undefined) set.markup = input.markup;
        if (Object.keys(set).length) await tx.update(tmTickets).set(set).where(eq(tmTickets.id, t.id));
        if (input.lines) {
          await tx.delete(tmTicketLines).where(eq(tmTicketLines.ticketId, t.id));
          if (input.lines.length)
            await tx.insert(tmTicketLines).values(input.lines.map((l, i) => ({ ...l, otQty: l.otQty ?? null, otRate: l.otRate ?? null, ticketId: t.id, sortOrder: i })));
        }
      });
      return view(t.id);
    }),

  sign: protectedProcedure
    .input(z.object({ id: zId, signedName: zText(120).min(2), signedTitle: zText(120).nullable().optional(), signaturePng: z.string().max(Math.ceil(MAX_SIGNATURE_BYTES * 1.37) + 64) }))
    .mutation(async ({ ctx, input }) => {
      const t = await ticketOr404(input.id);
      await requireJobModule(ctx, t.projectId, "dailyreport.create");
      guard(t.status);
      const d = await db();
      const lines = await d.select({ id: tmTicketLines.id }).from(tmTicketLines).where(eq(tmTicketLines.ticketId, t.id)).limit(1);
      if (!lines.length) bad("Add at least one line before signing");
      const all = await d.select().from(tmTicketLines).where(eq(tmTicketLines.ticketId, t.id));
      const unpriced = unpricedLines(all.map(l => ({ ...l, kind: l.kind as TmKind })));
      if (unpriced.length) bad(`Enter a rate before signing: ${unpriced.join(", ")}`);
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signaturePng);
      if (!m) bad("Signature must be a PNG drawing");
      const bytes = Buffer.from(m[1], "base64");
      if (bytes.length < 100) bad("Draw the signature first");
      if (bytes.length > MAX_SIGNATURE_BYTES) bad("Signature image is too large");
      const { key } = await storagePut(`tm/${t.projectId}/${t.id}-signature.png`, bytes, "image/png");
      const res = await d
        .update(tmTickets)
        .set({ status: "signed", signedName: input.signedName.trim(), signedTitle: input.signedTitle?.trim() || null, signedAt: new Date(), signatureKey: key })
        .where(and(eq(tmTickets.id, t.id), eq(tmTickets.status, "draft")));
      if (affected(res) !== 1) bad("This ticket was already signed or voided");
      await logActivity(ctx, { projectId: t.projectId, entityType: "tmTicket", entityId: t.id, action: "sign", summary: `${ticketLabel(t.number)} signed by ${input.signedName.trim()}` });
      return view(t.id);
    }),

  void: protectedProcedure.input(z.object({ id: zId, reason: zText(500).min(3) })).mutation(async ({ ctx, input }) => {
    const t = await ticketOr404(input.id);
    await requireJobModule(ctx, t.projectId, "dailyreport.create");
    if (t.status === "void") bad("Ticket is already void");
    const d = await db();
    await d.update(tmTickets).set({ status: "void", voidReason: input.reason }).where(eq(tmTickets.id, t.id));
    await logActivity(ctx, { projectId: t.projectId, entityType: "tmTicket", entityId: t.id, action: "void", summary: `voided ${ticketLabel(t.number)}: ${input.reason}` });
    return view(t.id);
  }),
});
