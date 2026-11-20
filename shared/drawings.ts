/**
 * Drawing register rules — sheets, revisions, holds and set issues.
 *
 * Pure functions shared by the server (which enforces them) and the client
 * (which uses them to show only the actions that will succeed). Modelled on the
 * SteelBuild Document Control register:
 *
 *  - A sheet moves Detailing → In review → Released, or back to Revise & Resubmit.
 *    Any sheet can be put On hold; lifting the hold returns it to where it was.
 *  - Each sheet keeps numbered revisions: draft → signed off → issued; issuing a
 *    revision supersedes the one before it. Only one revision may be pending
 *    (draft or signed off) at a time.
 *  - A newly issued revision has not been reviewed, so issuing it sends the sheet
 *    (back) to review — approving an old revision can never release a new one.
 *  - A set issue records the issued revision of each sheet the purpose allows;
 *    work purposes (erection / construction / fabrication) take only released
 *    sheets that are not on hold.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const SHEET_STATUSES = {
  DET: "Detailing",
  REV: "In review",
  RR: "Revise & resubmit",
  HOLD: "On hold",
  REL: "Released",
} as const;
export type SheetStatus = keyof typeof SHEET_STATUSES;
export const SHEET_STATUS_KEYS = Object.keys(SHEET_STATUSES) as SheetStatus[];

export const REVISION_STATES = {
  draft: "Draft",
  checked: "Signed off",
  issued: "Issued",
  superseded: "Superseded",
} as const;
export type RevisionState = keyof typeof REVISION_STATES;

export const SET_KINDS = {
  erection: "Erection",
  shop: "Shop",
  contract: "Contract",
  field: "Field / As-built",
  other: "Other",
} as const;
export type SetKind = keyof typeof SET_KINDS;

export const BALL_IN_COURT = ["—", "Detailer", "GC", "EOR", "Architect", "Fabricator"] as const;
export type BallInCourt = (typeof BALL_IN_COURT)[number];

/** Purposes that put drawings to work: only released sheets with an issued revision may go out for these. */
export const WORK_PURPOSES = ["For erection", "For construction", "For fabrication"] as const;
/** Purposes offered when recording a set issue (an erector does not issue for fabrication). */
export const ISSUE_PURPOSES = ["For erection", "For construction", "For approval", "For record", "Revision"] as const;
export const ALL_PURPOSES = [...ISSUE_PURPOSES, "For fabrication"] as const;
export type IssuePurpose = (typeof ALL_PURPOSES)[number];

/** Calendar days a sheet may be out for review before it reads late. */
export const REVIEW_DAYS = 14;

/* ------------------------------------------------------------------ */
/* Sheet numbers                                                       */
/* ------------------------------------------------------------------ */

/** Sheet numbers compare without case, spaces or dash style: "S201", "s-201" and "S–201" are one sheet. */
export function normSheet(v: string | null | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[\s-]+/g, "");
}

/** A sheet number as written (case, dash style and runs of spaces aside). "E1-1" and "E-11" differ here but not in normSheet. */
export function litSheet(v: string | null | undefined): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Why this sheet number can't be used on the job ('' = it can). The same number however its dashes are typed is a
 * duplicate; a number that only matches once dashes and spaces are dropped ("E-11" beside "E1-1") is a clash — every
 * match would take them for one sheet.
 */
export function sheetNumberProblem(
  existing: { id: number; sheetNumber: string }[],
  number: string,
  selfId?: number | null
): string {
  const n = normSheet(number);
  if (!n) return "Enter a sheet number";
  const other = existing.find(x => x.id !== selfId && normSheet(x.sheetNumber) === n);
  if (!other) return "";
  return litSheet(other.sheetNumber) === litSheet(number)
    ? `Sheet ${other.sheetNumber} already exists on this job`
    : `Reads as sheet ${other.sheetNumber} once dashes and spaces are dropped — use a number that differs in its letters or digits`;
}

/* ------------------------------------------------------------------ */
/* Revisions                                                           */
/* ------------------------------------------------------------------ */

export type RevLike = { number: number; state: string; hasFile?: boolean };

export const pendingRev = <R extends RevLike>(revs: R[]): R | undefined =>
  revs.find(r => r.state === "draft" || r.state === "checked");
export const issuedRev = <R extends RevLike>(revs: R[]): R | undefined => revs.find(r => r.state === "issued");
export const nextRevNo = (revs: RevLike[]): number => (revs.length ? Math.max(...revs.map(r => r.number)) + 1 : 0);

