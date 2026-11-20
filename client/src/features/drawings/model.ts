import type { Tone } from "@/components/brand/Status";
import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { SHEET_STATUSES, type MatrixCell, type SheetStatus } from "@shared/drawings";

export type Register = RouterOutputs["drawings"]["register"];
export type Sheet = Register["sheets"][number];
export type Rev = Sheet["revs"][number];
export type DSet = Register["sets"][number];
export type SetIssue = Register["issues"][number];


export const STATUS_TONE: Record<SheetStatus, Tone> = { REL: "green", REV: "blue", RR: "amber", HOLD: "hazard", DET: "gray" };
export const statusLabel = (s: string) => SHEET_STATUSES[s as SheetStatus] ?? s;

export const REV_TONE: Record<string, Tone> = { draft: "amber", checked: "blue", issued: "green", superseded: "gray" };

export const MATRIX_TONE: Record<MatrixCell, Tone> = { "—": "gray", HOLD: "hazard", RR: "amber", LATE: "red", REV: "blue", DET: "gray", REL: "green" };

/** Revisions the shared rules read (they only need number, state and the drawing). */
export const revsOf = (x: Pick<Sheet, "revs">) => x.revs.map(r => ({ number: r.number, state: r.state, hasFile: !!r.url, url: r.url, issuedAt: r.issuedAt }));

/** "R2", or "—" while no revision is issued. */
export const revLabel = (x: Pick<Sheet, "currentRev">) => (x.currentRev == null ? "—" : `R${x.currentRev}`);

/** Everything a drawings mutation should refresh. */
export function useDrawingsRefresh(projectId: number) {
  const utils = trpc.useUtils();
  return () =>
    Promise.all([utils.drawings.register.invalidate({ projectId }), utils.drawings.history.invalidate(), utils.collab.activity.invalidate()]);
}
