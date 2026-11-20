import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "../shared/const";

const ROOT = path.resolve(import.meta.dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", ".superpowers", "docs"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|html|json)$/.test(e.name) && !/(platform|brand)\.test\.ts$/.test(e.name) && e.name !== "pnpm-lock.yaml") out.push(p);
  }
  return out;
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("platform", () => {
  it("sessions are bound to TopOut and the session secret", async () => {
    vi.stubEnv("SESSION_SECRET", "unit-test-signing-key-never-deployed");
    const token = await sdk.signSession({ openId: "owner", appId: "topout", name: "" });
    expect(await sdk.verifySession(token)).toMatchObject({ openId: "owner" });
    const foreign = await sdk.signSession({ openId: "owner", appId: "other-app", name: "" });
    expect(await sdk.verifySession(foreign)).toBeNull();
    vi.stubEnv("SESSION_SECRET", "a-different-signing-key-entirely");
    expect(await sdk.verifySession(token)).toBeNull();
  });

  it("unknown session user is rejected without any network call", async () => {
    vi.stubEnv("SESSION_SECRET", "unit-test-signing-key-never-deployed");
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const token = await sdk.createSessionToken("ghost");
    const req = { headers: { cookie: `${COOKIE_NAME}=${token}` }, path: "/api/trpc/auth.me" } as never;
    await expect(sdk.authenticateRequest(req)).rejects.toThrow("User not found");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("session cookie is first-party", () => {
    expect(getSessionCookieOptions({ protocol: "https", headers: {} } as never)).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("no Manus platform code remains", () => {
    // Storage moves to R2-only in Phase 1 Task 7, which removes this exemption.
    const PENDING = ["server/storage.ts", "server/storageR2.ts", "scripts/drawings-e2e.ts"];
    const hits = walk(ROOT).filter(f => /MANUS_|__MANUS_CONFIG__|manus-storage|manuscdn|webdev\.v1/.test(fs.readFileSync(f, "utf8"))).map(f => path.relative(ROOT, f)).filter(f => !PENDING.includes(f));
    expect(hits).toEqual([]);
  });
});
