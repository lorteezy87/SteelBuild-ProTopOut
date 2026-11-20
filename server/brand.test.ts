import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".superpowers", "docs"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "brand.test.ts"]);
const TEXT = /\.(ts|tsx|js|cjs|mjs|json|html|css|md|sql|svg|yaml|yml)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (!SKIP_FILES.has(e.name)) out.push(p);
  }
  return out;
}

describe("brand", () => {
  it("no legacy name in source", () => {
    const hits: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = path.relative(ROOT, f);
      if (/keystone/i.test(rel) || /(^|\/)ks(\/|$)/.test(rel)) hits.push(`path: ${rel}`);
      if (!TEXT.test(f)) continue;
      const s = fs.readFileSync(f, "utf8");
      if (/keystone/i.test(s)) hits.push(`keystone: ${rel}`);
      if (/(^|[^a-zA-Z0-9-])(--)?ks-|components\/ks\b|\.\/ks\//.test(s)) hits.push(`ks-: ${rel}`);
    }
    expect(hits).toEqual([]);
  });

  it("product title", () => {
    const html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
    expect(html).toContain("<title>SteelBuild Pro TopOut</title>");
  });
});
