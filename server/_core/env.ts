// Runtime configuration, read at use time.
export const ENV = {
  /** Sessions are bound to this app id so a token from another app never validates here. */
  get appId() { return "topout"; },
  get cookieSecret() { return process.env.SESSION_SECRET ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
