/** Server rules for saves replayed from a device that was offline. */

export type SaveDecision = { action: "insert" } | { action: "update"; id: number } | { action: "done"; id: number } | { error: "conflict" | "not_draft" | "wrong_job" | "missing" };

export const SAVE_ERROR_MESSAGE: Record<"conflict" | "not_draft" | "wrong_job" | "missing", string> = {
  conflict: "This report was changed on another device after this copy was edited. Choose which version to keep.",
  not_draft: "Only draft reports can be edited",
  wrong_job: "Report belongs to another job",
  missing: "This report was deleted on another device.",
};

/**
 * `existing` is the report the save targets: by id, or (for a save with no id) the one an earlier send of the
 * same clientKey created. Every save and every finalize/reopen stamps a new `saveRev` on the report.
 * - `saveRev` equal to the stored one: this exact save was already applied (its answer was lost) → done.
 * - `baseRev` present (even null) and not the stored one: the copy was edited from an older version → conflict.
 * - `baseRev` absent: overwrite (the PM chose "keep mine").
 */
export function saveDecision(a: {
  existing: { id: number; projectId: number; status: string; saveRev: string | null } | null;
  input: { id?: number; projectId: number; clientKey?: string; saveRev?: string; baseRev?: string | null };
}): SaveDecision {
  const { existing, input } = a;
  if (!existing) return input.id ? { error: "missing" } : { action: "insert" };
  if (existing.projectId !== input.projectId) return { error: "wrong_job" };
  if (input.saveRev && existing.saveRev === input.saveRev) return { action: "done", id: existing.id };
  if (existing.status !== "draft") return { error: "not_draft" };
  if (input.baseRev !== undefined && input.baseRev !== existing.saveRev) return { error: "conflict" };
  return { action: "update", id: existing.id };
}
