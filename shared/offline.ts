/** Server rules for saves replayed from a device that was offline. */

export type SaveDecision = { action: "insert" } | { action: "update"; id: number } | { error: "conflict" | "not_draft" | "wrong_job" | "missing" };

export const SAVE_ERROR_MESSAGE: Record<"conflict" | "not_draft" | "wrong_job" | "missing", string> = {
  conflict: "This report was changed on another device after this copy was edited. Choose which version to keep.",
  not_draft: "Only draft reports can be edited",
  wrong_job: "Report belongs to another job",
  missing: "This report was deleted on another device.",
};

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * `existing` is the report the save targets: by id, or (for a save with no id) the one an earlier send of the
 * same clientKey created. A base version older than the stored one is a conflict; no base version overwrites.
 */
export function saveDecision(a: {
  existing: { id: number; projectId: number; status: string; updatedAt: Date } | null;
  input: { id?: number; projectId: number; clientKey?: string; baseUpdatedAt?: Date | null };
}): SaveDecision {
  const { existing, input } = a;
  if (!existing) return input.id ? { error: "missing" } : { action: "insert" };
  if (existing.projectId !== input.projectId) return { error: "wrong_job" };
  if (existing.status !== "draft") return { error: "not_draft" };
  if (input.baseUpdatedAt && seconds(input.baseUpdatedAt) !== seconds(existing.updatedAt)) return { error: "conflict" };
  return { action: "update", id: existing.id };
}
