import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import {
  customFieldValues, drawingRevisions, drawingSetIssues, drawingSets, drawingSheets,
  projects, wfApps, wfEvents, wfItems,
} from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  db: vi.fn(), requireJobModule: vi.fn(), hasPriv: vi.fn(), requirePriv: vi.fn(),
  logActivity: vi.fn(), emit: vi.fn(), getApp: vi.fn(),
}));
vi.mock("./db", () => ({ db: mocks.db }));
vi.mock("./bootstrap", () => ({ ensureBootstrap: vi.fn() }));
vi.mock("./security/guard", async importOriginal => ({
  ...await importOriginal<typeof import("./security/guard")>(),
  requireJobModule: mocks.requireJobModule, hasPriv: mocks.hasPriv, requirePriv: mocks.requirePriv,
}));
vi.mock("./services/calendars", async importOriginal => ({
  ...await importOriginal<typeof import("./services/calendars")>(), orgToday: async () => "2026-11-05",
}));
vi.mock("./services/events", async importOriginal => ({
  ...await importOriginal<typeof import("./services/events")>(), logActivity: mocks.logActivity, emit: mocks.emit,
}));
vi.mock("./services/wf", async importOriginal => ({
  ...await importOriginal<typeof import("./services/wf")>(), getApp: mocks.getApp,
  itemLabel: (_app: unknown, item: { number: number }) => `RFI-${item.number}`,
}));
vi.mock("./storage", () => ({ storagePut: vi.fn(async () => ({ key: "fixture.pdf", url: "/fixture.pdf" })) }));

import { drawingsRouter } from "./routers/drawings";
import { wfRouter } from "./routers/wf";

