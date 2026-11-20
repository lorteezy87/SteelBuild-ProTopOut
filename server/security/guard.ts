import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import type { AccessType, Privilege } from "@shared/domain";
import {
  projects,
  roleAssignments,
  rolePrivileges,
  securityRoles,
  settings,
  taskAssignments,
  tasks,
  type User,
} from "../../drizzle/schema";
import { db } from "../db";
import { can, effectivePrivileges, visibleProjectIds, type RoleDef, type SecurityData } from "./access";

type RoleCache = { at: number; roles: Map<number, RoleDef>; pm: number | null; assignee: number | null };
let roleCache: RoleCache | null = null;
const ROLE_TTL_MS = 30_000;

export function invalidateRoleCache() {
  roleCache = null;
}

async function loadRoles(): Promise<RoleCache> {
  if (roleCache && Date.now() - roleCache.at < ROLE_TTL_MS) return roleCache;
  const d = await db();
  const roleRows = await d.select().from(securityRoles);
  const privRows = await d.select().from(rolePrivileges);
  const roles = new Map<number, RoleDef>();
  for (const r of roleRows) roles.set(r.id, { id: r.id, key: r.key, privileges: new Map() });
  for (const p of privRows) roles.get(p.roleId)?.privileges.set(p.privilege, p.effect === "deny" ? "deny" : "grant");

  const autoRow = await d.select().from(settings).where(eq(settings.key, "autoRoles")).limit(1);
  const auto = (autoRow[0]?.value ?? { pm: "project_manager", assignee: "assignee" }) as {
    pm?: string;
    assignee?: string;
  };
  const byKey = (k?: string) => roleRows.find(r => r.key === k)?.id ?? null;
  roleCache = { at: Date.now(), roles, pm: byKey(auto.pm), assignee: byKey(auto.assignee) };
  return roleCache;
}

export async function loadSecurity(user: User): Promise<SecurityData> {
  const d = await db();
  const rc = await loadRoles();
  const [assignRows, projRows, mine] = await Promise.all([
    d.select().from(roleAssignments).where(eq(roleAssignments.userId, user.id)),
    d.select({ id: projects.id, workspaceId: projects.workspaceId, managerId: projects.managerId }).from(projects),
    d
      .select({ projectId: tasks.projectId })
      .from(taskAssignments)
      .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
      .where(eq(taskAssignments.userId, user.id)),
  ]);
  return {
    userId: user.id,
    isAdmin: user.role === "admin",
    accessType: (user.accessType as AccessType) ?? "team_member",
    roles: rc.roles,
    assignments: assignRows.map(a => ({ roleId: a.roleId, scopeType: a.scopeType, scopeId: a.scopeId })),
    pmProjectIds: new Set(projRows.filter(p => p.managerId === user.id).map(p => p.id)),
    assigneeProjectIds: new Set(mine.map(m => m.projectId)),
    projectWorkspace: new Map(projRows.map(p => [p.id, p.workspaceId])),
    autoRoleIds: { pm: rc.pm, assignee: rc.assignee },
  };
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
