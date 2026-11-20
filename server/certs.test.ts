import { describe, expect, it } from "vitest";
import { CERT_TYPES, certStatus, crewCertGaps } from "@shared/certs";
import { todaySummary } from "@shared/today";

const today = "2026-11-20";

describe("certification status", () => {
  it("expiring type with no date is unknown, not current", () => {
    expect(certStatus({ certType: "nccco_operator", expiresOn: null }, today)).toBe("unknown");
  });
  it("OSHA cards never expire", () => {
    expect(certStatus({ certType: "osha30", expiresOn: null }, today)).toBe("no_expiry");
    expect(CERT_TYPES.osha10.expires).toBe(false);
  });
  it("expiry boundaries", () => {
    const s = (expiresOn: string) => certStatus({ certType: "cpr_first_aid", expiresOn }, today);
    expect(s("2026-11-19")).toBe("expired");
    expect(s("2026-11-20")).toBe("expiring");
    expect(s("2026-12-20")).toBe("expiring");
    expect(s("2026-12-21")).toBe("current");
  });
});

describe("required certs on a daily report", () => {
  it("required cert gaps on the report date", () => {
    expect(crewCertGaps(["nccco_operator", "osha10"], [{ certType: "nccco_operator", expiresOn: "2026-11-10" }], today)).toEqual([
      "NCCCO Crane Operator",
      "OSHA 10",
    ]);
    expect(crewCertGaps(["nccco_operator", "osha10"], [{ certType: "nccco_operator", expiresOn: null }], today)).toEqual([
      "NCCCO Crane Operator (expiry unknown)",
      "OSHA 10",
    ]);
    expect(
      crewCertGaps(["nccco_operator"], [{ certType: "nccco_operator", expiresOn: "2026-11-01" }, { certType: "nccco_operator", expiresOn: "2031-01-01" }], today)
    ).toEqual([]);
  });
});

describe("Today: certifications due", () => {
  it("Today lists expired, expiring and unknown certs", () => {
    const r = todaySummary({
      today,
      sequences: [],
      deliveries: [],
      logs: [],
      certs: [
        { id: 1, userId: 5, name: "Ana", certType: "nccco_rigger1", expiresOn: "2027-06-01" },
        { id: 2, userId: 5, name: "Ana", certType: "nccco_operator", expiresOn: null },
        { id: 3, userId: 6, name: "Bo", certType: "cpr_first_aid", expiresOn: "2026-11-01" },
        { id: 4, userId: 6, name: "Bo", certType: "osha30", expiresOn: null },
      ],
    });
    expect(r.certsDue.map(c => c.id)).toEqual([3, 2]);
    expect(r.certsDue[0]).toMatchObject({ label: "Bo · CPR / First Aid", status: "expired", date: "2026-11-01" });
  });
});
