import {
  ACCESS_TYPE_CAPS,
  ALL_PRIVILEGES,
  GLOBAL_PRIVILEGES,
  type AccessType,
  type Privilege,
} from "@shared/domain";

/**
 * Permission evaluation (pure).
 *
 * A user's effective privileges on a job are the union of grants from every
 * role that applies (global, the job's workspace, the job itself, plus the
 * automatic Project Manager / Assignee roles), minus any privilege that ANY
 * applicable role denies (deny wins), capped by the user's access type.
 * Admins bypass. Without project.view no other job privilege applies.
 */

export type RoleDef = { id: number; key: string; privileges: Map<string, "grant" | "deny"> };
export type Assignment = { roleId: number; scopeType: string; scopeId: number | null };

export type SecurityData = {
  userId: number;
  isAdmin: boolean;
  accessType: AccessType;
  roles: Map<number, RoleDef>;
  assignments: Assignment[];
  pmProjectIds: Set<number>;
  assigneeProjectIds: Set<number>;
  projectWorkspace: Map<number, number | null>;
  autoRoleIds: { pm: number | null; assignee: number | null };
};

const GLOBAL_KEYS = new Set(Object.keys(GLOBAL_PRIVILEGES));
const ALL_KEYS = Object.keys(ALL_PRIVILEGES) as Privilege[];

export function applicableRoleIds(sec: SecurityData, projectId: number | null): number[] {
  const ids: number[] = [];
  for (const a of sec.assignments) {
    if (a.scopeType === "global") ids.push(a.roleId);
    else if (projectId != null && a.scopeType === "project" && a.scopeId === projectId) ids.push(a.roleId);
    else if (
      projectId != null &&
      a.scopeType === "workspace" &&
      a.scopeId != null &&
      sec.projectWorkspace.get(projectId) === a.scopeId
    )
      ids.push(a.roleId);
  }
  if (projectId != null) {
    if (sec.pmProjectIds.has(projectId) && sec.autoRoleIds.pm) ids.push(sec.autoRoleIds.pm);
    if (sec.assigneeProjectIds.has(projectId) && sec.autoRoleIds.assignee) ids.push(sec.autoRoleIds.assignee);
  }
  return ids;
}

export function effectivePrivileges(sec: SecurityData, projectId: number | null): Set<Privilege> {
  if (sec.accessType === "passive") return new Set();
  if (sec.isAdmin) return new Set(ALL_KEYS);

  const granted = new Set<string>();
  const denied = new Set<string>();
  for (const roleId of applicableRoleIds(sec, projectId)) {
    const role = sec.roles.get(roleId);
    if (!role) continue;
    role.privileges.forEach((effect, priv) => {
      if (effect === "deny") denied.add(priv);
      else granted.add(priv);
    });
  }

  const cap = ACCESS_TYPE_CAPS[sec.accessType] ?? [];
  const capSet = cap === "all" ? null : new Set<string>(cap);
  const out = new Set<Privilege>();
  granted.forEach(p => {
    if (denied.has(p)) return;
    if (capSet && !capSet.has(p)) return;
    out.add(p as Privilege);
  });

  if (projectId != null && !out.has("project.view")) {
    // project.view is a prerequisite for every job-scoped privilege.
    const globalsOnly = new Set<Privilege>();
    out.forEach(p => {
      if (GLOBAL_KEYS.has(p)) globalsOnly.add(p);
    });
    return globalsOnly;
  }
  return out;
}

export function can(sec: SecurityData, privilege: Privilege, projectId: number | null = null): boolean {
  return effectivePrivileges(sec, projectId).has(privilege);
}

export function visibleProjectIds(sec: SecurityData): number[] {
  const ids: number[] = [];
  sec.projectWorkspace.forEach((_ws, pid) => {
    if (can(sec, "project.view", pid)) ids.push(pid);
  });
  return ids;
}