/* ------------------------------------------------------------------ */
/* Status actions                                                      */
/* ------------------------------------------------------------------ */

export type SheetLike = {
  status: string;
  holdFrom?: string | null;
  sentDate?: string | null;
  returnedDate?: string | null;
  ballInCourt?: string | null;
};

export type SheetPatch = {
  status?: SheetStatus;
  holdFrom?: SheetStatus | null;
  sentDate?: string | null;
  returnedDate?: string | null;
  ballInCourt?: BallInCourt;
  holdReason?: string | null;
  holdRfiId?: number | null;
};

export const SHEET_ACTIONS = {
  submit: "Submit for review",
  approve: "Mark approved",
  revise: "Revise & resubmit",
  hold: "Place on hold",
  release: "Release hold",
} as const;
export type SheetAction = keyof typeof SHEET_ACTIONS;

const BIC_FOR: Record<SheetStatus, BallInCourt> = { DET: "Detailer", REV: "GC", RR: "Detailer", REL: "—", HOLD: "Detailer" };

export type BulkSheetSkip = { sheetId: number; sheet: string; why: string };
export type BulkSheetResult = { done: number; skipped: BulkSheetSkip[] };
export type BulkSheetPatch = {
  setId?: number | null;
  sequenceTaskId?: number | null;
  ballInCourt?: BallInCourt;
  sentDate?: string | null;
  returnedDate?: string | null;
};

/** Approvals always refer to the exact issued revision the reviewer observed, never a revision number. */
export function reviewRevisionProblem(revs: (RevLike & { id: number })[], expectedRevisionId?: number): string {
  const actual = issuedRev(revs);
  return expectedRevisionId == null || !actual || actual.id !== expectedRevisionId
    ? "The issued revision is missing or has changed — reload and review the current issued revision before marking it approved or revise & resubmit. Nothing changed."
    : "";
}

/** Validate the merged dates, not just the supplied patch; null clears while undefined leaves unchanged. */
export function sheetEditProblem(x: SheetLike, patch: Pick<BulkSheetPatch, "sentDate" | "returnedDate">, today: string): string {
  const sent = patch.sentDate === undefined ? x.sentDate : patch.sentDate;
  const returned = patch.returnedDate === undefined ? x.returnedDate : patch.returnedDate;
  if ((patch.sentDate && patch.sentDate > today) || (patch.returnedDate && patch.returnedDate > today)) return "Sent and returned dates cannot be in the future";
  if ((x.status === "REV" || x.status === "RR" || x.status === "REL") && !sent)
    return `A sheet ${(SHEET_STATUSES[x.status as SheetStatus] ?? x.status).toLowerCase()} needs its sent date`;
  if ((x.status === "RR" || x.status === "REL") && !returned) return "A returned sheet needs its returned date";
  if (x.status === "REV" && returned) return "A sheet in review has not been returned — clear the returned date or mark it returned";
  if (sent && returned && returned < sent) return "The returned date cannot be before the sent date";
  return "";
}

/** The status actions open to a sheet right now, in the order they are offered. */
export function sheetActions(x: SheetLike, revs: RevLike[]): SheetAction[] {
  switch (x.status) {
    // Submitting needs an issued revision; a pending one is submitted by issuing it.
    case "DET":
      return [...(issuedRev(revs) && !pendingRev(revs) ? (["submit"] as const) : []), "hold"];
    case "REV":
      return ["approve", "revise", "hold"];
    case "RR":
    case "REL":
      return ["hold"];
    case "HOLD":
      return ["release"];
    default:
      return [];
  }
}

/** Where a sheet goes when its hold is lifted: where it was before the hold. */
export function afterHold(x: SheetLike): SheetPatch {
  const from = x.holdFrom && x.holdFrom !== "HOLD" && x.holdFrom in SHEET_STATUSES ? (x.holdFrom as SheetStatus) : null;
  const status: SheetStatus = from ?? (x.returnedDate ? "RR" : x.sentDate ? "REV" : "DET");
  return { status, ballInCourt: BIC_FOR[status], holdFrom: null, holdReason: null, holdRfiId: null };
}

/**
 * The change an action makes to a sheet, or an error saying why it can't be taken. `today` is the org's date.
 * Hold reason / RFI are applied by the caller (they need the database).
 */
