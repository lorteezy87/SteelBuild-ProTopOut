import type { CookieOptions, Request } from "express";

/** First-party session cookie. TopOut is served over HTTPS in production; browsers treat localhost as secure. */
export function getSessionCookieOptions(_req: Request): CookieOptions {
  return { httpOnly: true, path: "/", sameSite: "lax", secure: true };
}
