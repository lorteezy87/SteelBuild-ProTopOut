import { asc, eq } from "drizzle-orm";
import { GLOBAL_PRIVILEGES, type GlobalPrivilege } from "@shared/domain";
import {
  calendars,
  companies,
  contacts,
  equipment,
  expenseCodes,
  jobRoles,
  notifications,
  timeCodes,
  users,
  wfApps,
} from "../../drizzle/schema";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSetting } from "../bootstrap";
import { db } from "../db";
import { can } from "../security/access";
import { financialChecker, sec } from "../security/guard";
import { orgToday } from "../services/calendars";
import { and, sql } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

/** Lazy import avoids a circular module dependency with server/routers.ts. */
function appRouterCaller(ctx: TrpcContext) {
  return {
    time: {
      approvals: async (i: { state: "submitted" }) =>
        (await import("./time")).timeRouter.createCaller(ctx).approvals(i),
    },
    expenses: {
      approvals: async () =>
        (await import("./expenses")).expensesRouter
          .createCaller(ctx)
          .approvals(),
    },
    daily: {
      pending: async () =>
        (await import("./dailyReports")).dailyReportsRouter
          .createCaller(ctx)
          .pending(),
    },
  };
}

export type OrgSettings = {
  name: string;
  timezone: string;
  deliveryLeadDays: number;
  currency: string;
  timeLockedThrough?: string | null;
};

export const refRouter = router({
  /** Everything the client needs for pickers, labels and navigation. */
  all: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const s = await sec(ctx);
    const [
      u,
      jr,
      co,
      ct,
      eq_,
      tc,
      ec,
      cal,
      apps,
      org,
      projectTypes,
      today,
    ] = await Promise.all([
      d
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          accessType: users.accessType,
          jobRoleId: users.jobRoleId,
          isActive: users.isActive,
          title: users.title,
          supervisorId: users.supervisorId,
          role: users.role,
        })
        .from(users)
        .orderBy(asc(users.name)),
      d.select().from(jobRoles).orderBy(asc(jobRoles.name)),
      d.select().from(companies).orderBy(asc(companies.name)),
      d.select().from(contacts).orderBy(asc(contacts.name)),
      d.select().from(equipment).orderBy(asc(equipment.name)),
      d.select().from(timeCodes),
      d.select().from(expenseCodes),
      d.select().from(calendars),
      d
        .select()
        .from(wfApps)
        .where(eq(wfApps.isActive, true))
        .orderBy(asc(wfApps.sortOrder)),
      getSetting<OrgSettings>("org", {
        name: "SteelBuild Pro TopOut",
        timezone: "America/Phoenix",
        deliveryLeadDays: 2,
        currency: "USD",
      }),
      getSetting<string[]>("projectTypes", []),
      orgToday(),
    ]);
    const globalPrivs = (
      Object.keys(GLOBAL_PRIVILEGES) as GlobalPrivilege[]
    ).filter(p => can(s, p, null));
    const canSeeRates =
      s.isAdmin ||
      s.projectIds.some(financialChecker(s));
    return {
      me: {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        isAdmin: ctx.user.role === "admin",
        accessType: ctx.user.accessType,
        globalPrivs,
        managesProjects: s.isAdmin,
      },
      users: u,
      jobRoles: jr.map(r => ({
        ...r,
        costRate: canSeeRates ? r.costRate : null,
        billRate: canSeeRates ? r.billRate : null,
      })),
      companies: co.map(c => ({
        ...c,
        contacts: ct.filter(x => x.companyId === c.id),
      })),
      equipment: eq_.map(e => ({
        ...e,
        hourlyRate: canSeeRates ? e.hourlyRate : null,
        standbyRate: canSeeRates ? e.standbyRate : null,
      })),
      timeCodes: tc,
      expenseCodes: ec,
      calendars: cal,
      apps: apps.map(a => ({
        id: a.id,
        key: a.key,
        name: a.name,
        pluralName: a.pluralName,
        numberPrefix: a.numberPrefix,
        color: a.color,
        icon: a.icon,
        scope: a.scope,
        dueDateLabel: a.dueDateLabel,
        config: a.config,
      })),
      org,
      projectTypes,
      today,
    };
  }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const [r] = await d
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.isRead, false)
        )
      );
    return Number(r?.n ?? 0);
  }),

  /** Counts for the shell's Approvals badge (same scoping as the approval queues). */
  badges: protectedProcedure.query(async ({ ctx }) => {
    const caller = appRouterCaller(ctx);
    const [t, e, dr] = await Promise.all([
      caller.time.approvals({ state: "submitted" }).catch(() => []),
      caller.expenses.approvals().catch(() => []),
      caller.daily.pending().catch(() => []),
    ]);
    const time = t.filter(entry => entry.canDecide).length;
    return {
      time,
      expenses: e.length,
      daily: dr.length,
      total: time + e.length + dr.length,
    };
  }),

  orgName: publicProcedure.query(async () => {
    const org = await getSetting<OrgSettings | null>("org", null);
    return org?.name ?? "SteelBuild Pro TopOut";
  }),
});
