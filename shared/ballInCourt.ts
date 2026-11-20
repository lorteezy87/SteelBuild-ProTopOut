/** Who owes the next move on a log item (RFI, CO, submittal, delay notice…). */
export const BALL_IN_COURT = ["us", "gc", "eor", "architect", "fabricator", "other"] as const;
export type BallInCourt = (typeof BALL_IN_COURT)[number];
export const BALL_IN_COURT_LABELS: Record<BallInCourt, string> = {
  us: "Us",
  gc: "GC",
  eor: "EOR",
  architect: "Architect",
  fabricator: "Fabricator",
  other: "Other",
};
export const isBallInCourt = (v: unknown): v is BallInCourt => typeof v === "string" && (BALL_IN_COURT as readonly string[]).includes(v);
