import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DELIVERY_STATUSES } from "@shared/domain";
import { deliveryRisk } from "@shared/delivery";
import {
  companies,
  deliveries,
  projectCompanies,
  tasks,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getSetting } from "../bootstrap";
import { db } from "../db";
import { hasPriv, requireJobModule } from "../security/guard";
import { getCalendar, orgToday } from "../services/calendars";
import { emit, logActivity } from "../services/events";
import { recomputeProject } from "../services/recompute";
import { createItem, getApp } from "../services/wf";
import {
  bad,
  defined,
  getProjectOr404,
  getTaskOr404,
  zDayOpt,
  zId,
  zText,
} from "./_util";

const enumOf = <T extends Record<string, string>>(o: T) =>
  z.enum(Object.keys(o) as [string, ...string[]]);

const fields = z.object({
  projectId: zId,
  sequenceTaskId: zId.nullable().optional(),
  loadNumber: zText(32).min(1),
  description: zText(500).nullable().optional(),
  fabricatorCompanyId: zId.nullable().optional(),
  needDate: zDayOpt,
  promisedDate: zDayOpt,
  shippedDate: zDayOpt,
  receivedDate: zDayOpt,
  tons: z.number().min(0).optional(),
  pieces: z.number().int().min(0).optional(),
  ticketNumber: zText(64).nullable().optional(),
  status: enumOf(DELIVERY_STATUSES).optional(),
  shortageNotes: z.string().max(5000).nullable().optional(),
});

async function defaultNeedDate(
  projectId: number,
  sequenceTaskId: number | null | undefined
) {
  if (!sequenceTaskId) return null;
  const t = await getTaskOr404(sequenceTaskId);
  if (!t.startDate) return null;
  const p = await getProjectOr404(projectId);
  const cal = await getCalendar(p.calendarId);
  const org = await getSetting<{ deliveryLeadDays?: number }>("org", {});
  return cal.addWorkDays(t.startDate, -(org.deliveryLeadDays ?? 2));
}

