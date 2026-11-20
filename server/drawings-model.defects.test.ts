import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import {
  drawingMarks, drawingRevisions, drawingScales, drawingSheets, modelJobs, modelReads, projects,
} from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ db: vi.fn(), requireJobModule: vi.fn(), hasPriv: vi.fn(), logActivity: vi.fn(), storagePut: vi.fn() }));
vi.mock("./db", () => ({ db: mocks.db }));
vi.mock("./bootstrap", () => ({ ensureBootstrap: vi.fn() }));
vi.mock("./security/guard", async importOriginal => ({
  ...await importOriginal<typeof import("./security/guard")>(), requireJobModule: mocks.requireJobModule, hasPriv: mocks.hasPriv,
}));
vi.mock("./services/calendars", async importOriginal => ({
  ...await importOriginal<typeof import("./services/calendars")>(), orgToday: async () => "2026-11-05",
}));
vi.mock("./services/events", async importOriginal => ({
  ...await importOriginal<typeof import("./services/events")>(), logActivity: mocks.logActivity,
}));
vi.mock("./storage", () => ({ storagePut: mocks.storagePut }));

import { bulkRevisionProblem, drawingFileMime, drawingImageMime, drawingsRouter } from "./routers/drawings";
import { jobData, modelRouter, readData } from "./routers/model";

