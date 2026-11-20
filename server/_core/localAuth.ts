import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { and, eq, like, sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { localCredentials, users } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

/**
 * Email + password sign-in for self-hosted deployments (e.g. Railway), where Manus OAuth is unavailable.
 *
 * Registration is closed by default:
 *  - the very first account (no admin exists yet) may register and becomes Admin / Full access;
 *  - afterwards only people an admin pre-created (Admin → Users, by email) can claim their account.
 * Sessions reuse the existing signed session cookie, so every server-side access check is unchanged.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;
export const MIN_PASSWORD = 10;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEY_LEN);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
const validEmail = (e: string) => e.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Simple in-memory throttle: 10 failed attempts per email+IP per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { n: number; until: number }>();
const throttleKey = (req: Request, email: string) => `${req.ip}|${email}`;
function throttled(key: string) {
  const f = fails.get(key);
  if (!f) return false;
  if (Date.now() > f.until) {
    fails.delete(key);
    return false;
  }
  return f.n >= MAX_FAILS;
}
function noteFail(key: string) {
  const f = fails.get(key);
  if (!f || Date.now() > f.until) fails.set(key, { n: 1, until: Date.now() + WINDOW_MS });
  else f.n++;
}

async function startSession(req: Request, res: Response, openId: string, name: string) {
  const token = await sdk.createSessionToken(openId, { name, expiresInMs: ONE_YEAR_MS });
  res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
}

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

export function registerLocalAuthRoutes(app: Express) {
  /** Tells the sign-in screen whether this is a fresh install (first account becomes admin). */
  app.get("/api/auth/local/status", async (_req, res) => {
    try {
      const d = await db.db();
      const [admin] = await d.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      res.set("Cache-Control", "no-store").json({ setupRequired: !admin });
    } catch {
      fail(res, 503, "Database unavailable");
    }
  });

  app.post("/api/auth/local/login", async (req, res) => {
    const email = normEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) return fail(res, 400, "Enter your email and password.");
    const key = throttleKey(req, email);
    if (throttled(key)) return fail(res, 429, "Too many attempts. Try again in 15 minutes.");
    try {
      const d = await db.db();
      const [row] = await d
        .select({ hash: localCredentials.passwordHash, user: users })
        .from(localCredentials)
        .innerJoin(users, eq(users.id, localCredentials.userId))
        .where(eq(localCredentials.email, email))
        .limit(1);
      const ok = row ? await verifyPassword(password, row.hash) : await verifyPassword(password, DUMMY_HASH).then(() => false);
      if (!row || !ok) {
        noteFail(key);
        return fail(res, 401, "Email or password is incorrect.");
      }
      if (!row.user.isActive || row.user.accessType === "passive") {
        return fail(res, 403, "This account is not allowed to sign in. Ask your administrator.");
      }
      fails.delete(key);
      await d.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, row.user.id));
      await startSession(req, res, row.user.openId, row.user.name ?? "");
      res.json({ ok: true });
    } catch (e) {
      console.error("[LocalAuth] login failed", e instanceof Error ? e.message : e);
      fail(res, 500, "Sign-in failed. Try again.");
    }
  });

  app.post("/api/auth/local/register", async (req, res) => {
    const email = normEmail(req.body?.email);
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!validEmail(email)) return fail(res, 400, "Enter a valid email address.");
    if (password.length < MIN_PASSWORD || password.length > 200) return fail(res, 400, `Password must be at least ${MIN_PASSWORD} characters.`);
    const key = throttleKey(req, email);
    if (throttled(key)) return fail(res, 429, "Too many attempts. Try again in 15 minutes.");

    let d: db.Db;
    try {
      d = await db.db();
    } catch {
      return fail(res, 503, "Database unavailable");
    }
    // Serialize registrations so two simultaneous first sign-ups cannot both become admin.
    const conn = await (d.$client as unknown as { promise(): { getConnection(): Promise<LockConn> } }).promise().getConnection();
    try {
      const [[lock]] = (await conn.query("SELECT GET_LOCK('topout_owner_setup', 10) AS ok")) as unknown as [[{ ok: number }]];
      if (!lock?.ok) return fail(res, 503, "Busy. Try again.");

      const [existingCred] = await d.select({ id: localCredentials.userId }).from(localCredentials).where(eq(localCredentials.email, email)).limit(1);
      if (existingCred) {
        noteFail(key);
        return fail(res, 409, "An account with this email already exists. Sign in instead.");
      }
      const [admin] = await d.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      const [invited] = await d
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email}`, like(users.openId, "local:%")))
        .limit(1);
      if (admin && !invited) {
        noteFail(key);
        return fail(res, 403, "Sign-up is by invitation. Ask your administrator to add your email under Admin → Users.");
      }
      if (invited && (!invited.isActive || invited.accessType === "passive")) {
        return fail(res, 403, "This account is not allowed to sign in. Ask your administrator.");
      }

      const openId = `pw:${randomUUID()}`;
      // upsertUser links a pre-created ("local:") user by email, or creates the first user as Admin.
      await db.upsertUser({ openId, name: name || null, email, loginMethod: "password", lastSignedIn: new Date() });
      const user = await db.getUserByOpenId(openId);
      if (!user) throw new Error("user not created");
      await d.insert(localCredentials).values({ userId: user.id, email, passwordHash: await hashPassword(password) });
      fails.delete(key);
      await startSession(req, res, user.openId, user.name ?? "");
      res.json({ ok: true, admin: user.role === "admin" });
    } catch (e) {
      console.error("[LocalAuth] register failed", e instanceof Error ? e.message : e);
      fail(res, 500, "Could not create the account. Try again.");
    } finally {
      try {
        await conn.query("SELECT RELEASE_LOCK('topout_owner_setup')");
      } catch {}
      conn.release();
    }
  });
}

type LockConn = { query(sql: string): Promise<unknown>; release(): void };

// Equalizes timing between "no such email" and "wrong password".
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEY_LEN).toString("base64")}`;
