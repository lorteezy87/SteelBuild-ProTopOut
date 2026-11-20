import { asc, eq } from "drizzle-orm";
import { GLOBAL_PRIVILEGES, type GlobalPrivilege } from "@shared/domain";
import {
  calendars,
  companies,
  contacts,
  equipment,
  expenseCodes,
  jobRoles,
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

  orgName: publicProcedure.query(async () => {
    const org = await getSetting<OrgSettings | null>("org", null);
    return org?.name ?? "SteelBuild Pro TopOut";
  }),
});