// All fluent DB operations below are in-memory. No MySQL instance or bootstrap is ever invoked.
type Row = Record<string, any>;
type Audit = { operation: string; table: string; transaction: boolean; locked: boolean };
const dialect = new MySqlDialect();
class Fixture {
  rows = new Map<string, Row[]>();
  audit: Audit[] = [];
  onProjectLock?: () => void;
  private queue: Promise<void> = Promise.resolve();
  private nextId = 100;
  constructor() {
    this.seed(projects, [{ id: 1 }, { id: 2 }]);
    this.seed(drawingSheets, [
      { id: 20, projectId: 1, sheetNumber: "E-1", status: "REV", sentDate: "2026-11-05", currentRev: 0 },
      { id: 21, projectId: 2, sheetNumber: "OTHER", status: "DET", currentRev: 0 },
    ]);
    this.seed(drawingRevisions, [
      { id: 30, sheetId: 20, number: 0, state: "issued" },
      { id: 31, sheetId: 20, number: 1, state: "draft" },
      { id: 32, sheetId: 21, number: 0, state: "draft" },
    ]);
    for (const table of [drawingMarks, drawingScales, modelReads, modelJobs]) this.seed(table, []);
  }
  seed(table: any, rows: Row[]) { this.rows.set(getTableName(table), structuredClone(rows)); }
  all(table: any): Row[] { return this.rows.get(getTableName(table)) ?? []; }
  matches(row: Row, where?: SQL): boolean {
    if (!where) return true;
    const { sql, params } = dialect.sqlToQuery(where);
    let index = 0;
    for (const match of sql.matchAll(/`[^`]+`\.`([^`]+)`\s*(=\s*\?|in\s*\((?:\s*\?\s*,?)+\))/g)) {
      const count = (match[2].match(/\?/g) ?? []).length;
      const values = params.slice(index, index + count);
      index += count;
      if (!values.includes(row[match[1]])) return false;
    }
    if (index !== params.length) throw new Error(`Unsupported fixture WHERE: ${sql}`);
    return true;
  }
  connection(transaction = false): any {
    const f = this;
    const audit = (operation: string, table: any, locked = false) => f.audit.push({ operation, table: getTableName(table), transaction, locked });
    return {
      select(fields?: Row) {
        let table: any, where: SQL | undefined, locked = false, limit: number | undefined;
        const q: any = {
          from(t: any) { table = t; return q; },
          where(w: SQL) { where = w; return q; },
          orderBy() { return q; },
          limit(n: number) { limit = n; return q; },
          for(mode: string) { expect(mode).toBe("update"); locked = true; return q; },
          then(resolve: any, reject: any) {
            return Promise.resolve().then(() => {
              audit("select", table, locked);
              if (table === projects && locked && f.onProjectLock) {
                const hook = f.onProjectLock; f.onProjectLock = undefined; hook();
              }
              let rows = f.all(table).filter(r => f.matches(r, where));
              if (limit != null) rows = rows.slice(0, limit);
              return rows.map(row => fields
                ? Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column.name]]))
                : structuredClone(row));
            }).then(resolve, reject);
          },
        };
        return q;
      },
      update(table: any) {
        return { set(patch: Row) { return { async where(where: SQL) {
          audit("update", table);
          let affectedRows = 0;
          for (const row of f.all(table)) if (f.matches(row, where)) { Object.assign(row, structuredClone(patch)); affectedRows++; }
          return [{ affectedRows }];
        } }; } };
      },
      delete(table: any) {
        return { async where(where: SQL) {
          audit("delete", table);
          const before = f.all(table);
          const after = before.filter(r => !f.matches(r, where));
          f.rows.set(getTableName(table), after);
          return [{ affectedRows: before.length - after.length }];
        } };
      },
      insert(table: any) {
        return { values(values: Row) {
          let executed = false, id: number;
          const execute = () => {
            if (!executed) {
              audit("insert", table);
              const keys = table === modelReads ? ["sheetId", "rev", "page"]
                : table === modelJobs ? ["projectId"] : table === drawingScales ? ["sheetId", "rev", "page"] : null;
              if (keys && f.all(table).some(row => keys.every(key => row[key] === values[key]))) {
                throw Object.assign(new Error("Duplicate entry"), { cause: { code: "ER_DUP_ENTRY" } });
              }
              id = ++f.nextId;
              f.rows.set(getTableName(table), [...f.all(table), structuredClone({ id, ...values })]);
              executed = true;
            }
            return [{ id }];
          };
          return {
            $returningId: async () => execute(),
            then: (resolve: any, reject: any) => Promise.resolve().then(execute).then(resolve, reject),
            onDuplicateKeyUpdate({ set }: { set: Row }) {
              return Promise.resolve().then(() => {
                const row = f.all(table).find(r => ["sheetId", "rev", "page"].every(k => r[k] === values[k]));
                if (row) { audit("update", table); Object.assign(row, set); }
                else execute();
              });
            },
          };
        } };
      },
      async transaction(callback: (tx: any) => Promise<any>) {
        const previous = f.queue;
        let unlock!: () => void;
        f.queue = new Promise<void>(resolve => { unlock = resolve; });
        await previous;
        const before = structuredClone(f.rows);
        try { return await callback(f.connection(true)); }
        catch (error) { f.rows = before; throw error; }
        finally { unlock(); }
      },
    };
  }
  expectLockedWrites() {
    const reads = this.audit.filter(a => a.transaction && a.operation === "select");
    expect(reads[0]).toMatchObject({ table: "projects", locked: true });
    expect(reads.every(a => a.locked)).toBe(true);
    expect(this.audit.filter(a => a.operation !== "select").every(a => a.transaction)).toBe(true);
  }
}
const ctx = () => ({ req: { headers: {} }, res: {}, quiet: true, user: { id: 1, role: "user", accessType: "full", isActive: true } }) as unknown as TrpcContext;
const drawing = () => drawingsRouter.createCaller(ctx());
const model = () => modelRouter.createCaller(ctx());
let fixture: Fixture;
const data = readData.parse({ w: 100, h: 100 });
const saveInput = (id: number | null = null, version = 0) => ({ sheetId: 20, rev: 1, page: 1, data, expected: { id, version } });
const readRow = (id = 50, version = 1) => ({ id, projectId: 1, sheetId: 20, rev: 1, page: 1, data, version });

beforeEach(() => {
  vi.clearAllMocks();
  fixture = new Fixture();
  mocks.db.mockResolvedValue(fixture.connection());
  mocks.hasPriv.mockResolvedValue(false);
  mocks.storagePut.mockResolvedValue({ key: "fixture", url: "/fixture" });
});

