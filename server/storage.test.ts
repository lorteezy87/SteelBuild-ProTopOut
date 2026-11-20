import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: async () => { if (!auth.user) throw new Error("no session"); return auth.user; } },
}));

const { registerStorageRoute } = await import("./storageR2");

let base = "";
let close: () => void = () => {};
beforeEach(async () => {
  vi.stubEnv("R2_ACCOUNT_ID", "acct123");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIAFAKE");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "fake-secret");
  vi.stubEnv("R2_BUCKET", "topout-files");
  const app = express();
  registerStorageRoute(app);
  const server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterEach(() => { close(); vi.unstubAllEnvs(); auth.user = null; });

const get = (path: string) => fetch(base + path, { redirect: "manual" });

describe("file storage route", () => {
  it("storage route requires owner session", async () => {
    expect((await get("/files/drawings/1/a.pdf")).status).toBe(401);
    auth.user = { id: 2, role: "user", isActive: true };
    expect((await get("/files/drawings/1/a.pdf")).status).toBe(401);
    auth.user = { id: 1, role: "admin", isActive: true };
    const res = await get("/files/drawings/1/a.pdf");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(loc.pathname).toBe("/topout-files/drawings/1/a.pdf");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects traversal", async () => {
    auth.user = { id: 1, role: "admin", isActive: true };
    expect((await get("/files/..%2Fx")).status).toBe(400);
  });
});

describe("storagePut", () => {
  it("returns a /files URL", async () => {
    const send = vi.fn().mockResolvedValue({});
    vi.doMock("@aws-sdk/client-s3", async orig => ({ ...(await orig<typeof import("@aws-sdk/client-s3")>()), S3Client: class { send = send; } }));
    vi.resetModules();
    const { storagePut } = await import("./storage");
    const r = await storagePut("drawings/1/sheet.pdf", Buffer.from("%PDF"), "application/pdf");
    expect(r.url).toBe(`/files/${r.key}`);
    expect(r.key).toMatch(/^drawings\/1\/sheet_[0-9a-f]{8}\.pdf$/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
