import { describe, expect, it } from "vitest";
import { formatGateRefusal } from "@shared/gate";
import { GateCancelled, setGatePrompter, withGate } from "./gateRetry";

const refusal = new Error(formatGateRefusal({ items: [{ taskId: 0, name: "Seq 1" }], text: "Gate open" }));

describe("withGate", () => {
  it("retries with the reasons the prompt returns", async () => {
    setGatePrompter(async () => ({ "0": "AB survey accepted" }));
    const seen: unknown[] = [];
    const r = await withGate(async reasons => {
      seen.push(reasons);
      if (!reasons) throw refusal;
      return "saved";
    });
    expect(r).toBe("saved");
    expect(seen).toEqual([undefined, { "0": "AB survey accepted" }]);
  });
  it("cancelling throws GateCancelled so inline cells revert", async () => {
    setGatePrompter(async () => null);
    await expect(withGate(async () => { throw refusal; })).rejects.toBeInstanceOf(GateCancelled);
  });
  it("other errors pass through", async () => {
    setGatePrompter(async () => ({}));
    await expect(withGate(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
