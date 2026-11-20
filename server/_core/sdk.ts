import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

/** Signed session cookie for the owner. No external identity provider. */

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export type SessionPayload = { openId: string; appId: string; name: string; sv?: number };
export type AuthenticatedUser = User;

class SessionService {
  private secret() {
    const secret = ENV.cookieSecret;
    if (!secret) throw new Error("SESSION_SECRET is not set");
    return new TextEncoder().encode(secret);
  }

  async createSessionToken(openId: string, options: { expiresInMs?: number; name?: string; sessionVersion?: number } = {}): Promise<string> {
    return this.signSession({ openId, appId: ENV.appId, name: options.name || "", sv: options.sessionVersion ?? 0 }, options);
  }

  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}): Promise<string> {
    const exp = Math.floor((Date.now() + (options.expiresInMs ?? ONE_YEAR_MS)) / 1000);
    return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name, sv: payload.sv ?? 0 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(exp)
      .sign(this.secret());
  }

  async verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret(), { algorithms: ["HS256"] });
      const { openId, appId, name, sv } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || appId !== ENV.appId || typeof name !== "string") return null;
      return { openId, appId, name, sv: typeof sv === "number" ? sv : 0 };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    let token = parseCookieHeader(req.headers.cookie ?? "")[COOKIE_NAME];
    if (!token) {
      const h = req.headers.authorization;
      if (typeof h === "string" && h.startsWith("Bearer ")) token = h.slice(7);
    }
    const session = await this.verifySession(token);
    if (!session) throw ForbiddenError("Invalid session cookie");
    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("User not found");
    if ((session.sv ?? 0) !== (user.sessionVersion ?? 0)) throw ForbiddenError("Session expired");
    return user;
  }
}

export const sdk = new SessionService();