export const deliveriesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: zId }))
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.view");
      const d = await db();
      const today = await orgToday();
      const rows = await d
        .select()
        .from(deliveries)
        .where(eq(deliveries.projectId, input.projectId))
        .orderBy(asc(deliveries.needDate), asc(deliveries.loadNumber));
      const seqIds = Array.from(
        new Set(rows.map(r => r.sequenceTaskId).filter((x): x is number => !!x))
      );
      const seqs = seqIds.length
        ? await d
            .select({
              id: tasks.id,
              name: tasks.name,
              startDate: tasks.startDate,
              location: tasks.location,
            })
            .from(tasks)
            .where(inArray(tasks.id, seqIds))
        : [];
      const coIds = Array.from(
        new Set(
          rows.map(r => r.fabricatorCompanyId).filter((x): x is number => !!x)
        )
      );
      const cos = coIds.length
        ? await d
            .select({ id: companies.id, name: companies.name })
            .from(companies)
            .where(inArray(companies.id, coIds))
        : [];
      return rows.map(r => ({
        ...r,
        sequence: seqs.find(s => s.id === r.sequenceTaskId) ?? null,
        fabricatorName:
          cos.find(c => c.id === r.fabricatorCompanyId)?.name ?? null,
        risk: deliveryRisk(r, today),
      }));
    }),

  upsert: protectedProcedure
    .input(fields.extend({ id: zId.optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "delivery.edit");
      const d = await db();
      const { id, ...rest } = input;
      if (rest.sequenceTaskId) {
        const t = await getTaskOr404(rest.sequenceTaskId);
        if (t.projectId !== input.projectId)
          bad("Sequence belongs to a different job");
      }
      if (
        rest.receivedDate &&
        (!rest.status ||
          rest.status === "scheduled" ||
          rest.status === "shipped")
      )
        rest.status = "received";
      else if (
        rest.shippedDate &&
        (!rest.status || rest.status === "scheduled")
      )
        rest.status = "shipped";
      if (id) {
        const [before] = await d
          .select()
          .from(deliveries)
          .where(eq(deliveries.id, id))
          .limit(1);
        if (!before || before.projectId !== input.projectId)
          bad("Load not found");
        await d
          .update(deliveries)
          .set(defined(rest))
          .where(eq(deliveries.id, id));
        if (rest.status && rest.status !== before.status) {
          await logActivity(ctx, {
            projectId: input.projectId,
            entityType: "delivery",
            entityId: id,
            action: "status",
            summary: `load ${before.loadNumber} → ${DELIVERY_STATUSES[rest.status as keyof typeof DELIVERY_STATUSES]}`,
          });
        }
        await emit(ctx, "delivery", "update", {
          id,
          projectId: input.projectId,
          status: rest.status ?? before.status,
        });
        await recomputeProject(input.projectId);
        return { id };
      }
      if (!rest.needDate)
        rest.needDate = await defaultNeedDate(
          input.projectId,
          rest.sequenceTaskId
        );
      if (!rest.fabricatorCompanyId) {
        const [fab] = await d
          .select()
          .from(projectCompanies)
          .where(
            and(
              eq(projectCompanies.projectId, input.projectId),
              eq(projectCompanies.role, "fabricator")
            )
          )
          .limit(1);
        rest.fabricatorCompanyId = fab?.companyId ?? null;
      }
      const [{ id: newId }] = await d
        .insert(deliveries)
        .values({ ...rest, createdBy: ctx.user.id })
        .$returningId();
      await logActivity(ctx, {
        projectId: input.projectId,
        entityType: "delivery",
        entityId: newId,
        action: "create",
        summary: `scheduled load ${rest.loadNumber}`,
      });
      await emit(ctx, "delivery", "add", {
        id: newId,
        projectId: input.projectId,
        loadNumber: rest.loadNumber,
      });
      await recomputeProject(input.projectId);
      return { id: newId };
    }),

  remove: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.id))
        .limit(1);
      if (!row) return { ok: true };
      await requireJobModule(ctx, row.projectId, "delivery.edit");
      await d.delete(deliveries).where(eq(deliveries.id, input.id));
      await emit(ctx, "delivery", "delete", {
        id: row.id,
        projectId: row.projectId,
      });
      await recomputeProject(row.projectId);
      return { ok: true };
    }),

  /** One-click Delay Notice from a late / at-risk load, pre-filled with Fabricator as responsible party. */
  createDelayNotice: protectedProcedure
    .input(z.object({ deliveryId: zId }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .limit(1);
      if (!row) bad("Load not found");
      await requireJobModule(ctx, row.projectId, "log.create");
      const app = await getApp("delay");
      const today = await orgToday();
      const seq = row.sequenceTaskId
        ? await getTaskOr404(row.sequenceTaskId)
        : null;
      const [fab] = row.fabricatorCompanyId
        ? await d
            .select({ name: companies.name })
            .from(companies)
            .where(eq(companies.id, row.fabricatorCompanyId))
            .limit(1)
        : [];
      const p = await getProjectOr404(row.projectId);
      const late = row.receivedDate ?? row.promisedDate;
      const res = await createItem(ctx, {
        appId: app.id,
        projectId: row.projectId,
        title: `Late delivery — Load ${row.loadNumber}${seq ? ` (${seq.name})` : ""}`,
        description:
          `Load ${row.loadNumber}${fab?.name ? ` from ${fab.name}` : ""} was needed on site ${row.needDate ?? "(no need date)"}` +
          `${late ? `; ${row.receivedDate ? "received" : "promised"} ${late}` : ""}.` +
          `${row.shortageNotes ? `\nNotes: ${row.shortageNotes}` : ""}`,
        priority: "high",
        responsibleParty: "fabricator",
        linkedDeliveryId: row.id,
        linkedTaskId: seq?.id ?? null,
        customFields: {
          event_date: today,
          cause: "late_delivery",
          location: seq?.location ?? null,
          affected_sequences: seq?.name ?? null,
          references: row.ticketNumber
            ? `Delivery ticket ${row.ticketNumber}`
            : null,
        },
        canFinancial: await hasPriv(ctx, "project.financials", p.id),
      });
      return res;
    }),
});
