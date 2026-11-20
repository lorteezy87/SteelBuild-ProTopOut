import { hashPassword, MIN_PASSWORD, verifyPassword } from "./localAuth";

/**
 * TopOut has exactly one person who can sign in: the owner (the single `users` row with role "admin").
 * Everyone else in `users` is a crew record with no login.
 */

/** First-run setup is open only until the owner exists. */
export function registrationAllowed(state: { ownerExists: boolean }): boolean {
  return !state.ownerExists;
}

/**
 * Applies OWNER_RESET_PASSWORD at startup. Returns null when the variable is unset/empty,
 * `{ changed: false }` when the stored hash already matches it, otherwise a new hash.
 */
export async function applyResetPassword(
  env: string | undefined,
  current: string | null,
): Promise<{ hash: string; changed: boolean } | null> {
  if (!env) return null;
  if (env.length < MIN_PASSWORD) throw new Error(`OWNER_RESET_PASSWORD must be at least ${MIN_PASSWORD} characters`);
  if (current && (await verifyPassword(env, current))) return { hash: current, changed: false };
  return { hash: await hashPassword(env), changed: true };
}

/** The credential's user may sign in only if it is the owner. */
export function pickLoginUser<U extends { id: number; role: string }>(users: U[], credentialUserId: number): U | null {
  const u = users.find(x => x.id === credentialUserId);
  return u && u.role === "admin" ? u : null;
}

/** Validation for a password change; null when allowed. */
export function changePasswordError(input: { currentOk: boolean; next: string }): string | null {
  if (!input.currentOk) return "Current password is incorrect.";
  if (input.next.length < MIN_PASSWORD || input.next.length > 200) return `New password must be at least ${MIN_PASSWORD} characters.`;
  return null;
}
