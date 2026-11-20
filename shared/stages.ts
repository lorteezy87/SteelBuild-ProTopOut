/** Erection stages of a sequence. "Set" (hung) is the original erected quantity, so every Phase 1 reader keeps meaning "hung". */

export const STAGES = { set: "Set (hung)", plumbed: "Plumbed", bolted: "Bolted-up", final: "Detailed-out / Final" } as const;
export type Stage = keyof typeof STAGES;
export const STAGE_KEYS = Object.keys(STAGES) as Stage[];
export const isStage = (x: unknown): x is Stage => typeof x === "string" && x in STAGES;

/** Short column labels for tables. */
export const STAGE_SHORT: Record<Stage, string> = { set: "Set", plumbed: "Plumbed", bolted: "Bolted", final: "Final" };

type TonsCol = "erectedTons" | "plumbedTons" | "boltedTons" | "finalTons";
type PiecesCol = "erectedPieces" | "plumbedPieces" | "boltedPieces" | "finalPieces";
export type StageQty = Record<TonsCol, number> & Record<PiecesCol, number>;

const COLS: Record<Stage, { tons: TonsCol; pieces: PiecesCol }> = {
  set: { tons: "erectedTons", pieces: "erectedPieces" },
  plumbed: { tons: "plumbedTons", pieces: "plumbedPieces" },
  bolted: { tons: "boltedTons", pieces: "boltedPieces" },
  final: { tons: "finalTons", pieces: "finalPieces" },
};
export const stageColumns = (s: Stage) => COLS[s];

/** Percent of plan reached at a stage; null when nothing is planned (unknown, not 0). */
export function stagePercent(t: StageQty & { plannedTons: number; plannedPieces: number }, stage: Stage, by: "tonnage" | "pieces"): number | null {
  const c = COLS[stage];
  const planned = by === "tonnage" ? t.plannedTons : t.plannedPieces;
  if (!(planned > 0)) return null;
  const done = by === "tonnage" ? t[c.tons] : t[c.pieces];
  return Math.min(100, Math.max(0, (done / planned) * 100));
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** A later stage can't really exceed the one before it; flag it, don't block it (the PM may be catching up an earlier report). */
export function stageWarnings(t: StageQty): string[] {
  const out: string[] = [];
  for (let i = 1; i < STAGE_KEYS.length; i++) {
    const prev = STAGE_KEYS[i - 1];
    const cur = STAGE_KEYS[i];
    const a = t[COLS[cur].tons];
    const b = t[COLS[prev].tons];
    if (a > b + 1e-6) out.push(`${STAGE_SHORT[cur]} ${fmt(a)} t exceeds ${STAGE_SHORT[prev]} ${fmt(b)} t`);
  }
  return out;
}

/** Percent for a sequence: a done sequence is 100 % (status wins), otherwise the chosen stage's percent. */
export function sequencePercent(t: StageQty & { plannedTons: number; plannedPieces: number; status: string }, stage: Stage, by: "tonnage" | "pieces"): number | null {
  if (t.status === "done") return 100;
  return stagePercent(t, stage, by);
}
