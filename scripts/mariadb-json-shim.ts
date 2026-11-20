/**
 * TEST ONLY. MariaDB stores JSON as LONGTEXT and returns it as a string, where MySQL returns parsed values. This makes
 * a MariaDB test database behave like MySQL for the schema's json() columns. Import it before anything opens the DB.
 */
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";

const jsonCols = new Set<string>();
for (const t of Object.values(schema)) {
  if (!is(t, MySqlTable)) continue;
  for (const c of Object.values(getTableColumns(t))) if (c.columnType === "MySqlJson") jsonCols.add(`${getTableName(t)}.${c.name}`);
}
type Field = { table: string; name: string; string: () => string | null };
type Cast = (field: Field, next: () => unknown) => unknown;
type Q = { query: (...a: unknown[]) => unknown; execute: (...a: unknown[]) => unknown };
// Drizzle passes its own typeCast on every query; wrap it so json() columns come back parsed, as MySQL returns them.
const withJson = (inner?: Cast): Cast => (field, next) => {
  if (jsonCols.has(`${field.table}.${field.name}`)) {
    const s = field.string();
    return s == null ? null : JSON.parse(s);
  }
  return inner ? inner(field, next) : next();
};
const wrap = (c: Q) => {
  for (const m of ["query", "execute"] as const) {
    const orig = c[m].bind(c);
    c[m] = (sql: unknown, ...rest: unknown[]) => {
      if (sql && typeof sql === "object") (sql as { typeCast?: Cast }).typeCast = withJson((sql as { typeCast?: Cast }).typeCast);
      else if (typeof sql === "string") sql = { sql, typeCast: withJson() };
      return orig(sql, ...rest);
    };
  }
  return c;
};
// db.$client is mysql2's callback pool; drizzle queries it through .promise(), which calls the pool's query/execute,
// and transactions through getConnection, whose connection is wrapped the same way.
const { db } = await import("../server/db");
const pool = (await db()).$client as unknown as Q & { getConnection: (cb: (err: unknown, c: Q) => void) => void };
wrap(pool);
const getConn = pool.getConnection.bind(pool);
pool.getConnection = cb => getConn((err, c) => cb(err, c ? wrap(c) : c));
