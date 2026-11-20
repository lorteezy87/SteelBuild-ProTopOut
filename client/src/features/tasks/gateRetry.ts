import { parseGateRefusal, type GateRefusal } from "@shared/gate";

/**
 * Starting a sequence whose ready-to-erect gate isn't ready needs a reason. The server refuses with a
 * GATE_REASON_NEEDED message; withGate asks the mounted prompt (GateReasonHost) and retries with the reasons.
 */
export type GatePrompter = (r: GateRefusal) => Promise<Record<string, string> | null>;
let prompter: GatePrompter | null = null;
export const setGatePrompter = (p: GatePrompter | null) => {
  prompter = p;
};

/** Thrown when the PM cancels the reason prompt, so callers (inline cells, finalize) revert instead of keeping unsaved values. */
export class GateCancelled extends Error {
  constructor() {
    super("Not started — a reason is needed while the ready-to-erect gate is open.");
    this.name = "GateCancelled";
  }
}

const messageOf = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "");
export const isGateRefusal = (e: unknown) => parseGateRefusal(messageOf(e)) != null;

export async function withGate<T>(run: (reasons?: Record<string, string>) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const g = parseGateRefusal(messageOf(e));
    if (!g || !prompter) throw e;
    const reasons = await prompter(g);
    if (!reasons) throw new GateCancelled();
    return await run(reasons);
  }
}