// Never connects to a DB. The fixture implements only the fluent operations used by these mutations,
// evaluates their real Drizzle WHERE expressions, serializes transactions, and audits every current read.
type Row = Record<string, any>;
type Audit = { operation: string; table: string; transaction: boolean; locked: boolean };
const dialect = new MySqlDialect();
class Fixture {
  rows = new Map<string, Row[]>();
  audit: Audit[] = [];
  onProjectLock?: () => void;
  private queue: Promise<void> = Promise.resolve();
  constructor() {
    this.seed(projects, [{ id: 1 }]);
    this.seed(drawingSets, [{ id: 10, projectId: 1, number: "E-SET", name: "Erection", kind: "erection" }]);
    this.seed(drawingSheets, [{ id: 20, projectId: 1, setId: 10, sheetNumber: "E-1", sheetKey: "e1", title: "Framing", status: "REV", sentDate: "2026-11-05", returnedDate: null, holdFrom: null, holdRfiId: null, ballInCourt: "GC", currentRev: 0 }]);
    this.seed(drawingRevisions, [{ id: 30, sheetId: 20, number: 0, state: "issued", url: null }]);
    this.seed(wfApps, [{ id: 50, key: "rfi", scope: "project" }]);
    this.seed(wfItems, [{ id: 40, appId: 50, projectId: 1, number: 1, title: "Embed conflict", closedAt: null }]);
    this.seed(drawingSetIssues, []);
    this.seed(wfEvents, [{ id: 60, itemId: 40 }]);
    this.seed(customFieldValues, [{ id: 70, entityType: "app:rfi", entityId: 40 }]);
  }
  seed(table: any, rows: Row[]) { this.rows.set(getTableName(table), structuredClone(rows)); }
  all(table: any) { return this.rows.get(getTableName(table)) ?? []; }
  matches(row: Row, where?: SQL): boolean {
    if (!where) return true;
    const { sql, params } = dialect.sqlToQuery(where);
    let index = 0;
    for (const match of sql.matchAll(/`[^`]+`\.`([^`]+)`\s*(=\s*\?|in\s*\((?:\s*\?\s*,?)+\))/g)) {
      const key = match[1];
      const count = (match[2].match(/\?/g) ?? []).length;
      const values = params.slice(index, index + count);
      index += count;
      if (!values.includes(row[key])) return false;
    }
    if (index !== params.length) throw new Error(`Unsupported fixture predicate: ${sql}`);
    return true;
  }
  connection(transaction = false): any {
    const f = this;
    return {
      select(fields?: Row) {
        let table: any, where: SQL | undefined, locked = false, limit: number | undefined, join = false;
        const q: any = {
          from(t: any) { table = t; return q; },
          where(w: SQL) { where = w; return q; },
          innerJoin() { join = true; return q; },
          orderBy() { return q; },
          limit(n: number) { limit = n; return q; },
          for(mode: string) { expect(mode).toBe("update"); locked = true; return q; },
          then(resolve: any, reject: any) {
            return Promise.resolve().then(() => {
              const name = getTableName(table);
              f.audit.push({ operation: "select", table: name, transaction, locked });
              if (table === projects && locked && f.onProjectLock) {
                const hook = f.onProjectLock; f.onProjectLock = undefined; hook();
              }
              let rows = f.all(table).filter(r => f.matches(r, where));
              if (limit != null) rows = rows.slice(0, limit);
              return rows.map(row => {
                if (join) return { item: structuredClone(row), app: structuredClone(f.all(wfApps).find(a => a.id === row.appId)) };
                if (!fields) return structuredClone(row);
                return Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column.name]]));
              });
            }).then(resolve, reject);
          },
        };
        return q;
      },
      update(table: any) {
        return { set(patch: Row) { return { async where(where: SQL) {
          f.audit.push({ operation: "update", table: getTableName(table), transaction, locked: false });
          for (const row of f.all(table)) if (f.matches(row, where)) Object.assign(row, patch);
        } }; } };
      },
      delete(table: any) {
        return { async where(where: SQL) {
          f.audit.push({ operation: "delete", table: getTableName(table), transaction, locked: false });
          f.rows.set(getTableName(table), f.all(table).filter(r => !f.matches(r, where)));
        } };
      },
      insert(table: any) {
        return { values(values: Row) {
          let id: number | undefined;
          const execute = () => {
            if (id == null) {
              id = Math.max(100, ...f.all(table).map(r => r.id ?? 0)) + 1;
              f.audit.push({ operation: "insert", table: getTableName(table), transaction, locked: false });
              f.rows.set(getTableName(table), [...f.all(table), structuredClone({ id, ...values })]);
            }
            return [{ id }];
          };
          return { $returningId: async () => execute(), then: (resolve: any, reject: any) => Promise.resolve().then(execute).then(resolve, reject) };
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
  expectLockedReads() {
    const reads = this.audit.filter(a => a.transaction && a.operation === "select");
    expect(reads[0]).toMatchObject({ table: "projects", locked: true });
    expect(reads.every(a => a.locked)).toBe(true);
    expect(this.audit.filter(a => a.operation !== "select").every(a => a.transaction)).toBe(true);
  }
  expectNoWrites() { expect(this.audit.filter(a => a.operation !== "select")).toEqual([]); }
}
const ctx = () => ({
  req: { headers: {} }, res: {}, quiet: true,
  user: { id: 1, role: "admin", accessType: "full", isActive: true },
}) as unknown as TrpcContext;
let fixture: Fixture;
const drawing = () => drawingsRouter.createCaller(ctx());
const workflow = () => wfRouter.createCaller(ctx());

beforeEach(() => {
  vi.clearAllMocks();
  fixture = new Fixture();
  mocks.db.mockResolvedValue(fixture.connection());
  mocks.hasPriv.mockResolvedValue(false);
  mocks.getApp.mockImplementation(async () => fixture.all(wfApps)[0]);
});

describe("revision-bound drawing review", () => {
  it.each(["approve", "revise"] as const)("fails closed for missing or stale expectedRevisionId on %s", async action => {
    fixture.seed(drawingRevisions, [
      { id: 30, sheetId: 20, number: 0, state: "superseded" },
      { id: 31, sheetId: 20, number: 1, state: "issued" },
    ]);
    for (const expectedRevisionId of [undefined, 30, 999]) {
      await expect(drawing().action({ id: 20, action, expectedRevisionId })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/reload and review/) });
    }
    expect(fixture.all(drawingSheets)[0].status).toBe("REV");
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it.each([["approve", "REL"], ["revise", "RR"]] as const)("accepts a matching observed revision for %s", async (action, status) => {
    await expect(drawing().action({ id: 20, action, expectedRevisionId: 30 })).resolves.toEqual({ status });
    expect(fixture.all(drawingSheets)[0].status).toBe(status);
    fixture.expectLockedReads();
  });
  it("checks the revision after waiting for the project lock", async () => {
    fixture.onProjectLock = () => fixture.seed(drawingRevisions, [{ id: 31, sheetId: 20, number: 1, state: "issued" }]);
    await expect(drawing().action({ id: 20, action: "approve", expectedRevisionId: 30 })).rejects.toMatchObject({ code: "CONFLICT" });
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it("cannot approve when no issued revision exists, even with an ID", async () => {
    fixture.all(drawingRevisions)[0].state = "draft";
    await expect(drawing().action({ id: 20, action: "approve", expectedRevisionId: 30 })).rejects.toMatchObject({ code: "CONFLICT" });
    fixture.expectNoWrites();
  });
});

describe("RFI hold integrity", () => {
  beforeEach(() => Object.assign(fixture.all(drawingSheets)[0], { status: "HOLD", holdFrom: "REL", holdRfiId: 40 }));
  it.each(["deleted", "wrong job", "wrong type"])("blocks hold release for a %s holding RFI", async kind => {
    if (kind === "deleted") fixture.seed(wfItems, []);
    if (kind === "wrong job") fixture.all(wfItems)[0].projectId = 2;
    if (kind === "wrong type") fixture.all(wfApps)[0].key = "submittal";
    await expect(drawing().action({ id: 20, action: "release" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/PM resolution/) });
    expect(fixture.all(drawingSheets)[0].status).toBe("HOLD");
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it("still blocks open RFIs but allows properly closed RFIs", async () => {
    await expect(drawing().action({ id: 20, action: "release" })).rejects.toThrow(/close the RFI/);
    fixture.all(wfItems)[0].closedAt = new Date();
    await expect(drawing().action({ id: 20, action: "release" })).resolves.toEqual({ status: "REL" });
    expect(fixture.all(drawingSheets)[0].holdRfiId).toBeNull();
    fixture.expectLockedReads();
  });
  it("allows a reason-only hold to be released without a revision precondition", async () => {
    fixture.all(drawingSheets)[0].holdRfiId = null;
    await expect(drawing().action({ id: 20, action: "release" })).resolves.toEqual({ status: "REL" });
  });
  it.each([null, new Date()])("blocks RFI deletion while any HOLD drawing references it (closedAt=%s)", async closedAt => {
    fixture.all(wfItems)[0].closedAt = closedAt;
    await expect(workflow().remove({ id: 40 })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/holds drawing/) });
    expect(fixture.all(wfItems)).toHaveLength(1);
    expect(fixture.all(wfEvents)).toHaveLength(1);
    expect(fixture.all(customFieldValues)).toHaveLength(1);
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it("deletes an unreferenced RFI and its values/events in the same locked transaction", async () => {
    fixture.all(drawingSheets)[0].status = "REL";
    await workflow().remove({ id: 40 });
    expect(fixture.all(wfItems)).toEqual([]);
    expect(fixture.all(wfEvents)).toEqual([]);
    expect(fixture.all(customFieldValues)).toEqual([]);
    fixture.expectLockedReads();
  });
});

describe("atomic set issue snapshot and issue evidence", () => {
  it("locks project, set, sheets, revisions and issue number before inserting a metadata-only snapshot", async () => {
    fixture.all(drawingSheets)[0].status = "REL";
    await expect(drawing().recordIssue({ setId: 10, purpose: "For erection", issueDate: "2026-11-05" })).resolves.toMatchObject({ number: 1, recorded: 1 });
    expect(fixture.audit.filter(a => a.transaction).map(a => a.table)).toEqual([
      "projects", "drawing_sets", "drawing_sheets", "drawing_revisions", "drawing_set_issues", "drawing_set_issues",
    ]);
    expect(fixture.all(drawingSetIssues)[0].sheets).toMatchObject([{ sheetId: 20, rev: 0, status: "REL", fileUrl: null }]);
    fixture.expectLockedReads();
  });
  it.each(["REV", "HOLD"])("reads post-lock sheet/revision state atomically, excluding new unapproved R1 (%s)", async status => {
    fixture.all(drawingSheets)[0].status = "REL";
    fixture.onProjectLock = () => {
      fixture.all(drawingSheets)[0].status = status;
      fixture.seed(drawingRevisions, [{ id: 31, sheetId: 20, number: 1, state: "issued" }]);
    };
    await expect(drawing().recordIssue({ setId: 10, purpose: "For erection", issueDate: "2026-11-05" })).rejects.toThrow(/No sheet.*released/);
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it("rejects fabrication at the server input boundary", async () => {
    await expect(drawing().recordIssue({ setId: 10, purpose: "For fabrication", issueDate: "2026-11-05" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.audit).toEqual([]);
  });
  it.each(["renumber", "delete"])("checks newly recorded issue evidence inside the write transaction before uploader %s", async kind => {
    fixture.onProjectLock = () => fixture.seed(drawingSetIssues, [{ id: 80, projectId: 1, setId: 10, number: 1, sheets: [{ sheetId: 20 }] }]);
    const request = kind === "delete" ? drawing().removeSheet({ id: 20 }) : drawing().saveSheet({ id: 20, projectId: 1, setId: 10, sheetNumber: "E-2", title: "Framing" });
    await expect(request).rejects.toThrow(/only an editor/);
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it("preserves editor permission to renumber a recorded sheet", async () => {
    mocks.hasPriv.mockResolvedValue(true);
    fixture.seed(drawingSetIssues, [{ id: 80, projectId: 1, setId: 10, number: 1, sheets: [{ sheetId: 20 }] }]);
    await drawing().saveSheet({ id: 20, projectId: 1, setId: 10, sheetNumber: "E-2", title: "Framing" });
    expect(fixture.all(drawingSheets)[0].sheetNumber).toBe("E-2");
    fixture.expectLockedReads();
  });
  it("revalidates sheet ownership after the project lock", async () => {
    fixture.onProjectLock = () => { fixture.all(drawingSheets)[0].projectId = 2; };
    await expect(drawing().action({ id: 20, action: "approve", expectedRevisionId: 30 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    fixture.expectNoWrites();
  });
  it("revalidates deleted set membership under the project lock", async () => {
    fixture.onProjectLock = () => fixture.seed(drawingSets, []);
    await expect(drawing().saveSheet({ projectId: 1, setId: 10, sheetNumber: "E-2", title: "Framing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    fixture.expectNoWrites();
    fixture.expectLockedReads();
  });
  it("uses current locked revision reads so concurrent double-issue has one success", async () => {
    fixture.all(drawingRevisions)[0].state = "checked";
    const results = await Promise.allSettled([drawing().issueRevision({ revisionId: 30 }), drawing().issueRevision({ revisionId: 30 })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(fixture.all(drawingRevisions).filter(r => r.state === "issued")).toHaveLength(1);
    fixture.expectLockedReads();
  });
});
