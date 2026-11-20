import { describe, expect, it } from "vitest";
import { GATE_ITEMS, MANUAL_GATE_KEYS, derivedGate, gateStatus, missingGateReasons, startsSequence, type GateItemState, type GateKey } from "@shared/gate";

const all = (s: GateItemState): Record<GateKey, GateItemState> =>
  Object.fromEntries(Object.keys(GATE_ITEMS).map(k => [k, s])) as Record<GateKey, GateItemState>;
const d = (o: Partial<Parameters<typeof derivedGate>[0]>) => derivedGate({ plannedTons: 100, receivedTons: 100, sheets: [{ status: "REL" }], openRfiCount: 0, ...o });

describe("ready-to-erect gate", () => {
  it("has seven items, four of them manual", () => {
    expect(Object.keys(GATE_ITEMS)).toHaveLength(7);
    expect(MANUAL_GATE_KEYS).toEqual(["anchor_bolts", "concrete", "site_access", "crane_pad"]);
  });
  it("steel on site needs received tons at least planned", () => {
    expect(d({}).steel_on_site).toBe("met");
    expect(d({ receivedTons: 60 }).steel_on_site).toBe("open");
    expect(d({ plannedTons: 0, receivedTons: 50 }).steel_on_site).toBe("unknown");
    expect(d({ receivedTons: null }).steel_on_site).toBe("unknown");
  });
  it("drawings released needs every sheet REL", () => {
    expect(d({ sheets: [] }).drawings_released).toBe("unknown");
    expect(d({ sheets: [{ status: "REL" }, { status: "REL" }] }).drawings_released).toBe("met");
    expect(d({ sheets: [{ status: "REL" }, { status: "HOLD" }] }).drawings_released).toBe("open");
  });
  it("open RFIs keep the item open", () => {
    expect(d({ openRfiCount: 0 }).open_rfis).toBe("met");
    expect(d({ openRfiCount: 2 }).open_rfis).toBe("open");
  });
  it("any open item makes the gate not ready", () => {
    expect(gateStatus({ ...all("met"), concrete: "open", crane_pad: "unknown" })).toBe("not_ready");
  });
  it("unknown without open is unknown", () => {
    expect(gateStatus({ ...all("met"), steel_on_site: "unknown" })).toBe("unknown");
  });
  it("na counts as met", () => {
    expect(gateStatus({ ...all("met"), crane_pad: "na" })).toBe("ready");
  });
  it("starting means leaving not_started", () => {
    expect(startsSequence({ status: "not_started" }, { status: "in_progress" })).toBe(true);
    expect(startsSequence({ status: "not_started" }, { status: "done" })).toBe(true);
    expect(startsSequence({ status: "in_progress" }, { status: "done" })).toBe(false);
    expect(startsSequence({ status: "not_started" }, { status: "not_started" })).toBe(false);
    expect(startsSequence({ status: "not_started" }, {})).toBe(false);
  });
  it("finalize needs a reason for each not-ready sequence", () => {
    const starting = [
      { taskId: 1, name: "Seq 1", status: "not_ready" as const },
      { taskId: 2, name: "Seq 2", status: "unknown" as const },
      { taskId: 3, name: "Seq 3", status: "ready" as const },
    ];
    expect(missingGateReasons(starting, { "1": "AB survey verbally accepted by GC" })).toEqual([{ taskId: 2, name: "Seq 2" }]);
    expect(missingGateReasons(starting, { "1": "  ", "2": "ok per super" })).toEqual([{ taskId: 1, name: "Seq 1" }]);
    expect(missingGateReasons(starting, { "1": "a reason", "2": "b reason" })).toEqual([]);
  });
});

import { formatGateRefusal, parseGateRefusal } from "@shared/gate";
describe("gate refusal message", () => {
  it("round-trips the sequences and keeps readable text", () => {
    const m = formatGateRefusal({ items: [{ taskId: 4, name: "Seq 2 — Level 2" }], text: "Ready-to-erect gate is open for Seq 2." });
    expect(parseGateRefusal(m)).toEqual({ items: [{ taskId: 4, name: "Seq 2 — Level 2" }], text: "Ready-to-erect gate is open for Seq 2." });
    expect(parseGateRefusal("Report is already final")).toBeNull();
  });
});
