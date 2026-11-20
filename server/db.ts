import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { users } from "../drizzle/schema";

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

export async function getUserByOpenId(openId: string) {
  const d = await getDb();
  if (!d) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  const result = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
