import { inArray } from "drizzle-orm";
import { crewCertGaps } from "@shared/certs";
import { certifications, jobRoles, users } from "../../drizzle/schema";
import { db } from "../db";

/**
 * Missing or lapsed required certifications per crew member on a daily report, keyed by userId.
 * The requirement comes from the line's classification, else the person's own. Warns; never blocks.
 */
export async function certGapsFor(lines: { userId: number | null; jobRoleId: number | null }[], onDate: string): Promise<Record<string, string[]>> {
  const ids = [...new Set(lines.map(l => l.userId).filter((x): x is number => x != null))];
  if (!ids.length) return {};
  const d = await db();
  const [people, roles, certs] = await Promise.all([
    d.select({ id: users.id, jobRoleId: users.jobRoleId }).from(users).where(inArray(users.id, ids)),
    d.select({ id: jobRoles.id, requiredCerts: jobRoles.requiredCerts }).from(jobRoles),
    d.select({ userId: certifications.userId, certType: certifications.certType, expiresOn: certifications.expiresOn }).from(certifications).where(inArray(certifications.userId, ids)),
  ]);
  const out: Record<string, string[]> = {};
  for (const l of lines) {
    if (l.userId == null) continue;
    const roleId = l.jobRoleId ?? people.find(p => p.id === l.userId)?.jobRoleId ?? null;
    const required = roles.find(r => r.id === roleId)?.requiredCerts ?? [];
    if (!required.length) continue;
    const gaps = crewCertGaps(required, certs.filter(c => c.userId === l.userId), onDate);
    if (gaps.length) out[String(l.userId)] = gaps;
  }
  return out;
}
