/**
 * Bulk piece review. Pure changes share REVIEW.fix's field cleaning and state rules.
 * Delete removes both suggested and hand-added pieces from pcs (not a rejection/tombstone).
 * A fresh read replaces pcs, so suggestions deleted here can return when a sheet is read again.
 */
import { MD, cleanFields, plural, type Kind, type Piece, type ReadData, type ReadRec, type Who } from "./domain";
import type { ModelApi } from "./data";

export type PieceBulkEdit = { mark?: string; size?: string; kind?: Kind };
export type PieceBulkOp =
  | { type: "accept" | "review" | "reject" | "delete" }
  | { type: "edit"; fields: PieceBulkEdit };
export type PieceBulkChange = { data: ReadData; summary: string; changed: number };

export function bulkSummary(op: PieceBulkOp, n: number) {
  const verb = { accept: "accepted", review: "marked needs review", reject: "rejected", delete: "deleted", edit: "edited" }[op.type];
  return "Bulk: " + plural(n, "piece") + " " + verb;
}

/** Missing/duplicate IDs, unchanged values and inapplicable states never create a save. */
export function changePieceBulk(d: ReadData, ids: readonly string[], op: PieceBulkOp, who: Who): PieceBulkChange {
  const want = new Set(ids);
  let changed = 0;
  const pcs: Piece[] = [];
  for (const p of d.pcs) {
    if (!want.has(p.id)) { pcs.push(p); continue; }
    if (op.type === "delete") { changed++; continue; }
    let next = p;
    if (op.type === "edit") {
      const f = op.fields;
      const g = cleanFields({ k: f.kind ?? p.k, mark: f.mark ?? p.mark, size: f.size ?? p.size });
      // Only explicitly supplied fields change. Notes, geometry, ends and stored length stay intact,
      // exactly as in REVIEW.fix. Weight is derived by MD.weight/MD.rows, not stored on pieces.
      if ((f.kind !== undefined && g.k !== p.k) || (f.mark !== undefined && g.mark !== p.mark) || (f.size !== undefined && g.size !== p.size)) {
        next = { ...p, k: f.kind === undefined ? p.k : g.k, mark: f.mark === undefined ? p.mark : g.mark, size: f.size === undefined ? p.size : g.size, st: p.st === "add" ? "add" : "edit", at: who.at, ...(who.by !== undefined ? { by: who.by } : {}) };
      }
    } else {
      // Accept suggestions only; never resurrect a rejected piece implicitly.
      // Hand-drawn pieces have no reader suggestion to return to (matches the viewer's Needs review).
      const st = op.type === "accept" ? "ok" : op.type === "review" ? "auto" : "no";
      const meaningful = op.type === "accept" ? p.st === "auto" : op.type === "review" ? p.via !== "hand" && p.st !== "add" && p.st !== "auto" : p.st !== "no";
      if (meaningful) next = { ...p, st, at: who.at, ...(who.by !== undefined ? { by: who.by } : {}) };
    }
    if (next !== p) changed++;
    pcs.push(next);
  }
  return { data: changed ? { ...d, pcs } : d, summary: bulkSummary(op, changed), changed };
}

/** Select only rendered rows; retain live hidden choices, but exclude them from every operation. */
export function pieceSelection(selected: ReadonlySet<string>, all: readonly string[], visible: readonly string[]) {
  const live = new Set(all), shown = new Set(visible);
  const valid = [...selected].filter(k => live.has(k));
  return { keys: valid.filter(k => shown.has(k)), hidden: valid.filter(k => !shown.has(k)).length };
}

/** Shift selection follows current rendered sort order, including deselect ranges. */
export function togglePieceSelection(selected: ReadonlySet<string>, visible: readonly string[], key: string, on: boolean, anchor?: string | null) {
  const next = new Set(selected), end = visible.indexOf(key), start = anchor ? visible.indexOf(anchor) : -1;
  if (end < 0) return next;
  const range = start < 0 ? [key] : visible.slice(Math.min(start, end), Math.max(start, end) + 1);
  for (const k of range) { if (on) next.add(k); else next.delete(k); }
  return next;
}

