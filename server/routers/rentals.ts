import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { callOffStatus, rentalCost, standbyDays } from "@shared/rentals";
import { companies, dailyReportEquipment, dailyReports, equipment, equipmentRentals } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasPriv, requireJobModule } from "../security/guard";
import { orgToday } from "../services/calendars";
import { logActivity } from "../services/events";
import { bad, defined, zDay, zDayOpt, zId, zText } from "./_util";

const money = z.number().min(0).max(10_000_000).nullable().optional();
const fields = {
  equipmentId: zId.nullable().optional(),
  description: zText(200).min(1),
  vendorCompanyId: zId.nullable().optional(),
  vendorName: zText(120).nullable().optional(),
  poNumber: zText(64).nullable().optional(),
  onRentDate: zDay,
  offRentDate: zDayOpt,
  plannedOffRentDate: zDayOpt,
  callOffNoticeDays: z.number().int().min(0).max(30).default(1),
  calledOffOn: zDayOpt,
  callOffConfirmation: zText(64).nullable().optional(),
  dayRate: money,
  weekRate: money,
  monthRate: money,
  deliveryCharge: money,
  pickupCharge: money,
  notes: z.string().max(5000).nullable().optional(),
};

async function rentalOr404(id: number) {
  const d = await db();
  const [r] = await d.select().from(equipmentRentals).where(eq(equipmentRentals.id, id)).limit(1);
  if (!r) bad("Rental not found");
  return r;
}

async function assertRefs(v: { equipmentId?: number | null; vendorCompanyId?: number | null }) {
  const d = await db();
  if (v.equipmentId) {
    const [e] = await d.select({ id: equipment.id }).from(equipment).where(eq(equipment.id, v.equipmentId)).limit(1);
    if (!e) bad("Equipment not found");
  }
  if (v.vendorCompanyId) {
    const [c] = await d.select({ id: companies.id }).from(companies).where(eq(companies.id, v.vendorCompanyId)).limit(1);
    if (!c) bad("Vendor not found");
  }
}

function checkDates(r: { onRentDate: string; offRentDate?: string | null; plannedOffRentDate?: string | null; calledOffOn?: string | null }) {
  if (r.offRentDate && r.offRentDate < r.onRentDate) bad("Off-rent date is before the on-rent date");
  if (r.plannedOffRentDate && r.plannedOffRentDate < r.onRentDate) bad("Planned off-rent date is before the on-rent date");
}

const partial = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof fields]: z.ZodOptional<(typeof fields)[K]> };

export const rentalsRouter = router({
  list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const d = await db();
    const today = await orgToday();
    const fin = await hasPriv(ctx, "project.financials", input.projectId);
    const rows = await d.select().from(equipmentRentals).where(eq(equipmentRentals.projectId, input.projectId)).orderBy(asc(equipmentRentals.onRentDate), asc(equipmentRentals.id));
    const eqIds = [...new Set(rows.map(r => r.equipmentId).filter((x): x is number => x != null))];
    const usage = eqIds.length
      ? await d
          .select({ equipmentId: dailyReportEquipment.equipmentId, reportDate: dailyReports.reportDate, standbyHours: dailyReportEquipment.standbyHours, operatingHours: dailyReportEquipment.operatingHours })
          .from(dailyReportEquipment)
          .innerJoin(dailyReports, eq(dailyReports.id, dailyReportEquipment.reportId))
          .where(and(eq(dailyReports.projectId, input.projectId), eq(dailyReports.status, "final"), inArray(dailyReportEquipment.equipmentId, eqIds)))
      : [];
    return rows.map(r => {
      const cost = rentalCost(r, today);
      return {
        ...r,
        ...(fin ? {} : { dayRate: null, weekRate: null, monthRate: null, deliveryCharge: null, pickupCharge: null }),
        cost: fin ? cost : { days: cost.days, charge: null, total: null },
        priced: cost.charge != null,
        callOff: callOffStatus(r, today),
        standbyDays: r.equipmentId ? standbyDays(usage.filter(u => u.equipmentId === r.equipmentId), r) : null,
      };
    });
  }),

  create: protectedProcedure.input(z.object({ projectId: zId, ...fields })).mutation(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    await assertRefs(input);
    checkDates(input);
    const d = await db();
    const nulls = Object.fromEntries(Object.keys(fields).map(k => [k, null]));
    const [{ id }] = await d.insert(equipmentRentals).values({ ...nulls, ...defined(input), callOffNoticeDays: input.callOffNoticeDays } as never).$returningId();
    await logActivity(ctx, { projectId: input.projectId, entityType: "rental", entityId: id, action: "create", summary: `put ${input.description} on rent from ${input.onRentDate}` });
    return { id };
  }),

  update: protectedProcedure.input(z.object({ id: zId, ...partial })).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input;
    const r = await rentalOr404(id);
    await requireJobModule(ctx, r.projectId);
    await assertRefs(rest);
    const set = defined(rest);
    checkDates({ ...r, ...set });
    const d = await db();
    if (Object.keys(set).length) await d.update(equipmentRentals).set(set).where(eq(equipmentRentals.id, id));
    return { ok: true };
  }),

  /** Record the call to the vendor (date and their confirmation number). */
  callOff: protectedProcedure.input(z.object({ id: zId, calledOffOn: zDay, confirmation: zText(64).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const r = await rentalOr404(input.id);
    await requireJobModule(ctx, r.projectId);
    if (r.offRentDate) bad("This rental is already off rent");
    if (input.calledOffOn < r.onRentDate) bad("Call-off date is before the on-rent date");
    const d = await db();
    await d.update(equipmentRentals).set({ calledOffOn: input.calledOffOn, callOffConfirmation: input.confirmation ?? null }).where(eq(equipmentRentals.id, r.id));
    await logActivity(ctx, { projectId: r.projectId, entityType: "rental", entityId: r.id, action: "calloff", summary: `called off ${r.description}${input.confirmation ? ` (conf. ${input.confirmation})` : ""}` });
    return { ok: true };
  }),

  offRent: protectedProcedure.input(z.object({ id: zId, offRentDate: zDay })).mutation(async ({ ctx, input }) => {
    const r = await rentalOr404(input.id);
    await requireJobModule(ctx, r.projectId);
    if (input.offRentDate < r.onRentDate) bad("Off-rent date is before the on-rent date");
    const d = await db();
    await d.update(equipmentRentals).set({ offRentDate: input.offRentDate }).where(eq(equipmentRentals.id, r.id));
    await logActivity(ctx, { projectId: r.projectId, entityType: "rental", entityId: r.id, action: "offrent", summary: `took ${r.description} off rent on ${input.offRentDate}` });
    return { ok: true };
  }),

  remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const r = await rentalOr404(input.id);
    await requireJobModule(ctx, r.projectId);
    const d = await db();
    await d.delete(equipmentRentals).where(eq(equipmentRentals.id, r.id));
    return { ok: true };
  }),
});
