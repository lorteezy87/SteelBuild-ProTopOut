import { describe, expect, it } from "vitest";
import { hashPassword, normEmail, verifyPassword } from "./_core/localAuth";

describe("local password auth", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterY", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });
  it("salts each hash", async () => {
    expect(await hashPassword("same-password-1")).not.toBe(await hashPassword("same-password-1"));
  });
  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plain")).toBe(false);
    expect(await verifyPassword("x", "md5$a$b")).toBe(false);
  });
  it("normalizes emails", () => {
    expect(normEmail("  PM@Example.COM ")).toBe("pm@example.com");
    expect(normEmail(42)).toBe("");
  });
});
