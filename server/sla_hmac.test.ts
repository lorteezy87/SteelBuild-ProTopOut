import { describe, expect, it } from "vitest";
import { computeSla, endOfDayInTz, slaStatusAt } from "./services/wf";
import { signPayload, verifySignature } from "./webhooks/dispatcher";
import { createHmac } from "node:crypto";

type Policy = Parameters<typeof computeSla>[1][number];

const policy = (p: Partial<Policy>): Policy =>
  ({ id: 1, appId: 1, stateId: 10, priority: null, source: "hours", hours: 48, atRiskPct: 75, action: "mark_delayed", toStateId: null, ...p }) as Policy;

describe("workflow SLA", () => {
  const entered = new Date("2026-11-02T15:00:00Z");
  const base = { stateId: 10, priority: "normal", stateEnteredAt: entered, createdAt: entered, dueDate: null as string | null };

  it("hours policy: due = entered + hours, at-risk at 75% of the span", () => {
    const r = computeSla(base, [policy({})], 72, "America/Phoenix");
    expect(r.slaDueAt?.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(r.slaAtRiskAt?.toISOString()).toBe("2026-11-04T03:00:00.000Z");
    expect(r.policyId).toBe(1);
  });

  it("priority-specific policy wins over the generic one", () => {
    const r = computeSla({ ...base, priority: "high" }, [policy({ id: 1 }), policy({ id: 2, priority: "high", hours: 8 })], 72, "America/Phoenix");
    expect(r.policyId).toBe(2);
    expect(r.slaDueAt?.toISOString()).toBe("2026-11-02T23:00:00.000Z");
  });

  it("project_notice policy uses the job's contractual notice hours from creation", () => {
    const r = computeSla(base, [policy({ source: "project_notice" })], 48, "America/Phoenix");
    expect(r.slaDueAt?.toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });

  it("due_date policy ends at 23:59:59 local time in the org time zone", () => {
    const r = computeSla({ ...base, dueDate: "2026-11-09" }, [policy({ source: "due_date" })], 72, "America/Phoenix");
    // Phoenix is UTC-7 year-round
    expect(r.slaDueAt?.toISOString()).toBe("2026-11-10T06:59:59.000Z");
    expect(endOfDayInTz("2026-07-01", "America/Phoenix").toISOString()).toBe("2026-07-02T06:59:59.000Z");
  });

  it("no policy for the state → no clock", () => {
    const r = computeSla({ ...base, stateId: 99 }, [policy({})], 72, "America/Phoenix");
    expect(r).toEqual({ slaDueAt: null, slaAtRiskAt: null, policyId: null });
  });

  it("status transitions ok → at_risk → delayed", () => {
    const due = new Date("2026-11-04T15:00:00Z");
    const risk = new Date("2026-11-04T03:00:00Z");
    expect(slaStatusAt(new Date("2026-11-03T00:00:00Z"), due, risk)).toBe("ok");
    expect(slaStatusAt(new Date("2026-11-04T05:00:00Z"), due, risk)).toBe("at_risk");
    expect(slaStatusAt(new Date("2026-11-04T15:00:00Z"), due, risk)).toBe("delayed");
    expect(slaStatusAt(new Date(), null, null)).toBe("ok");
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const ts = "1793900000";
  const body = JSON.stringify({ event: "logItem.update", data: { id: 1 } });

  it("signs hex(HMAC-SHA256(secret, `${timestamp}.${body}`))", () => {
    const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(signPayload(secret, ts, body)).toBe(expected);
  });

  it("verifies valid signatures and rejects tampering", () => {
    const sig = signPayload(secret, ts, body);
    expect(verifySignature(secret, ts, body, sig)).toBe(true);
    expect(verifySignature(secret, ts, body + " ", sig)).toBe(false);
    expect(verifySignature(secret, "1793900001", body, sig)).toBe(false);
    expect(verifySignature("other", ts, body, sig)).toBe(false);
    expect(verifySignature(secret, ts, body, "abc")).toBe(false);
  });
});