describe("drawing magic-byte classification (pure)", () => {
  it.each([
    ["ffd8ff", "image/jpeg"], ["89504e470d0a1a0a", "image/png"], ["524946460000000057454250", "image/webp"],
  ])("recognizes %s independently of client metadata", (hex, mime) => {
    expect(drawingImageMime(Buffer.from(hex, "hex"))).toBe(mime);
    expect(drawingFileMime(Buffer.from(hex, "hex"))).toBe(mime);
  });
  it.each(["", "ffd8", "89504e470d0a1a", "524946460000000057415645", "5249464657454250", "<svg/onload=alert(1)>", "<!doctype html><script>alert(1)</script>"])("rejects unsupported or incomplete image signatures: %s", value => {
    const bytes = /^[0-9a-f]+$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value);
    expect(drawingImageMime(bytes)).toBeNull();
    expect(drawingFileMime(bytes)).toBe("application/octet-stream");
  });
  it("classifies only a leading complete PDF signature as PDF", () => {
    expect(drawingFileMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(drawingFileMime(Buffer.from("%PDF"))).toBe("application/octet-stream");
    expect(drawingFileMime(Buffer.from(" %PDF-1.7"))).toBe("application/octet-stream");
    expect(drawingImageMime(Buffer.from("%PDF-1.7"))).toBeNull();
  });
});

describe("observed bulk revision validation (pure)", () => {
  const sheet = { id: 20, projectId: 1 };
  const item = { projectId: 1, sheetId: 20, revisionId: 31 };
  const draft = { id: 31, sheetId: 20, number: 1, state: "draft" };
  it("accepts only the observed pending revision in the required state", () => {
    expect(bulkRevisionProblem(item, sheet, [draft], "signoff")).toBe("");
    expect(bulkRevisionProblem(item, sheet, [{ ...draft, state: "checked" }], "issue")).toBe("");
  });
  it("rejects a replacement reusing the observed revision number", () => {
    expect(bulkRevisionProblem(item, sheet, [{ ...draft, id: 99 }], "signoff")).toMatch(/no longer/);
  });
  it("rejects foreign sheets, jobs and revision membership", () => {
    expect(bulkRevisionProblem(item, { ...sheet, projectId: 2 }, [draft], "signoff")).toMatch(/job/);
    expect(bulkRevisionProblem(item, { ...sheet, id: 21 }, [draft], "signoff")).toMatch(/job/);
    expect(bulkRevisionProblem(item, sheet, [{ ...draft, sheetId: 21 }], "signoff")).toMatch(/no longer/);
  });
  it("rejects changed state and a different current pending revision", () => {
    expect(bulkRevisionProblem(item, sheet, [{ ...draft, state: "issued" }], "issue")).toMatch(/changed state/);
    expect(bulkRevisionProblem(item, sheet, [draft, { ...draft, id: 99, number: 2 }], "signoff")).toMatch(/pending revision/);
  });
});

