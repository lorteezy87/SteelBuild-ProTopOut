import { describe, expect, it } from "vitest";
import { applyResetPassword, pickLoginUser, registrationAllowed } from "./_core/ownerAuth";
import { hashPassword, verifyPassword } from "./_core/localAuth";

describe("owner auth policy", () => {
  it("registration is closed once an owner exists", () => {
    expect(registrationAllowed({ ownerExists: false })).toBe(true);
    expect(registrationAllowed({ ownerExists: true })).toBe(false);
  });

  it("reset applies only when env set", async () => {
    const current = await hashPassword("old-password-123");
    expect(await applyResetPassword(undefined, current)).toBeNull();
    expect(await applyResetPassword("", current)).toBeNull();
    const r = await applyResetPassword("new-pass-123456", current);
    expect(r?.changed).toBe(true);
    expect(await verifyPassword("new-pass-123456", r!.hash)).toBe(true);
    await expect(applyResetPassword("short", current)).rejects.toThrow("OWNER_RESET_PASSWORD must be at least 10 characters");
  });

  it("reset is a no-op when the password already matches", async () => {
    const current = await hashPassword("same-password-1");
    const r = await applyResetPassword("same-password-1", current);
    expect(r?.changed).toBe(false);
  });

  it("login only matches the owner credential", () => {
    const users = [
      { id: 1, role: "admin" as const },
      { id: 2, role: "user" as const },
    ];
    expect(pickLoginUser(users, 1)?.id).toBe(1);
    expect(pickLoginUser(users, 2)).toBeNull();
    expect(pickLoginUser(users, 99)).toBeNull();
  });
});

import { changePasswordError } from "./_core/ownerAuth";
describe("change password", () => {
  it("rejects a wrong current password", () => {
    expect(changePasswordError({ currentOk: false, next: "brand-new-pass-1" })).toBe("Current password is incorrect.");
  });
  it("rejects a short new password", () => {
    expect(changePasswordError({ currentOk: true, next: "short" })).toBe("New password must be at least 10 characters.");
  });
  it("accepts a valid change", () => {
    expect(changePasswordError({ currentOk: true, next: "brand-new-pass-1" })).toBeNull();
  });
});
