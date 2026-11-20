import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_TYPES, ALL_PRIVILEGES } from "@shared/domain";
import {
  calendarExceptions,
  calendars,
  companies,
  contacts,
  equipment,
  expenseCodes,
  jobRoles,
  projects,
  wfItems,
  timeCodes,
  users,
} from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getSetting, setSetting } from "../bootstrap";
import { db } from "../db";
import { hasPriv } from "../security/guard";
import { invalidateCalendars } from "../services/calendars";
import { recomputeAll } from "../services/recompute";
import { crewInsertValues, crewUpdateSet } from "../services/crew";
import { bad, defined, zDay, zId, zText } from "./_util";
import { refreshItem, refreshItemsForProject } from "../services/wf";
import type { OrgSettings } from "./ref";

const privilege = z.string().refine(p => p in ALL_PRIVILEGES, "Unknown privilege");

const crewInput = z.object({
  name: zText(200).min(1),
  title: zText(128).nullable().optional(),
  phone: zText(64).nullable().optional(),
  jobRoleId: zId.nullable().optional(),
  costRate: z.number().min(0).nullable().optional(),
  billRate: z.number().min(0).nullable().optional(),
  calendarId: zId.nullable().optional(),
  isActive: z.boolean().optional(),
});

const companyInput = z.object({
  name: zText(200).min(1),
  type: zText(32),
  phone: zText(64).nullable().optional(),
  email: zText(320).nullable().optional(),
  address: z.string().max(2000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  isActive: z.boolean().optional(),
});

async function requireCompanyEditor(ctx: Parameters<typeof hasPriv>[0]) {
  if (ctx.user.role === "admin") return;
  if (!(await hasPriv(ctx, "project.create"))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only admins or users who can create jobs may edit companies" });
  }
}

export const adminRouter = router({
  /* ---------------- Crew (people records; only the owner signs in) ---------------- */
  users: router({
    list: adminProcedure.query(async () => {
      const d = await db();
      return d.select().from(users).where(ne(users.role, "admin")).orderBy(asc(users.name));
    }),
    create: adminProcedure.input(crewInput).mutation(async ({ input }) => {
      const d = await db();
      const [{ id }] = await d.insert(users).values(crewInsertValues(input)).$returningId();
      return { id };
    }),
    update: adminProcedure.input(crewInput.partial().extend({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      const { id, ...rest } = input;
      const [target] = await d.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1);
      if (!target) bad("Crew member not found");
      let set: Record<string, unknown>;
      try {
        set = crewUpdateSet(rest, target);
      } catch (e) {
        bad(e instanceof Error ? e.message : String(e));
      }
      if (Object.keys(set!).length) await d.update(users).set(set!).where(eq(users.id, id));
      return { ok: true };
    }),
  }),

  /* ---------------- Job roles ---------------- */
  jobRoles: router({
    upsert: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          name: zText(128).min(1),
          costRate: z.number().min(0),
          billRate: z.number().min(0),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          await d.update(jobRoles).set(rest).where(eq(jobRoles.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(jobRoles).values(rest).$returningId();
        return { id: newId };
      }),
  }),

  /* ---------------- Calendars ---------------- */
  calendars: router({
    get: protectedProcedure.input(z.object({ id: zId })).query(async ({ input }) => {
      const d = await db();
      const [c] = await d.select().from(calendars).where(eq(calendars.id, input.id)).limit(1);
      const ex = await d
        .select()
        .from(calendarExceptions)
        .where(eq(calendarExceptions.calendarId, input.id))
        .orderBy(asc(calendarExceptions.date));
      return { ...c, exceptions: ex };
    }),
    upsert: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          name: zText(128).min(1),
          workDays: z.array(z.number().int().min(1).max(7)).min(1),
          hoursPerDay: z.number().min(1).max(24),
          isDefault: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const { id, ...rest } = input;
        if (rest.isDefault) await d.update(calendars).set({ isDefault: false });
        let calId = id;
        if (id) await d.update(calendars).set(rest).where(eq(calendars.id, id));
        else [{ id: calId }] = await d.insert(calendars).values({ ...rest, isDefault: rest.isDefault ?? false }).$returningId();
        invalidateCalendars();
        return { id: calId };
      }),
    addException: adminProcedure
      .input(z.object({ calendarId: zId, date: zDay, name: zText(128).optional(), isWorking: z.boolean().default(false) }))
      .mutation(async ({ input }) => {
        const d = await db();
        await d.insert(calendarExceptions).values({ ...input, name: input.name ?? null });
        invalidateCalendars();
        return { ok: true };
      }),
    removeException: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      await d.delete(calendarExceptions).where(eq(calendarExceptions.id, input.id));
      invalidateCalendars();
      return { ok: true };
    }),
  }),

  /* ---------------- Companies & contacts ---------------- */
  companies: router({
    upsert: protectedProcedure.input(companyInput.extend({ id: zId.optional() })).mutation(async ({ ctx, input }) => {
      await requireCompanyEditor(ctx);
      const d = await db();
      const { id, ...rest } = input;
      if (id) {
        await d.update(companies).set(defined(rest)).where(eq(companies.id, id));
        return { id };
      }
      const [{ id: newId }] = await d.insert(companies).values(rest).$returningId();
      return { id: newId };
    }),
    upsertContact: protectedProcedure
      .input(
        z.object({
          id: zId.optional(),
          companyId: zId,
          name: zText(200).min(1),
          title: zText(128).nullable().optional(),
          email: zText(320).nullable().optional(),
          phone: zText(64).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireCompanyEditor(ctx);
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          await d.update(contacts).set(rest).where(eq(contacts.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(contacts).values(rest).$returningId();
        return { id: newId };
      }),
    removeContact: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      await requireCompanyEditor(ctx);
      const d = await db();
      await d.delete(contacts).where(eq(contacts.id, input.id));
      return { ok: true };
    }),
  }),

  /* ---------------- Equipment ---------------- */
  equipment: router({
    upsert: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          name: zText(200).min(1),
          type: zText(32),
          capacity: zText(64).nullable().optional(),
          ownership: z.enum(["owned", "rented"]),
          vendorCompanyId: zId.nullable().optional(),
          hourlyRate: z.number().min(0),
          standbyRate: z.number().min(0),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          await d.update(equipment).set(rest).where(eq(equipment.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(equipment).values(rest).$returningId();
        return { id: newId };
      }),
  }),

  /* ---------------- Time & expense codes ---------------- */
  timeCodes: router({
    upsert: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          name: zText(128).min(1),
          billable: z.boolean(),
          multiplier: z.number().min(0).max(5),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          await d.update(timeCodes).set(rest).where(eq(timeCodes.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(timeCodes).values(rest).$returningId();
        return { id: newId };
      }),
  }),
  expenseCodes: router({
    upsert: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          name: zText(128).min(1),
          billable: z.boolean(),
          costable: z.boolean(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const { id, ...rest } = input;
        if (id) {
          await d.update(expenseCodes).set(rest).where(eq(expenseCodes.id, id));
          return { id };
        }
        const [{ id: newId }] = await d.insert(expenseCodes).values(rest).$returningId();
        return { id: newId };
      }),
  }),

  /* ---------------- Settings ---------------- */
  settings: router({
    update: adminProcedure
      .input(
        z.object({
          org: z
            .object({
              name: zText(200).min(1),
              timezone: zText(64).min(1),
              deliveryLeadDays: z.number().int().min(0).max(30),
              currency: zText(8),
              timeLockedThrough: zDay.refine(day => {
                const date = new Date(`${day}T00:00:00Z`);
                return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
              }, "Use a valid YYYY-MM-DD date").nullable().optional(),
            })
            .optional(),
          projectTypes: z.array(zText(64).min(1)).optional(),
        })
      )
      .mutation(async ({ input }) => {
        if (input.org) {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: input.org.timezone });
          } catch {
            bad("Unknown time zone");
          }
          const previous = await getSetting<Partial<OrgSettings>>("org", {});
          // Existing clients may omit the additive lock field; retain its value.
          await setSetting("org", { ...previous, ...input.org });
          if (input.org.timezone !== (previous.timezone ?? "America/Phoenix")) {
            const d = await db();
            const jobs = await d.select({ id: projects.id }).from(projects);
            for (const job of jobs) await refreshItemsForProject(job.id);
            const unscoped = await d.select({ id: wfItems.id }).from(wfItems).where(isNull(wfItems.projectId));
            for (const item of unscoped) await refreshItem(item.id);
          }
        }
        if (input.projectTypes) await setSetting("projectTypes", input.projectTypes);
        return { ok: true };
      }),
  }),

  /* ---------------- Maintenance ---------------- */
  recomputeAll: adminProcedure.mutation(async () => ({ projects: await recomputeAll() })),

  /** Users who can be chosen as approvers / supervisors etc. */
  userIdsByIds: adminProcedure.input(z.object({ ids: z.array(zId) })).query(async ({ input }) => {
    if (!input.ids.length) return [];
    const d = await db();
    return d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, input.ids));
  }),
});
