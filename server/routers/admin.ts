import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
  roleAssignments,
  rolePrivileges,
  securityRoles,
  projects,
  wfItems,
  timeCodes,
  users,
  workspaces,
} from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getSetting, setSetting } from "../bootstrap";
import { db } from "../db";
import { invalidateRoleCache, hasPriv } from "../security/guard";
import { invalidateCalendars } from "../services/calendars";
import { recomputeAll } from "../services/recompute";
import { loadDemoData } from "../services/demo";
import { bad, defined, zDay, zId, zText } from "./_util";
import { refreshItem, refreshItemsForProject } from "../services/wf";
import type { OrgSettings } from "./ref";

const accessType = z.enum(Object.keys(ACCESS_TYPES) as [string, ...string[]]);
const privilege = z.string().refine(p => p in ALL_PRIVILEGES, "Unknown privilege");

const userInput = z.object({
  name: zText(200).min(1),
  email: z.string().email().max(320).nullable().optional(),
  accessType: accessType.optional(),
  isAdmin: z.boolean().optional(),
  title: zText(128).nullable().optional(),
  phone: zText(64).nullable().optional(),
  supervisorId: zId.nullable().optional(),
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
  /* ---------------- Users ---------------- */
  users: router({
    list: adminProcedure.query(async () => {
      const d = await db();
      const rows = await d.select().from(users).orderBy(asc(users.name));
      const ra = await d.select().from(roleAssignments);
      return rows.map(u => ({
        ...u,
        pending: u.openId.startsWith("local:"),
        roleAssignments: ra.filter(a => a.userId === u.id),
      }));
    }),
    create: adminProcedure.input(userInput).mutation(async ({ input }) => {
      const d = await db();
      if (input.email) {
        const dup = await d.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
        if (dup.length) bad("A user with this email already exists");
      }
      const [{ id }] = await d
        .insert(users)
        .values({
          openId: `local:${randomUUID()}`,
          name: input.name,
          email: input.email ?? null,
          accessType: input.accessType ?? "team_member",
          role: input.isAdmin ? "admin" : "user",
          title: input.title ?? null,
          phone: input.phone ?? null,
          supervisorId: input.supervisorId ?? null,
          jobRoleId: input.jobRoleId ?? null,
          costRate: input.costRate ?? null,
          billRate: input.billRate ?? null,
          calendarId: input.calendarId ?? null,
          loginMethod: null,
          isActive: input.isActive ?? true,
        })
        .$returningId();
      return { id };
    }),
    update: adminProcedure
      .input(userInput.partial().extend({ id: zId }))
      .mutation(async ({ ctx, input }) => {
        const d = await db();
        const { id, isAdmin, ...rest } = input;
        if (id === ctx.user.id && (isAdmin === false || rest.isActive === false || rest.accessType === "passive")) {
          bad("You cannot remove your own admin access or deactivate yourself");
        }
        const set: Record<string, unknown> = defined(rest);
        if (isAdmin !== undefined) set.role = isAdmin ? "admin" : "user";
        if (Object.keys(set).length) await d.update(users).set(set).where(eq(users.id, id));
        return { ok: true };
      }),
  }),

  /* ---------------- Security roles ---------------- */
  roles: router({
    list: protectedProcedure.query(async () => {
      const d = await db();
      const rows = await d.select().from(securityRoles).orderBy(asc(securityRoles.name));
      const privs = await d.select().from(rolePrivileges);
      return rows.map(r => ({
        ...r,
        grants: privs.filter(p => p.roleId === r.id && p.effect === "grant").map(p => p.privilege),
        denies: privs.filter(p => p.roleId === r.id && p.effect === "deny").map(p => p.privilege),
      }));
    }),
    upsert: adminProcedure
      .input(
        z.object({
          id: zId.optional(),
          name: zText(128).min(1),
          description: z.string().max(1000).nullable().optional(),
          grants: z.array(privilege),
          denies: z.array(privilege),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        const overlap = input.grants.filter(g => input.denies.includes(g));
        if (overlap.length) bad(`A privilege cannot be both granted and denied: ${overlap.join(", ")}`);
        let roleId = input.id;
        if (roleId) {
          await d
            .update(securityRoles)
            .set({ name: input.name, description: input.description ?? null })
            .where(eq(securityRoles.id, roleId));
          await d.delete(rolePrivileges).where(eq(rolePrivileges.roleId, roleId));
        } else {
          const key = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48) + "_" + Date.now().toString(36);
          [{ id: roleId }] = await d
            .insert(securityRoles)
            .values({ key, name: input.name, description: input.description ?? null, isSystem: false })
            .$returningId();
        }
        const rows = [
          ...input.grants.map(p => ({ roleId: roleId!, privilege: p, effect: "grant" })),
          ...input.denies.map(p => ({ roleId: roleId!, privilege: p, effect: "deny" })),
        ];
        if (rows.length) await d.insert(rolePrivileges).values(rows);
        invalidateRoleCache();
        return { id: roleId };
      }),
    remove: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      const [r] = await d.select().from(securityRoles).where(eq(securityRoles.id, input.id)).limit(1);
      if (!r) bad("Role not found");
      if (r.isSystem) bad("System roles cannot be deleted; edit their privileges instead");
      await d.delete(roleAssignments).where(eq(roleAssignments.roleId, input.id));
      await d.delete(rolePrivileges).where(eq(rolePrivileges.roleId, input.id));
      await d.delete(securityRoles).where(eq(securityRoles.id, input.id));
      invalidateRoleCache();
      return { ok: true };
    }),
  }),

  /* ---------------- Role assignments ---------------- */
  assignments: router({
    list: adminProcedure
      .input(z.object({ scopeType: z.enum(["global", "workspace", "project"]).optional(), scopeId: zId.optional() }).optional())
      .query(async ({ input }) => {
        const d = await db();
        const conds = [];
        if (input?.scopeType) conds.push(eq(roleAssignments.scopeType, input.scopeType));
        if (input?.scopeId) conds.push(eq(roleAssignments.scopeId, input.scopeId));
        return d.select().from(roleAssignments).where(conds.length ? and(...conds) : undefined);
      }),
    add: adminProcedure
      .input(
        z.object({
          userId: zId,
          roleId: zId,
          scopeType: z.enum(["global", "workspace", "project"]),
          scopeId: zId.nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        if (input.scopeType !== "global" && !input.scopeId) bad("Choose a workspace or job for this assignment");
        const d = await db();
        const scopeId = input.scopeType === "global" ? null : input.scopeId!;
        const existing = await d
          .select()
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.userId, input.userId),
              eq(roleAssignments.roleId, input.roleId),
              eq(roleAssignments.scopeType, input.scopeType)
            )
          );
        if (existing.some(e => e.scopeId === scopeId)) return { ok: true };
        await d.insert(roleAssignments).values({ ...input, scopeId });
        return { ok: true };
      }),
    remove: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
      const d = await db();
      await d.delete(roleAssignments).where(eq(roleAssignments.id, input.id));
      return { ok: true };
    }),
  }),

  /* ---------------- Workspaces ---------------- */
  workspaces: router({
    upsert: adminProcedure
      .input(z.object({ id: zId.optional(), name: zText(128).min(1), description: z.string().max(1000).nullable().optional() }))
      .mutation(async ({ input }) => {
        const d = await db();
        if (input.id) {
          await d.update(workspaces).set({ name: input.name, description: input.description ?? null }).where(eq(workspaces.id, input.id));
          return { id: input.id };
        }
        const [{ id }] = await d.insert(workspaces).values({ name: input.name, description: input.description ?? null }).$returningId();
        return { id };
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
    autoRoles: adminProcedure.query(() =>
      getSetting<{ pm: string; assignee: string }>("autoRoles", {
        pm: "project_manager",
        assignee: "assignee",
      })
    ),
    updateAutoRoles: adminProcedure
      .input(z.object({ pm: zText(64), assignee: zText(64) }))
      .mutation(async ({ input }) => {
        const d = await db();
        const roles = await d
          .select({ key: securityRoles.key })
          .from(securityRoles);
        for (const key of [input.pm, input.assignee]) {
          if (key && !roles.some(r => r.key === key))
            bad("Unknown security role");
        }
        await setSetting("autoRoles", input);
        invalidateRoleCache();
        return { ok: true };
      }),
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
  loadDemo: adminProcedure.mutation(async ({ ctx }) => loadDemoData(ctx.user.id)),
  demoStatus: adminProcedure.query(async () => ({ loaded: await getSetting<boolean>("demo_loaded", false) })),

  /** Users who can be chosen as approvers / supervisors etc. */
  userIdsByIds: adminProcedure.input(z.object({ ids: z.array(zId) })).query(async ({ input }) => {
    if (!input.ids.length) return [];
    const d = await db();
    return d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, input.ids));
  }),
});
