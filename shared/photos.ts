/** Photo log: what counts as a photo, which day it belongs to, and which photos a record shows. */

const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp)$/i;

export function isPhoto(mimeType: string | null | undefined, fileName: string): boolean {
  return (mimeType ?? "").startsWith("image/") || PHOTO_EXT.test(fileName);
}

/** Records a photo can be attached to. */
export const PHOTO_ENTITY_TYPES = ["dailyReport", "logItem", "tmTicket"] as const;
export type PhotoEntity = (typeof PHOTO_ENTITY_TYPES)[number];

/** The taken date when known; otherwise the upload day, flagged so the screen never claims it was taken then. */
export function photoDay(p: { takenOn: string | null; uploadedDay: string }): { day: string; estimated: boolean } {
  return p.takenOn ? { day: p.takenOn, estimated: false } : { day: p.uploadedDay, estimated: true };
}

export function groupByDay<T extends { takenOn: string | null; uploadedDay: string }>(photos: T[]): { day: string; photos: (T & { estimated: boolean })[] }[] {
  const groups = new Map<string, (T & { estimated: boolean })[]>();
  for (const p of photos) {
    const { day, estimated } = photoDay(p);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push({ ...p, estimated });
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, photos]) => ({ day, photos }));
}

/** A record's photos: the ones uploaded to it, then the ones attached from the photo log. Each once. */
export function photosForRecord(owned: number[], linked: number[]): number[] {
  return [...new Set([...owned, ...linked])];
}