export function applyAction(
  x: SheetLike,
  revs: RevLike[],
  action: SheetAction,
  today: string
): { ok: true; patch: SheetPatch; summary: string } | { ok: false; error: string } {
  if (!sheetActions(x, revs).includes(action)) {
    const name = SHEET_STATUSES[x.status as SheetStatus] ?? x.status;
    if (action === "submit" && x.status === "DET") {
      const p = pendingRev(revs);
      return {
        ok: false,
        error: p
          ? `${p.state === "draft" ? "Sign off and issue" : "Issue"} Rev ${p.number} — issuing it submits the sheet for review`
          : "Start a revision, sign it off and issue it first",
      };
    }
    return { ok: false, error: `“${SHEET_ACTIONS[action] ?? action}” is not available while the sheet is ${name.toLowerCase()}` };
  }
  switch (action) {
    case "submit":
      return { ok: true, patch: { status: "REV", sentDate: today, returnedDate: null, ballInCourt: "GC" }, summary: "submitted for review" };
    case "approve":
      return { ok: true, patch: { status: "REL", returnedDate: today, ballInCourt: "—" }, summary: "returned approved · released for erection" };
    case "revise":
      return { ok: true, patch: { status: "RR", returnedDate: today, ballInCourt: "Detailer" }, summary: "returned revise & resubmit" };
    case "hold":
      return { ok: true, patch: { status: "HOLD", holdFrom: x.status as SheetStatus }, summary: "placed on hold" };
    case "release": {
      const p = afterHold(x);
      return { ok: true, patch: p, summary: `hold lifted · back to ${SHEET_STATUSES[p.status!].toLowerCase()}` };
    }
  }
}

/**
 * The sheet change when its signed-off revision is issued. A sheet in detailing, revise & resubmit, review or released
 * goes (back) to review with the new revision. A held sheet stays held but returns to review when the hold is lifted.
 */
export function issueEffect(x: SheetLike, today: string): { patch: SheetPatch; note: string } {
  if (x.status === "DET" || x.status === "RR" || x.status === "REV" || x.status === "REL") {
    return {
      patch: { status: "REV", sentDate: today, returnedDate: null, ballInCourt: "GC" },
      note: x.status === "REV" || x.status === "REL" ? " and resubmitted for review" : " and submitted for review",
    };
  }
  if (x.status === "HOLD") {
    return { patch: { holdFrom: "REV", sentDate: today, returnedDate: null }, note: " · goes to review when the hold is lifted" };
  }
  return { patch: {}, note: "" };
}

/** Days out for the current review round and whether it is late (only while in review). */
export function reviewFacts(x: SheetLike, today: string, days = REVIEW_DAYS) {
  const out = x.status === "REV" && x.sentDate ? diffDays(x.sentDate, today) : x.sentDate && x.returnedDate ? diffDays(x.sentDate, x.returnedDate) : 0;
  return { out: Math.max(0, out), late: x.status === "REV" && out > days };
}

/* ------------------------------------------------------------------ */
/* Issue rules                                                         */
/* ------------------------------------------------------------------ */

export const isWorkPurpose = (p: string) => (WORK_PURPOSES as readonly string[]).includes(p);

/** Why a sheet can't go out for this purpose ('' = it can). */
export function blockFor(x: SheetLike, revs: RevLike[], purpose: string): string {
  const work = isWorkPurpose(purpose);
  if (work && x.status === "HOLD") return "on hold";
  if (!issuedRev(revs)) return "no issued revision";
  if (work && x.status !== "REL") return `not released (${SHEET_STATUSES[x.status as SheetStatus] ?? x.status})`;
  return "";
}

export type IssueLine = { sheetId: number; sheet: string; rev: number; title: string; status: string; fileUrl?: string | null };
export type IssueSkip = { sheet: string; why: string };

/** What a set issue for this purpose records, and what it leaves out (with why). */
export function issueSnapshot<
  S extends SheetLike & { id: number; sheetNumber: string; title: string; revs: (RevLike & { url?: string | null })[] },
>(kids: S[], purpose: string): { sheets: IssueLine[]; skipped: IssueSkip[] } {
  const sheets: IssueLine[] = [];
  const skipped: IssueSkip[] = [];
  for (const x of kids) {
    const why = blockFor(x, x.revs, purpose);
    if (why) {
      skipped.push({ sheet: x.sheetNumber, why });
      continue;
    }
    const r = issuedRev(x.revs)!;
    sheets.push({ sheetId: x.id, sheet: x.sheetNumber, rev: r.number, title: x.title, status: x.status, fileUrl: r.url ?? null });
  }
  return { sheets, skipped };
}

