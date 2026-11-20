import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { eq, sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { localCredentials, users } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { applyResetPassword, pickLoginUser, registrationAllowed } from "./ownerAuth";
import { sdk } from "./sdk";

/**
 * Owner sign-in. TopOut has one login: the owner, created on first run at /api/auth/setup.
 * Crew records live in `users` too but have no credential and can never sign in.
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

async function startSession(req: Request, res: Response, openId: string, name: string, sessionVersion = 0) {
  const token = await sdk.createSessionToken(openId, { name, sessionVersion, expiresInMs: ONE_YEAR_MS });
  res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
}

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

export function registerLocalAuthRoutes(app: Express) {
  /** Whether first-run setup is still open. */
  app.get("/api/auth/status", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store").json({ setupRequired: registrationAllowed({ ownerExists: await ownerExists() }) });
    } catch {
      fail(res, 503, "Database unavailable");
    }
  });

  app.post("/api/auth/login", async (req, res) => {
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
      const owner = row && ok ? pickLoginUser([row.user], row.user.id) : null;
      if (!owner) {
        noteFail(key);
        return fail(res, 401, "Email or password is incorrect.");
      }
      fails.delete(key);
      await d.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, owner.id));
      await startSession(req, res, owner.openId, owner.name ?? "", owner.sessionVersion);
      res.json({ ok: true });
    } catch (e) {
      console.error("[auth] login failed", e instanceof Error ? e.message : e);
      fail(res, 500, "Sign-in failed. Try again.");
    }
  });

  /** First run only: creates the owner. Refused once an owner exists. */
  app.post("/api/auth/setup", async (req, res) => {
    const email = normEmail(req.body?.email);
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!validEmail(email)) return fail(res, 400, "Enter a valid email address.");
    if (password.length < MIN_PASSWORD || password.length > 200) return fail(res, 400, `Password must be at least ${MIN_PASSWORD} characters.`);

    let d: db.Db;
    try {
      d = await db.db();
    } catch {
      return fail(res, 503, "Database unavailable");
    }
    // Serialize so two simultaneous first-run requests cannot both create an owner.
    const conn = await (d.$client as unknown as { promise(): { getConnection(): Promise<LockConn> } }).promise().getConnection();
    try {
      const [[lock]] = (await conn.query("SELECT GET_LOCK('topout_owner_setup', 10) AS ok")) as unknown as [[{ ok: number }]];
      if (!lock?.ok) return fail(res, 503, "Busy. Try again.");
      if (!registrationAllowed({ ownerExists: await ownerExists() })) return fail(res, 403, "This app already has an owner. Sign in instead.");
      const openId = `owner:${randomUUID()}`;
      const passwordHash = await hashPassword(password);
      // Owner row and credential land together or not at all; inserted directly, never linked to a crew record.
      await d.transaction(async tx => {
        const [{ id }] = await tx
          .insert(users)
          .values({ openId, name: name || null, email, loginMethod: "password", role: "admin", accessType: "full", lastSignedIn: new Date() })
          .$returningId();
        await tx.insert(localCredentials).values({ userId: id, email, passwordHash });
      });
      await startSession(req, res, openId, name);
      res.json({ ok: true });
    } catch (e) {
      console.error("[auth] setup failed", e instanceof Error ? e.message : e);
      fail(res, 500, "Could not create the account. Try again.");
    } finally {
      try {
        await conn.query("SELECT RELEASE_LOCK('topout_owner_setup')");
      } catch {}
      conn.release();
    }
  });
}

async function ownerExists(): Promise<boolean> {
  const d = await db.db();
  const [owner] = await d.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  return Boolean(owner);
}

/** Applies OWNER_RESET_PASSWORD (if set) to the owner's credential at startup. */
export async function applyOwnerPasswordReset(): Promise<void> {
  if (!process.env.OWNER_RESET_PASSWORD) return;
  const d = await db.db();
  const [row] = await d
    .select({ userId: localCredentials.userId, hash: localCredentials.passwordHash })
    .from(localCredentials)
    .innerJoin(users, eq(users.id, localCredentials.userId))
    .where(eq(users.role, "admin"))
    .limit(1);
  if (!row) {
    console.warn("[auth] OWNER_RESET_PASSWORD is set but no owner exists yet; ignored");
    return;
  }
  const r = await applyResetPassword(process.env.OWNER_RESET_PASSWORD, row.hash);
  if (r?.changed) {
    await d.transaction(async tx => {
      await tx.update(localCredentials).set({ passwordHash: r.hash }).where(eq(localCredentials.userId, row.userId));
      await tx.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, row.userId));
    });
    console.warn("[auth] owner password reset from OWNER_RESET_PASSWORD");
  }
}

type LockConn = { query(sql: string): Promise<unknown>; release(): void };

// Equalizes timing between "no such email" and "wrong password".
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEY_LEN).toString("base64")}`;