export type PieceBulkApi = Pick<ModelApi, "save" | "me"> & Partial<Pick<ModelApi, "sheets" | "canEdit">>;
export type PieceBulkResult = { done: number; skipped: number; failed: { sheet: string; why: string }[] };
const readDataOf = (r: ReadRec): ReadData => ({ w: r.w, h: r.h, ppf: r.ppf, sl: r.sl, lvl: r.lvl, lvlBy: r.lvlBy, tos: r.tos, tosBy: r.tosBy, grids: r.grids, pcs: r.pcs, cols: r.cols, left: r.left, aside: r.aside });
const errorText = (e: unknown) => {
  const err = e as { data?: { code?: string }; code?: string; message?: string } | null;
  if (err?.data?.code === "CONFLICT" || err?.code === "CONFLICT") return "Version conflict — framing was reloaded. Review it and try again; no changes saved on this page.";
  return err?.message || "Could not save this page.";
};

/** One held-version save per read, sequentially. Failure never aborts or retries another read. */
export async function applyPieceBulk(api: PieceBulkApi, recs: readonly ReadRec[], keys: string[], op: PieceBulkOp): Promise<PieceBulkResult> {
  const result: PieceBulkResult = { done: 0, skipped: 0, failed: [] };
  if (api.canEdit === false) return { ...result, failed: [{ sheet: "Model", why: "Only editors can review or delete pieces." }] };
  const groups = new Map<string, string[]>();
  for (const key of new Set(keys)) {
    // MPiece.key = read key + "/" + piece id. Read keys never contain "/" (MD.idOf), but piece ids may, so match the
    // held read whose key prefixes this one; otherwise split at the first slash so a removed read is still reported.
    const held = recs.find(r => key.startsWith(r.key + "/"));
    const slash = held ? held.key.length : key.indexOf("/"), rid = key.slice(0, slash), pid = key.slice(slash + 1);
    if (slash < 1 || !pid) { result.failed.push({ sheet: key, why: "Piece selection is no longer valid." }); continue; }
    const ids = groups.get(rid) ?? []; ids.push(pid); groups.set(rid, ids);
  }
  const who: Who = { by: api.me, at: new Date().toISOString() };
  for (const [rid, ids] of groups) {
    const rec = recs.find(r => r.key === rid);
    if (!rec) { result.failed.push({ sheet: rid, why: "This read was removed. Reload and select its pieces again." }); continue; }
    const sheet = (api.sheets?.find(s => s.id === rec.sid)?.sheet ?? "Sheet " + rec.sid) + " Rev " + rec.rev + " p" + rec.pg;
    const missing = ids.filter(id => !rec.pcs.some(p => p.id === id));
    if (missing.length) result.failed.push({ sheet, why: plural(missing.length, "selected piece") + " no longer on this page; not included." });
    const change = changePieceBulk(readDataOf(rec), ids, op, who);
    result.skipped += ids.length - missing.length - change.changed;
    if (!change.changed) continue;
    try {
      // quiet saves throw their original error, allowing per-sheet conflict reporting.
      const saved = await api.save(rec, change.data, change.summary, { quiet: true });
      if (saved) result.done += change.changed;
      else result.failed.push({ sheet, why: "Save failed; reload this page before trying again." });
    } catch (e) { result.failed.push({ sheet, why: errorText(e) }); }
  }
  return result;
}

/** Delete guard considers accepted/fixed/added states, and uses the deduplicated existing selection. */
export function pieceDeleteFacts(recs: readonly ReadRec[], keys: readonly string[]) {
  const want = new Set(keys);
  const pcs = recs.flatMap(r => r.pcs.filter(p => want.has(r.key + "/" + p.id)));
  const accepted = pcs.filter(MD.accepted).length;
  return { count: pcs.length, accepted, suggested: pcs.filter(p => p.via !== "hand").length, requiresDelete: pcs.length >= 20 || accepted > 0 };
}
