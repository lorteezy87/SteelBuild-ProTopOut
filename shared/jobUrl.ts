import { customAlphabet } from "nanoid";

/**
 * Job URLs: /j/{publicId}/{slug}/{tab}/{a}/{b}
 *
 * The public id is a short random token that never changes, so a link pasted into an
 * email to a GC keeps working after the job is renamed and does not leak how many jobs
 * the company has run (as /jobs/42 does). The slug is decoration for the reader; it is
 * derived from the job name and is never used for lookup.
 */

/** No vowels and no look-alikes (0/o, 1/l/i): ids can't spell words and read back cleanly over the phone. */
export const PUBLIC_ID_ALPHABET = "23456789bcdfghjkmnpqrstvwxyz";
export const PUBLIC_ID_LENGTH = 8;

const generate = customAlphabet(PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH);
export const newPublicId = (): string => generate();

const PUBLIC_ID_RE = new RegExp(`^[${PUBLIC_ID_ALPHABET}]{${PUBLIC_ID_LENGTH}}$`);
export const isPublicId = (s: string | null | undefined): s is string => typeof s === "string" && PUBLIC_ID_RE.test(s);

export const JOB_SLUG_MAX = 48;

/** "The Catalina — Phase 2 (UofA)" -> "the-catalina-phase-2-uofa". Never empty. */
export function slugify(name: string | null | undefined): string {
  const s = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, JOB_SLUG_MAX)
    .replace(/-+$/g, "");
  return s || "job";
}

export type JobRef = { publicId: string; name?: string | null };

/** Canonical path for a job, optionally at a tab and up to two sub-segments. */
export function jobPath(job: JobRef, tab?: string | null, a?: string | number | null, b?: string | number | null): string {
  const base = `/j/${job.publicId}/${slugify(job.name)}`;
  const t = tab && tab !== "overview" ? tab : null;
  if (!t) return base;
  const segs = [t, a, b].filter(x => x !== undefined && x !== null && x !== "").map(x => encodeURIComponent(String(x)));
  // A sub-segment only makes sense when the one before it is present.
  if (a === undefined || a === null || a === "") return `${base}/${segs[0]}`;
  return `${base}/${segs.join("/")}`;
}

/** Positive integer id from a legacy /jobs/:id segment, or null. */
export function legacyJobId(seg: string | null | undefined): number | null {
  if (!seg || !/^[1-9]\d{0,9}$/.test(seg)) return null;
  const n = Number(seg);
  return Number.isSafeInteger(n) ? n : null;
}
