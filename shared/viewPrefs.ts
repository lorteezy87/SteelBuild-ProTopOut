/**
 * Per-user view state kept on the server, so filters, sort order and layout choices
 * follow the user from the office desktop to the trailer laptop to a phone.
 *
 * A pref is addressed by a scope ("jobs.list") and an optional scope id (a job id,
 * a report id). The value is free-form JSON owned by the screen that stores it.
 */

/** Lowercase dotted name, e.g. "jobs.list" or "job.tasks.columns". */
const SCOPE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){0,5}$/;
export const VIEW_PREF_SCOPE_MAX = 64;
export const VIEW_PREF_SCOPE_ID_MAX = 64;
/** Serialized size cap per pref. View state is small; anything larger is a bug or abuse. */
export const VIEW_PREF_MAX_BYTES = 16 * 1024;

export function isViewPrefScope(scope: string): boolean {
  return scope.length <= VIEW_PREF_SCOPE_MAX && SCOPE_RE.test(scope);
}

export function isViewPrefScopeId(scopeId: string): boolean {
  return scopeId.length <= VIEW_PREF_SCOPE_ID_MAX && /^[A-Za-z0-9_-]*$/.test(scopeId);
}

/** Byte length of the value as it will be stored; Infinity when it cannot be serialized. */
export function viewPrefBytes(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return Infinity;
    return new TextEncoder().encode(s).length;
  } catch {
    return Infinity;
  }
}

const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * Lay a stored pref over a screen's defaults.
 *
 * Stored view state outlives the code that wrote it, so it is never trusted whole:
 * only keys the screen still declares are kept, and only when the stored value has the
 * same kind (string, number, boolean, array, object) as the default. Anything else falls
 * back to the default, so a stale pref can never put a screen into a shape it cannot render.
 */
export function mergeViewPref<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
  if (kind(stored) !== "object") return defaults;
  const src = stored as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (!(key in src)) continue;
    const d = defaults[key];
    const s = src[key];
    // A null default accepts any stored value; otherwise kinds must match.
    if (d === null || kind(d) === kind(s)) out[key] = s;
  }
  return out as T;
}
