// Runtime configuration, read at use time.
export const ENV = {
  /** Sessions are bound to this app id so a token from another app never validates here. */
  get appId() { return "topout"; },
  get cookieSecret() { return process.env.SESSION_SECRET ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};

/** Startup check: fail fast with a clear message instead of half-creating the owner on first run. */
export function assertBootConfig(env: Record<string, string | undefined> = process.env): void {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const secret = env.SESSION_SECRET ?? "";
  if (!secret) throw new Error("SESSION_SECRET is not set");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
}
