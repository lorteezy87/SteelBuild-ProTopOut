import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Returns the database or throws; use in request handlers. */
export async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database is not available");
  return d;
}

/**
 * Upsert a signed-in user.
 * - A pre-created user (openId "local:...") with the same email is linked to this login.
 * - The first user ever (or the configured owner) becomes an Admin with Full access.
 */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const d = await db();

  try {
    const existing = await d.select().from(users).where(eq(users.openId, user.openId)).limit(1);

    if (!existing.length && user.email) {
      const placeholder = await d
        .select()
        .from(users)
        .where(and(eq(users.email, user.email), like(users.openId, "local:%")))
        .limit(1);
      if (placeholder.length) {
        await d
          .update(users)
          .set({
            openId: user.openId,
            loginMethod: user.loginMethod ?? null,
            lastSignedIn: user.lastSignedIn ?? new Date(),
            name: placeholder[0].name || user.name || null,
          })
          .where(eq(users.id, placeholder[0].id));
        return;
      }
    }

    if (existing.length) {
      const set: Partial<InsertUser> = { lastSignedIn: user.lastSignedIn ?? new Date() };
      if (user.email !== undefined && !existing[0].email) set.email = user.email;
      if (user.name && !existing[0].name) set.name = user.name;
      if (user.loginMethod !== undefined) set.loginMethod = user.loginMethod;
      if (user.openId === ENV.ownerOpenId && existing[0].role !== "admin") {
        set.role = "admin";
        set.accessType = "full";
      }
      await d.update(users).set(set).where(eq(users.id, existing[0].id));
      return;
    }

    const anyAdmin = await d.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    const makeAdmin = !anyAdmin.length || user.openId === ENV.ownerOpenId;
    await d.insert(users).values({
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      lastSignedIn: user.lastSignedIn ?? new Date(),
      role: makeAdmin ? "admin" : "user",
      accessType: makeAdmin ? "full" : "team_member",
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const d = await getDb();
  if (!d) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  const result = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
