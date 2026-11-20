/** Ready-to-erect gate for an erection sequence: what has to be true before the crew hangs steel on it. */

export const GATE_ITEMS = {
  anchor_bolts: "Anchor bolt survey accepted",
  concrete: "Concrete strength / cure",
  site_access: "Site access & laydown",
  crane_pad: "Crane pad / ground bearing",
  steel_on_site: "Steel on site",
  drawings_released: "Drawings released",
  open_rfis: "No open RFIs on sequence",
} as const;
export type GateKey = keyof typeof GATE_ITEMS;
export const GATE_KEYS = Object.keys(GATE_ITEMS) as GateKey[];
export const MANUAL_GATE_KEYS = ["anchor_bolts", "concrete", "site_access", "crane_pad"] as const satisfies readonly GateKey[];
export type ManualGateKey = (typeof MANUAL_GATE_KEYS)[number];
export const isManualGateKey = (k: string): k is ManualGateKey => (MANUAL_GATE_KEYS as readonly string[]).includes(k);

/** met · open · na (doesn't apply; counts as met) · unknown (nobody can tell yet — never shown as met). */
export type GateItemState = "met" | "open" | "na" | "unknown";
export const GATE_STATE_LABELS: Record<GateItemState, string> = { met: "Met", open: "Open", na: "N/A", unknown: "Unknown" };
export type GateStatus = "ready" | "not_ready" | "unknown";
export const GATE_STATUS_LABELS: Record<GateStatus, string> = { ready: "Ready to erect", not_ready: "Not ready", unknown: "Gate unknown" };

export type DerivedKey = "steel_on_site" | "drawings_released" | "open_rfis";

/** The three items the app can read from deliveries, the drawing register and the RFI log. */
export function derivedGate(input: { plannedTons: number; receivedTons: number | null; sheets: { status: string }[]; openRfiCount: number }): Record<DerivedKey, GateItemState> {
  const steel: GateItemState =
    !(input.plannedTons > 0) || input.receivedTons == null ? "unknown" : input.receivedTons >= input.plannedTons - 1e-6 ? "met" : "open";
  const drawings: GateItemState = !input.sheets.length ? "unknown" : input.sheets.every(s => s.status === "REL") ? "met" : "open";
  return { steel_on_site: steel, drawings_released: drawings, open_rfis: input.openRfiCount > 0 ? "open" : "met" };
}

export function gateStatus(items: Record<GateKey, GateItemState>): GateStatus {
  const v = GATE_KEYS.map(k => items[k]);
  if (v.includes("open")) return "not_ready";
  if (v.includes("unknown")) return "unknown";
  return "ready";
}

/** A sequence "starts" when it leaves not_started. */
export function startsSequence(before: { status: string }, after: { status?: string }): boolean {
  return before.status === "not_started" && after.status != null && (after.status === "in_progress" || after.status === "done");
}

/** Sequences this action would start whose gate isn't ready and that have no (non-blank) reason yet. */
export function missingGateReasons(starting: { taskId: number; name: string; status: GateStatus }[], reasons: Record<string, string | undefined>): { taskId: number; name: string }[] {
  return starting.filter(s => s.status !== "ready" && !(reasons[String(s.taskId)] ?? "").trim()).map(s => ({ taskId: s.taskId, name: s.name }));
}

/**
 * The server's refusal when a gate reason is needed: PREFIX + JSON list of sequences + newline + readable text.
 * taskId 0 means "the sequence you are editing" (a single-task update).
 */
export const GATE_REASON_NEEDED = "GATE_REASON_NEEDED";
export type GateRefusal = { items: { taskId: number; name: string }[]; text: string };
export const formatGateRefusal = (r: GateRefusal) => `${GATE_REASON_NEEDED}${JSON.stringify(r.items)}\n${r.text}`;
export function parseGateRefusal(message: string): GateRefusal | null {
  if (!message.startsWith(GATE_REASON_NEEDED)) return null;
  const rest = message.slice(GATE_REASON_NEEDED.length);
  const nl = rest.indexOf("\n");
  try {
    const items = JSON.parse(nl >= 0 ? rest.slice(0, nl) : rest) as GateRefusal["items"];
    return { items: Array.isArray(items) ? items : [], text: nl >= 0 ? rest.slice(nl + 1) : "" };
  } catch {
    return { items: [], text: rest };
  }
}
