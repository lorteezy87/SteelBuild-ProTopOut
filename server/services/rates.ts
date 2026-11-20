import { eq } from "drizzle-orm";
import { jobRoles, users } from "../../drizzle/schema";
import { db } from "../db";

/** Cost and bill rate per hour for a crew member: their own override, else their classification's rate, else 0. */
export async function rateFor(userId: number) {
  const d = await db();
  const [u] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
  let cost = u?.costRate ?? null;
  let bill = u?.billRate ?? null;
  if ((cost == null || bill == null) && u?.jobRoleId) {
    const [jr] = await d
      .select()
      .from(jobRoles)
      .where(eq(jobRoles.id, u.jobRoleId))
      .limit(1);
    cost = cost ?? jr?.costRate ?? 0;
    bill = bill ?? jr?.billRate ?? 0;
  }
  return { cost: cost ?? 0, bill: bill ?? 0 };
}