/**
 * A set's issue state. Each sheet's revision is issued on its own; recording a set issue is a separate step, so a set
 * with no recorded issue still counts its sheets' issued revisions. Issued is not released: rel = every issued sheet is
 * also released.
 */
export function setIssueState(
  issues: { number: number; issueDate: string }[],
  kids: (SheetLike & { revs: (RevLike & { issuedAt?: string | null })[] })[]
) {
  const last = [...issues].sort((a, b) => b.number - a.number)[0] ?? null;
  const iss = kids.filter(x => issuedRev(x.revs));
  const notRel: Record<string, number> = {};
  for (const x of iss) if (x.status !== "REL") notRel[x.status] = (notRel[x.status] ?? 0) + 1;
  const at = iss.reduce((m, x) => {
    const d = issuedRev(x.revs)?.issuedAt ?? "";
    return d > m ? d : m;
  }, "");
  return { last, issued: iss.length, total: kids.length, rel: iss.length > 0 && !Object.keys(notRel).length, notRel, at };
}

export function setIssueLabel(si: ReturnType<typeof setIssueState>, fmt: (d: string) => string): string {
  if (si.last) return `Issue ${si.last.number} · ${fmt(si.last.issueDate)}`;
  if (!si.issued) return "Not issued";
  if (si.issued < si.total) return `${si.issued} of ${si.total} issued`;
  if (si.rel) return "Issued" + (si.at ? ` · ${fmt(si.at)}` : "");
  const keys = Object.keys(si.notRel);
  if (keys.length === 1) {
    const words: Record<string, string> = { REV: "in review", RR: "to revise & resubmit", HOLD: "on hold", DET: "detailing" };
    return `Issued · ${si.notRel[keys[0]]} ${words[keys[0]] ?? "not released"}`;
  }
  return `Issued · ${keys.reduce((a, k) => a + si.notRel[k], 0)} not released`;
}

/* ------------------------------------------------------------------ */
/* Release by erection sequence                                        */
/* ------------------------------------------------------------------ */

export type MatrixCell = "—" | "HOLD" | "RR" | "LATE" | "REV" | "DET" | "REL";
export const MATRIX_LABELS: Record<MatrixCell, string> = {
  "—": "No sheets",
  HOLD: "On hold",
  RR: "Revise & resubmit",
  LATE: "Review late",
  REV: "In review",
  DET: "Detailing",
  REL: "Released",
};

/** One erection sequence's release state: the worst of its sheets (a hold outranks everything). */
export function matrixCell(sheetsInSeq: SheetLike[], today: string, days = REVIEW_DAYS): MatrixCell {
  if (!sheetsInSeq.length) return "—";
  if (sheetsInSeq.some(x => x.status === "HOLD")) return "HOLD";
  if (sheetsInSeq.some(x => x.status === "RR")) return "RR";
  const rev = sheetsInSeq.filter(x => x.status === "REV");
  if (rev.length) return rev.some(x => reviewFacts(x, today, days).late) ? "LATE" : "REV";
  if (sheetsInSeq.some(x => x.status === "DET")) return "DET";
  return "REL";
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** Whole days from a to b (YYYY-MM-DD), DST-safe. */
export function diffDays(a: string, b: string): number {
  if (!isDay(a) || !isDay(b)) return 0;
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

/** A CSV cell, quoted when needed and guarded against spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Best guess at a sheet number and revision from a drawing file name ("E-201 Rev 3 Roof Framing.pdf"). */
export function guessFromFileName(name: string): { sheetNumber: string; rev: number | null; title: string } {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim();
  const revM = base.match(/(?:^|[\s.-])(?:rev(?:ision)?|r)\s*\.?\s*(\d{1,3})\b/i);
  const rev = revM ? Number(revM[1]) : null;
  const rest = revM ? (base.slice(0, revM.index!) + " " + base.slice(revM.index! + revM[0].length)).trim() : base;
  const m = rest.match(/^([A-Za-z]{0,4}[\s-]?\d{1,4}(?:[.-]\d{1,3})?[A-Za-z]?)\b\s*[-–:]?\s*(.*)$/);
  if (!m) return { sheetNumber: rest.slice(0, 64), rev, title: "" };
  return { sheetNumber: m[1].replace(/\s+/g, "-").toUpperCase(), rev, title: m[2].trim().slice(0, 255) };
}
