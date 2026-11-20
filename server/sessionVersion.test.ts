import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock("./db", () => ({ getUserByOpenId: async () => store.user }));
const { sdk } = await import("./_core/sdk");
const { COOKIE_NAME } = await import("../shared/const");

beforeEach(() => vi.stubEnv("SESSION_SECRET", "unit-test-signing-key-never-deployed-xx"));
afterEach(() => { vi.unstubAllEnvs(); store.user = null; });
const req = (token: string) => ({ headers: { cookie: `${COOKIE_NAME}=${token}` }, path: "/" }) as never;

describe("session version", () => {
  it("a session issued before a password change no longer authenticates", async () => {
    store.user = { id: 1, openId: "owner:1", role: "admin", isActive: true, sessionVersion: 0 };
    const old = await sdk.createSessionToken("owner:1", { sessionVersion: 0 });
    await expect(sdk.authenticateRequest(req(old))).resolves.toMatchObject({ id: 1 });
    store.user = { ...store.user, sessionVersion: 1 };
    await expect(sdk.authenticateRequest(req(old))).rejects.toThrow("Session expired");
    const fresh = await sdk.createSessionToken("owner:1", { sessionVersion: 1 });
    await expect(sdk.authenticateRequest(req(fresh))).resolves.toMatchObject({ id: 1 });
  });
});
