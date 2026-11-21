/** QC logs: field bolting, field welding and special inspections per sequence. Pure rules; the router stores and links. */

export const BOLT_METHODS = {
  snug_tight: "Snug-tight",
  turn_of_nut: "Turn-of-nut",
  calibrated_wrench: "Calibrated wrench",
  twist_off: "Twist-off (TC)",
  dti: "DTI",
} as const;

export const BOLT_GRADES = {
  a325: "A325 / F3125 Gr A325",
  a490: "A490 / F3125 Gr A490",
  f1852: "F1852 (TC)",
  f2280: "F2280 (TC)",
  a307: "A307",
  other: "Other",
} as const;

export const WELD_PROCESSES = { smaw: "SMAW (stick)", fcaw: "FCAW", gmaw: "GMAW", saw: "SAW" } as const;

export const NDT_METHODS = { none: "Visual only", ut: "UT", mt: "MT", pt: "PT", rt: "RT" } as const;

export const QC_RESULTS = { pending: "Pending", pass: "Pass", fail: "Fail" } as const;

export const SI_TYPES = {
  bolting: "High-strength bolting",
  welding: "Field welding",
  deck: "Deck welding / fastening",
  studs: "Shear studs",
  anchor_rods: "Anchor rods",
  other: "Other",
} as const;

export const SI_RESULTS = { requested: "Requested", scheduled: "Scheduled", passed: "Passed", failed: "Failed", na: "Not required" } as const;

export type QcResult = keyof typeof QC_RESULTS;
export type SiResult = keyof typeof SI_RESULTS;
export type QcEntry = { result: QcResult; punchItemId: number | null };

const label = <T extends Record<string, string>>(map: T, key: string) => (map as Record<string, string>)[key] ?? key;

/** A punch item is created once, and only from a failed entry. */
export function canCreatePunch(e: { result: string; punchItemId: number | null }): { ok: true } | { ok: false; reason: string } {
  if (e.punchItemId != null) return { ok: false, reason: "Punch item already created" };
  if (e.result !== "fail" && e.result !== "failed") return { ok: false, reason: "Only failed entries create punch items" };
  return { ok: true };
}

export function boltPunchTitle(e: { location: string; grade: string; method: string }): string {
  return `Bolting deficiency — ${e.location} (${label(BOLT_GRADES, e.grade)}, ${label(BOLT_METHODS, e.method)})`;
}

export function weldPunchTitle(e: { location: string; process: string }): string {
  return `Weld deficiency — ${e.location} (${label(WELD_PROCESSES, e.process)})`;
}

export function inspectionPunchTitle(e: { type: string; reportNumber: string | null }): string {
  return `Special inspection failed — ${label(SI_TYPES, e.type)}${e.reportNumber ? ` (report ${e.reportNumber})` : ""}`;
}

export type SequenceQcStatus = "deficiency" | "pending" | "clear" | "no_records";

export const SEQUENCE_QC_LABEL: Record<SequenceQcStatus, string> = {
  deficiency: "Deficiency",
  pending: "Pending",
  clear: "Clear",
  no_records: "No QC records",
};

/** No records is its own state: absence of a log is not a clean bill. */
export function sequenceQcStatus(input: { bolt: { result: QcResult }[]; weld: { result: QcResult }[]; inspections: { result: SiResult }[] }): SequenceQcStatus {
  const entries = [...input.bolt, ...input.weld];
  if (!entries.length && !input.inspections.length) return "no_records";
  if (entries.some(e => e.result === "fail") || input.inspections.some(i => i.result === "failed")) return "deficiency";
  if (entries.some(e => e.result === "pending") || input.inspections.some(i => i.result === "requested" || i.result === "scheduled")) return "pending";
  return "clear";
}
