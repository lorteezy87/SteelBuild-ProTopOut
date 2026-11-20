import { TRPCError } from "@trpc/server";
import { inArray } from "drizzle-orm";
import type { Privilege } from "@shared/domain";
import { projects, type User } from "../../drizzle/schema";
import { db } from "../db";
import { can, effectivePrivileges, ownerSecurity, visibleProjectIds, type SecurityData } from "./access";

export async function loadSecurity(user: User): Promise<SecurityData> {
  if (user.role !== "admin") return ownerSecurity(user, []);
  const d = await db();
  const rows = await d.select({ id: projects.id }).from(projects);
  return ownerSecurity(user, rows.map(r => r.id));
}

/* ------------------------------------------------------------------ */
/* Per-request memo                                                    */
/* ------------------------------------------------------------------ */

type Ctx = { user: User; req: object; sec?: Promise<SecurityData> };

export function sec(ctx: Ctx): Promise<SecurityData> {
  if (!ctx.sec) ctx.sec = loadSecurity(ctx.user);
  return ctx.sec;
}

/** Drop cached security after changes that affect it within the same request. */
export function resetSec(ctx: Ctx) {
  ctx.sec = undefined;
}

export async function requirePriv(ctx: Ctx, privilege: Privilege, projectId: number | null = null) {
  const s = await sec(ctx);
  if (!can(s, privilege, projectId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Missing privilege: ${privilege}` });
  }
  return s;
}

export async function hasPriv(ctx: Ctx, privilege: Privilege, projectId: number | null = null) {
  return can(await sec(ctx), privilege, projectId);
}

export async function projectPrivs(ctx: Ctx, projectId: number) {
  return Array.from(effectivePrivileges(await sec(ctx), projectId));
}

export async function visibleProjects(ctx: Ctx): Promise<number[]> {
  return visibleProjectIds(await sec(ctx));
}

export function requireAdmin(ctx: Ctx) {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Administrator only" });
}

export async function projectsForUserIds(ids: number[]) {
  if (!ids.length) return [];
  const d = await db();
  return d.select().from(projects).where(inArray(projects.id, ids));
}

/* ------------------------------------------------------------------ */
/* Module access by license tier                                       */
/* ------------------------------------------------------------------ */

/**
 * Job modules outside of Logs (schedule/tasks, deliveries, daily reports, baselines,
 * documents, financials, reports on those sources) are not available to the
 * "Logs only" (app_only), Timesheet-only and Passive tiers, regardless of roles.
 * project.view remains the prerequisite for log access on a job.
 */
export function hasJobModuleAccess(s: Pick<SecurityData, "isAdmin" | "accessType">): boolean {
  return s.isAdmin || s.accessType === "full" || s.accessType === "team_member";
}

/** Throws FORBIDDEN unless the caller's tier includes non-log job modules AND holds `privilege` on the job. */
export async function requireJobModule(ctx: Ctx, projectId: number, privilege: Privilege = "project.view") {
  const s = await sec(ctx);
  if (!hasJobModuleAccess(s)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your access type only includes Logs and Timesheets" });
  }
  if (!can(s, privilege, projectId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Missing privilege: ${privilege}` });
  }
  return s;
}

/** True when the caller may see dollar amounts on this job. */
export async function canSeeFinancials(ctx: Ctx, projectId: number) {
  return can(await sec(ctx), "project.financials", projectId);
}

/** Memoised per-job financial check for masking lists that span jobs. */
export function financialChecker(s: SecurityData): (projectId: number | null | undefined) => boolean {
  const cache = new Map<number, boolean>();
  return pid => {
    if (s.isAdmin) return true;
    if (pid == null) return false;
    if (!cache.has(pid)) cache.set(pid, effectivePrivileges(s, pid).has("project.financials"));
    return cache.get(pid)!;
  };
}
