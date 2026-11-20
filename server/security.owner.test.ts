import { describe, expect, it, vi } from "vitest";
import { ALL_PRIVILEGES, type Privilege } from "@shared/domain";
import { can, ownerSecurity, visibleProjectIds } from "./security/access";
import { protectedProcedure, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

vi.mock("./bootstrap", () => ({ ensureBootstrap: async () => {} }));

const owner = { id: 1, role: "admin", isActive: true, accessType: "full" } as const;

describe("single-owner permissions", () => {
  it("owner has every privilege", () => {
    const s = ownerSecurity(owner as never, [1, 2]);
    for (const p of Object.keys(ALL_PRIVILEGES) as Privilege[]) expect(can(s, p, 1)).toBe(true);
    expect(visibleProjectIds(s)).toEqual([1, 2]);
  });

  it("a non-owner record has no privileges", () => {
    const s = ownerSecurity({ ...owner, role: "user" } as never, [1, 2]);
    expect(can(s, "project.view", 1)).toBe(false);
    expect(visibleProjectIds(s)).toEqual([]);
  });

  it("non-owner cannot pass requireUser", async () => {
    const r = router({ ping: protectedProcedure.query(() => "pong") });
    const ctx = (role: string) => ({ req: {}, res: {}, user: { ...owner, role } }) as unknown as TrpcContext;
    await expect(r.createCaller(ctx("user")).ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(r.createCaller(ctx("admin")).ping()).resolves.toBe("pong");
  });
});