describe("bulk router revision binding", () => {
  it.each(["signoff", "issue"] as const)("does not %s a revision replaced while waiting for the lock", async step => {
    fixture.all(drawingRevisions)[1].state = step === "issue" ? "checked" : "draft";
    fixture.onProjectLock = () => { fixture.all(drawingRevisions)[1].id = 99; };
    const result = await drawing().bulk({ projectId: 1, items: [{ sheetId: 20, revisionId: 31 }], step });
    expect(result.done).toBe(0);
    expect(result.skipped).toEqual([expect.stringMatching(/no longer/)]);
    expect(fixture.audit.filter(a => a.operation !== "select")).toEqual([]);
    fixture.expectLockedWrites();
  });
  it("returns explicit item failures for wrong membership, wrong job and missing sheets", async () => {
    const result = await drawing().bulk({ projectId: 1, step: "signoff", items: [
      { sheetId: 20, revisionId: 32 }, { sheetId: 21, revisionId: 32 }, { sheetId: 999, revisionId: 31 },
    ] });
    expect(result.done).toBe(0);
    expect(result.skipped).toHaveLength(3);
    expect(fixture.audit.filter(a => a.operation !== "select")).toEqual([]);
  });
  it("preserves partial success and counts a duplicate submitted revision only once", async () => {
    const result = await drawing().bulk({ projectId: 1, step: "signoff", items: [
      { sheetId: 20, revisionId: 31 }, { sheetId: 20, revisionId: 31 }, { sheetId: 20, revisionId: 999 },
    ] });
    expect(result.done).toBe(1);
    expect(result.skipped).toHaveLength(2);
    expect(fixture.all(drawingRevisions)[1].state).toBe("checked");
    fixture.expectLockedWrites();
  });
  it("fails closed for old sheet-ID-only payloads", async () => {
    await expect(drawing().bulk({ projectId: 1, sheetIds: [20], step: "signoff" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.audit).toEqual([]);
  });
});

describe("discarded revision artifact isolation", () => {
  it("deletes every page's marks, scales and reads only on the discarded sheet/revision", async () => {
    for (const table of [drawingMarks, drawingScales, modelReads]) fixture.seed(table, [
      { id: 60, sheetId: 20, rev: 1, page: 1 }, { id: 61, sheetId: 20, rev: 1, page: 2 },
      { id: 62, sheetId: 20, rev: 0, page: 1 }, { id: 63, sheetId: 21, rev: 1, page: 1 },
    ]);
    await drawing().discardDraft({ revisionId: 31 });
    for (const table of [drawingMarks, drawingScales, modelReads]) expect(fixture.all(table).map(r => r.id)).toEqual([62, 63]);
    await drawing().startRevision({ sheetId: 20 });
    expect(fixture.all(drawingRevisions).find(r => r.sheetId === 20 && r.number === 1)?.id).not.toBe(31);
    fixture.expectLockedWrites();
  });
  it.each(["mark", "scale", "read"] as const)("revalidates revision existence after locking for a %s save", async kind => {
    fixture.onProjectLock = () => fixture.seed(drawingRevisions, fixture.all(drawingRevisions).filter(r => r.id !== 31));
    const call = kind === "mark" ? drawing().saveMark({ sheetId: 20, rev: 1, kind: "note", points: [[0.1, 0.1]] })
      : kind === "scale" ? drawing().setScale({ sheetId: 20, rev: 1, feetPerWidth: 20 }) : model().saveRead(saveInput());
    await expect(call).rejects.toThrow(/has no Rev 1/);
    expect(fixture.audit.filter(a => a.operation !== "select")).toEqual([]);
    fixture.expectLockedWrites();
  });
  it.each(["mark", "scale", "read"] as const)("cannot recreate %s artifacts after concurrent discard", async kind => {
    const discard = drawing().discardDraft({ revisionId: 31 });
    const save = kind === "mark" ? drawing().saveMark({ sheetId: 20, rev: 1, kind: "note", points: [[0.1, 0.1]] })
      : kind === "scale" ? drawing().setScale({ sheetId: 20, rev: 1, feetPerWidth: 20 }) : model().saveRead(saveInput());
    await Promise.allSettled([discard, save]);
    expect(fixture.all(drawingRevisions).some(r => r.id === 31)).toBe(false);
    for (const table of [drawingMarks, drawingScales, modelReads]) expect(fixture.all(table)).toEqual([]);
    fixture.expectLockedWrites();
  });
  it("refuses scales on nonexistent revisions, including scale clearing", async () => {
    for (const feetPerWidth of [20, null]) await expect(drawing().setScale({ sheetId: 20, rev: 999, feetPerWidth })).rejects.toThrow(/has no Rev 999/);
    expect(fixture.all(drawingScales)).toEqual([]);
  });
  it("still saves valid markups and scale updates under locks", async () => {
    await drawing().saveMark({ sheetId: 20, rev: 1, kind: "note", points: [[0.1, 0.1]] });
    await drawing().setScale({ sheetId: 20, rev: 1, feetPerWidth: 20 });
    await drawing().setScale({ sheetId: 20, rev: 1, feetPerWidth: 30 });
    expect(fixture.all(drawingMarks)).toHaveLength(1);
    expect(fixture.all(drawingScales)).toMatchObject([{ feetPerWidth: 30 }]);
    fixture.expectLockedWrites();
  });
});

describe("model read identity/version compare-and-swap", () => {
  it("creates a first read and increments exactly the observed row's version", async () => {
    const first = await model().saveRead(saveInput());
    expect(first.version).toBe(1);
    const second = await model().saveRead({ ...saveInput(first.id, 1), data: { ...data, lvl: "Roof" } });
    expect(second).toEqual({ id: first.id, version: 2 });
    expect(fixture.all(modelReads)[0].data.lvl).toBe("Roof");
    fixture.expectLockedWrites();
  });
  it("does not overwrite a version-1 replacement using a deleted version-1 identity", async () => {
    fixture.seed(modelReads, [readRow(50, 1)]);
    await model().removeRead({ id: 50, version: 1 });
    const replacement = await model().saveRead(saveInput());
    expect(replacement.version).toBe(1);
    await expect(model().saveRead(saveInput(50, 1))).rejects.toMatchObject({ code: "CONFLICT", message: "Someone else changed this read — reload" });
    expect(fixture.all(modelReads)).toMatchObject([{ id: replacement.id, version: 1 }]);
  });
  it("does not overwrite an existing read when expected identity is null", async () => {
    fixture.seed(modelReads, [readRow()]);
    await expect(model().saveRead(saveInput())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.all(modelReads)).toMatchObject([{ id: 50, version: 1 }]);
  });
  it("gives simultaneous first inserts only one winner", async () => {
    const results = await Promise.allSettled([model().saveRead(saveInput()), model().saveRead(saveInput())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(fixture.all(modelReads)).toHaveLength(1);
  });
  it.each(["version", "sheet", "rev", "page"])("rejects a save with mismatched %s", async field => {
    fixture.seed(modelReads, [{ ...readRow(), [field === "sheet" ? "sheetId" : field]: field === "sheet" ? 21 : 2 }]);
    await expect(model().saveRead(saveInput(50, 1))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses stale-version and already-deleted remove requests", async () => {
    fixture.seed(modelReads, [readRow(50, 2)]);
    await expect(model().removeRead({ id: 50, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.all(modelReads)).toHaveLength(1);
    await model().removeRead({ id: 50, version: 2 });
    await expect(model().removeRead({ id: 50, version: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("checks delete version after waiting for the lock", async () => {
    fixture.seed(modelReads, [readRow()]);
    fixture.onProjectLock = () => { fixture.all(modelReads)[0].version = 2; };
    await expect(model().removeRead({ id: 50, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.audit.filter(a => a.operation === "delete")).toHaveLength(1);
    fixture.expectLockedWrites();
  });
  it("preserves the model editor privilege requirement", async () => {
    mocks.requireJobModule.mockRejectedValueOnce(new Error("project.edit required"));
    await expect(model().saveRead(saveInput())).rejects.toThrow(/project.edit/);
    expect(fixture.audit.filter(a => a.operation !== "select")).toEqual([]);
  });
});

describe("model settings compare-and-swap", () => {
  const settings = jobData.parse({});
  it("creates and updates using the project's primary key plus expected version", async () => {
    await expect(model().saveSettings({ projectId: 1, data: settings, expectedVersion: 0 })).resolves.toEqual({ version: 1 });
    await expect(model().saveSettings({ projectId: 1, data: { ...settings, allow: 10 }, expectedVersion: 1 })).resolves.toEqual({ version: 2 });
    expect(fixture.all(modelJobs)).toMatchObject([{ projectId: 1, version: 2, data: { allow: 10 } }]);
    fixture.expectLockedWrites();
  });
  it("rejects stale creation, stale updates and updates of missing settings", async () => {
    fixture.seed(modelJobs, [{ projectId: 1, version: 2, data: settings }]);
    for (const expectedVersion of [0, 1]) await expect(model().saveSettings({ projectId: 1, data: settings, expectedVersion })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(model().saveSettings({ projectId: 2, data: settings, expectedVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.all(modelJobs)).toMatchObject([{ projectId: 1, version: 2 }]);
  });
});

describe("uploads use canonical MIME types", () => {
  it.each([
    ["%PDF-1.7", "image/svg+xml", "application/pdf"], ["<script>alert(1)</script>", "application/pdf", "application/octet-stream"],
  ])("stores %s as %s-independent canonical MIME", async (content, mimeType, expected) => {
    await drawing().attachFile({ revisionId: 31, file: { fileName: "drawing.pdf", mimeType, base64: Buffer.from(content).toString("base64") } });
    expect(mocks.storagePut).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), expected);
    expect(fixture.all(drawingRevisions)[1].mimeType).toBe(expected);
  });
  it("rejects HTML disguised as a preview before storage", async () => {
    await expect(drawing().startRevision({ sheetId: 20, preview: {
      fileName: "preview.png", mimeType: "image/png", base64: Buffer.from("<svg onload='alert(1)'/>").toString("base64"),
    } })).rejects.toThrow("The page preview must be a JPEG, PNG or WebP image");
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
  it("stores a recognized image preview with its canonical MIME despite client metadata", async () => {
    fixture.seed(drawingRevisions, fixture.all(drawingRevisions).filter(r => r.id !== 31));
    await drawing().startRevision({ sheetId: 20, preview: { fileName: "preview.bin", mimeType: "text/html", base64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") } });
    expect(mocks.storagePut).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), "image/png");
  });
});
