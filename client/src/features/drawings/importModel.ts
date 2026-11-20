/**
 * Drawing import rules (ported from SteelBuild app/import.jsx matchOf and applyImport checks). Pure: no React.
 *
 * Each page of a drawing set is one row: its sheet number, title and revision read from the title block (or typed).
 * A row adds a new sheet, or a new revision to a sheet already in the register — only when its revision is higher
 * than every revision the sheet has and no revision is pending. Everything else waits for a decision and says why.
 */
import { litSheet, normSheet } from "@shared/drawings";

export type RowFields = { sheet: string; title: string; rev: string; seqId: number | null; revDate: string; revDesc: string };
export type RegSheet = { id: number; sheetNumber: string; setId: number | null; revs: { number: number; state: string }[] };

export type Match =
  | { kind: "none"; label: string }
  | { kind: "clash"; x: RegSheet; label: string }
  | { kind: "new"; assumed: boolean; label: string }
  | { kind: "rev"; x: RegSheet; top: number; jump: boolean; label: string }
  | { kind: "skip"; x: RegSheet; logged: boolean; top: number; label: string }
  | { kind: "norev"; x: RegSheet; label: string }
  | { kind: "older"; x: RegSheet; top: number; label: string };

const topRev = (x: RegSheet) => (x.revs.length ? Math.max(...x.revs.map(r => r.number)) : -1);
const pending = (x: RegSheet) => x.revs.find(r => r.state === "draft" || r.state === "checked");

/** What a row would do to the register. */
export function matchOf(sheets: RegSheet[], f: Pick<RowFields, "sheet" | "rev">): Match {
  const sh = normSheet(f.sheet);
  if (!sh) return { kind: "none", label: "Needs a sheet no." };
  const same = sheets.filter(q => normSheet(q.sheetNumber) === sh);
  const x = same.find(q => litSheet(q.sheetNumber) === litSheet(f.sheet)) ?? null;
  // written differently from the register's sheet ("E-11" beside "E1-1"): someone decides — it is that sheet, or the number is wrong
  if (!x && same.length) return { kind: "clash", x: same[0], label: `Reads as ${same[0].sheetNumber} — use it, or correct the number` };
  const blank = String(f.rev ?? "").trim() === "";
  if (!x) return { kind: "new", assumed: blank, label: "New sheet" };
  const top = topRev(x);
  const p = pending(x);
  if (p) return { kind: "skip", x, logged: false, top, label: `Rev ${p.number} already pending` };
  if (blank) return { kind: "norev", x, label: "Revision not read — type it" };
  const n = Number(f.rev);
  if (n > top) return { kind: "rev", x, top, jump: n > top + 3, label: `New revision · R${top} → R${n}${n > top + 3 ? " — check this jump" : ""}` };
  // below the register: an older drawing, or a new issue numbered afresh after lettered rounds (IFC 0 after A, B)
  if (n < top) return { kind: "older", x, top, label: `Older than the register (R${n} < R${top})` };
  return { kind: "skip", x, logged: true, top, label: `Already logged (R${top})` };
}

/** Why a row can't be added yet ('' = it can). */
export function rowProblem(f: RowFields, m: Match): string {
  if (m.kind === "new" && !f.title.trim()) return "New sheet — type its title";
  const rev = String(f.rev ?? "").trim();
  if (rev && !/^\d{1,3}$/.test(rev)) return "Rev must be a whole number (0 or more)";
  if (f.revDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.revDate)) return "Rev date is not a date";
  return m.kind === "new" || m.kind === "rev" ? "" : m.label;
}

export const isReady = (f: RowFields, m: Match) => !rowProblem(f, m);

/**
 * Rows naming the same sheet twice, however written ("S-301" and "S 301"): matching takes them for one sheet, so
 * only the first is added. Returns the keys of the later duplicates.
 */
export function duplicateKeys(rows: { key: string; f: Pick<RowFields, "sheet">; include: boolean }[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.include) continue;
    const k = normSheet(r.f.sheet);
    if (!k) continue;
    if (seen.has(k)) out.add(r.key);
    else seen.add(k);
  }
  return out;
}

/**
 * Many pages read with the same sheet number or title usually mean a box is catching text every sheet shares
 * (project name, firm block).
 */
export function repeatingRead(done: Pick<RowFields, "sheet" | "title">[]): "sheet" | "title" | null {
  if (done.length < 3) return null;
  const count = (vals: string[]) => vals.filter(Boolean).reduce<Record<string, number>>((a, v) => ((a[v] = (a[v] ?? 0) + 1), a), {});
  const topSheet = Math.max(0, ...Object.values(count(done.map(d => normSheet(d.sheet)))));
  const topTitle = Math.max(0, ...Object.values(count(done.map(d => d.title.trim().toLowerCase()))));
  if (topSheet >= 3) return "sheet";
  if (topTitle >= Math.ceil(done.length / 2)) return "title";
  return null;
}

/** The erection sequence a title names ("SEQ 4 ROOF FRAMING"), matched to the job's sequences by their number. */
export function sequenceFor(title: string, sequences: { id: number; name: string }[]): number | null {
  const n = String(title || "").match(/\bSEQ(?:UENCE)?\.?[\s#:-]*(\d{1,2})\b/i);
  if (!n) return null;
  const want = Number(n[1]);
  const hit = sequences.find(s => {
    const m = s.name.match(/\bSEQ(?:UENCE)?\.?[\s#:-]*(\d{1,2})\b/i);
    return m && Number(m[1]) === want;
  });
  return hit?.id ?? null;
}

/** "Seq 4 framing.pdf" → "Seq 4 framing": a new set's name from the first file. */
export const setNameFromFile = (name: string) =>
  name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/_+/g, " ")
    .trim()
    .slice(0, 80);

/** The next free set number of a kind on the job: E-SET-03 after E-SET-02. */
export function nextSetNumber(sets: { number: string }[], kind: string): string {
  const pre = ({ erection: "E", shop: "SH", contract: "C", field: "F" } as Record<string, string>)[kind] ?? "D";
  const re = new RegExp(`^${pre}-SET-(\\d+)$`, "i");
  const max = Math.max(0, ...sets.map(t => (re.test(t.number.trim()) ? Number(t.number.trim().match(re)![1]) : 0)));
  return `${pre}-SET-${String(max + 1).padStart(2, "0")}`;
}
