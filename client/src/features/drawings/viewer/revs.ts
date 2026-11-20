/** Which revision of a sheet the viewer shows, and the job's sheets in register order. */
import { REVISION_STATES, normSheet } from "@shared/drawings";
import type { Rev, Sheet } from "../model";
import type { SheetIndex } from "./callouts";

export const hasDrawing = (r: Pick<Rev, "url" | "previewUrl">) => !!(r.url || r.previewUrl);

/** The revision a sheet opens at: rev n when given (if it has a drawing), else the issued one with a drawing, else the newest with one. */
export function viewRev(x: Pick<Sheet, "revs">, n?: number | null): Rev | null {
  const rs = x.revs.filter(hasDrawing);
  if (n != null) return rs.find(r => r.number === n) ?? null;
  return rs.find(r => r.state === "issued") ?? [...rs].sort((a, b) => b.number - a.number)[0] ?? null;
}

export const revStateLabel = (s: string) => REVISION_STATES[s as keyof typeof REVISION_STATES] ?? s;

export const sortSheets = <S extends Pick<Sheet, "sheetNumber">>(xs: S[]) =>
  [...xs].sort((a, b) => String(a.sheetNumber).localeCompare(String(b.sheetNumber), undefined, { numeric: true }));

/** Normalized sheet number → sheet, for callout links (only sheets in the job's register link). */
export const sheetIndex = (xs: Pick<Sheet, "id" | "sheetNumber">[]): SheetIndex<number> =>
  new Map(xs.map(s => [normSheet(s.sheetNumber), { sid: s.id, sheet: s.sheetNumber }]));
