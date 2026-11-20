import { ALL_PRIVILEGES, type AccessType, type Privilege } from "@shared/domain";
import type { User } from "../../drizzle/schema";

/**
 * Permission evaluation for a single-owner app. The owner (role "admin") holds every privilege on every job;
 * any other `users` row is a crew record and holds none. The privilege names stay so call sites read clearly.
 */
export type SecurityData = {
  userId: number;
  isAdmin: boolean;
  accessType: AccessType;
  projectIds: number[];
};

const ALL_KEYS = Object.keys(ALL_PRIVILEGES) as Privilege[];

export function ownerSecurity(user: Pick<User, "id" | "role">, projectIds: number[]): SecurityData {
  const isAdmin = user.role === "admin";
  return { userId: user.id, isAdmin, accessType: isAdmin ? "full" : "passive", projectIds: isAdmin ? [...projectIds] : [] };
}

export function effectivePrivileges(sec: SecurityData, _projectId: number | null = null): Set<Privilege> {
  return sec.isAdmin ? new Set(ALL_KEYS) : new Set();
}

export function can(sec: SecurityData, privilege: Privilege, projectId: number | null = null): boolean {
  return effectivePrivileges(sec, projectId).has(privilege);
}

export function visibleProjectIds(sec: SecurityData): number[] {
  return sec.isAdmin ? [...sec.projectIds] : [];
}
