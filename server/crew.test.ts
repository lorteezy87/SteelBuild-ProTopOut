import { describe, expect, it } from "vitest";
import { crewInsertValues, crewUpdateSet } from "./services/crew";

describe("crew records", () => {
  it("are created as non-login people", () => {
    const v = crewInsertValues({ name: "Ray Ortiz", jobRoleId: 3, costRate: null, billRate: null, phone: "602-555-0101" });
    expect(v.role).toBe("user");
    expect(v.accessType).toBe("passive");
    expect(v.openId.startsWith("crew:")).toBe(true);
    expect(v.loginMethod).toBeNull();
    expect(v.email).toBeNull();
  });

  it("cannot be promoted or given a login by update", () => {
    const set = crewUpdateSet({ name: "Ray", role: "admin", accessType: "full", email: "ray@x.com", openId: "owner:1", isActive: false } as never);
    expect(set).toEqual({ name: "Ray", isActive: false });
  });

  it("owner record is not editable from the crew screen", () => {
    expect(() => crewUpdateSet({ name: "x" }, { role: "admin" })).toThrow("The owner is managed under Account");
  });
});
