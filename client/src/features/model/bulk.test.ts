import { describe, expect, it, vi } from "vitest";
import { MD, REVIEW, FIELD_MAX, type Piece, type ReadData } from "./domain";
import { blank, pc, rec, sheetOf } from "./fixtures";
import { applyPieceBulk, changePieceBulk, pieceDeleteFacts, pieceSelection, togglePieceSelection, type PieceBulkApi, type PieceBulkOp } from "./bulk";

const who = { by: 7, at: "2026-11-06T10:00:00Z" };
const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({ ...pc(id, "B1", "W18X40", 20), ...extra });
const page = (): ReadData => blank({ pcs: [piece("auto"), piece("ok", { st: "ok" }), piece("edit", { st: "edit" }), piece("hand", { st: "add", via: "hand" }), piece("no", { st: "no" })] });
const ids = ["auto", "ok", "edit", "hand", "no"];

// No database imports or calls: synthetic reads and a save spy only.
describe("pure bulk review", () => {
  it("accepts only suggestions, preserving fixed/added pieces and leaving rejections rejected", () => {
    const d = page(), before = structuredClone(d);
    const ch = changePieceBulk(d, [...ids, "auto", "missing"], { type: "accept" }, who);
    expect(ch.changed).toBe(1);
    expect(ch.summary).toBe("Bulk: 1 piece accepted");
    expect(ch.data.pcs.map(p => p.st)).toEqual(["ok", "ok", "edit", "add", "no"]);
    expect(ch.data.pcs[0]).toMatchObject(who);
    expect(ch.data.pcs[2]).toBe(d.pcs[2]);
    expect(d).toEqual(before);
    expect(changePieceBulk(ch.data, ids, { type: "accept" }, who)).toMatchObject({ changed: 0, data: ch.data });
  });
  it("marks suggested accepted/fixed/rejected pieces needs review but skips hand-added and already-auto pieces", () => {
    const d = page();
    d.pcs.push(piece("handNo", { st: "no", via: "hand" }), piece("oddAdd", { st: "add", via: "" }));
    const ch = changePieceBulk(d, [...ids, "handNo", "oddAdd"], { type: "review" }, who);
    expect(ch.changed).toBe(3);
    expect(ch.summary).toBe("Bulk: 3 pieces marked needs review");
    expect(ch.data.pcs.map(p => p.st)).toEqual(["auto", "auto", "auto", "add", "auto", "no", "add"]);
    expect(changePieceBulk(ch.data, [...ids, "handNo", "oddAdd"], { type: "review" }, who).changed).toBe(0);
  });
  it("rejects live suggestions, accepted, fixed and hand-added pieces once", () => {
    const d = page(), ch = changePieceBulk(d, ids, { type: "reject" }, who);
    expect(ch.changed).toBe(4);
    expect(ch.summary).toBe("Bulk: 4 pieces rejected");
    expect(ch.data.pcs.every(p => p.st === "no")).toBe(true);
    expect(ch.data.pcs[3]).toMatchObject({ via: "hand", ...who });
    expect(changePieceBulk(ch.data, ids, { type: "reject" }, who).data).toBe(ch.data);
  });
  it.each<PieceBulkOp>([{ type: "accept" }, { type: "review" }, { type: "reject" }, { type: "delete" }, { type: "edit", fields: { mark: "B2" } }, { type: "edit", fields: { size: "W24X55" } }, { type: "edit", fields: { kind: "joist" } }])("skips missing IDs and empty selection for $type", op => {
    const d = page();
    for (const selected of [[], ["missing"]]) {
      const ch = changePieceBulk(d, selected, op, who);
      expect(ch.changed).toBe(0); expect(ch.data).toBe(d);
    }
  });
  it("deletes suggested and hand-added pieces entirely, preserves page data, and deduplicates IDs", () => {
    const d = page(), before = structuredClone(d);
    const ch = changePieceBulk(d, ["auto", "hand", "hand", "no"], { type: "delete" }, who);
    expect(ch.changed).toBe(3);
    expect(ch.summary).toBe("Bulk: 3 pieces deleted");
    expect(ch.data.pcs.map(p => p.id)).toEqual(["ok", "edit"]);
    expect(ch.data.left).toBe(d.left); expect(ch.data.cols).toBe(d.cols); expect(ch.data.grids).toBe(d.grids);
    expect(d).toEqual(before);
    expect(changePieceBulk(ch.data, ["auto", "hand", "no"], { type: "delete" }, who).data).toBe(ch.data);
    expect(changePieceBulk(d, ids, { type: "delete" }, who).data.pcs).toEqual([]);
  });
});

describe("pure bulk fields follow the single-piece fix", () => {
  it.each([
    [{ mark: " b2 " }, { mark: "B2", size: "W18X40", k: "beam" }],
    [{ size: " w24 x 55 " }, { mark: "B1", size: "W24X55", k: "beam" }],
    [{ kind: "joist" as const }, { mark: "B1", size: "W18X40", k: "joist" }],
  ])("changes one field and leaves every other field intact: %j", (fields, expected) => {
    const p = piece("p", { note: " keep this note ", ends: [["A"], ["B"]] });
    const d = blank({ pcs: [p] });
    const ch = changePieceBulk(d, ["p", "p"], { type: "edit", fields }, who);
    expect(ch.changed).toBe(1); expect(ch.summary).toBe("Bulk: 1 piece edited");
    expect(ch.data.pcs[0]).toMatchObject({ ...expected, st: "edit", ...who, note: p.note, len: p.len });
    expect(ch.data.pcs[0].a).toBe(p.a); expect(ch.data.pcs[0].ends).toBe(p.ends);
    expect(changePieceBulk(ch.data, ["p"], { type: "edit", fields }, who).data).toBe(ch.data);
  });
  it("matches REVIEW.fix for cleaned fields and states, including added and rejected pieces", () => {
    const d = page(), fields = { mark: " t12 ", size: "26 k 9", kind: "joist" as const };
    const ch = changePieceBulk(d, ids, { type: "edit", fields }, who);
    expect(ch.changed).toBe(5);
    for (const p of ch.data.pcs) {
      const single = REVIEW.fix(d, p.id, { mark: fields.mark, size: fields.size, k: fields.kind }, who)!;
      expect(p).toEqual(single.data.pcs.find(q => q.id === p.id));
    }
    expect(ch.data.pcs.map(p => p.st)).toEqual(["edit", "edit", "edit", "add", "edit"]);
  });
  it("does not mark unchanged suggestions fixed or normalize untouched fields", () => {
    const d = blank({ pcs: [piece("p", { mark: "b1", size: "w18 x 40" })] });
    expect(changePieceBulk(d, ["p"], { type: "edit", fields: {} }, who).data).toBe(d);
    expect(changePieceBulk(d, ["p"], { type: "edit", fields: { kind: "beam" } }, who).data).toBe(d);
    const ch = changePieceBulk(d, ["p"], { type: "edit", fields: { kind: "joist" } }, who);
    expect(ch.data.pcs[0]).toMatchObject({ mark: "b1", size: "w18 x 40" });
    const normalized = blank({ pcs: [piece("p")] });
    expect(changePieceBulk(normalized, ["p"], { type: "edit", fields: { mark: " b1 ", size: "w18 x40", kind: "beam" } }, who).data).toBe(normalized);
  });
  it("explicit blank clears a field; undefined leaves unchanged; field caps match single-piece forms", () => {
    const d = page();
    const cleared = changePieceBulk(d, ["auto"], { type: "edit", fields: { mark: "", size: undefined } }, who);
    expect(cleared.data.pcs[0]).toMatchObject({ mark: "", size: "W18X40", st: "edit" });
    const long = changePieceBulk(d, ["auto"], { type: "edit", fields: { mark: "a".repeat(100), size: "w".repeat(100) } }, who);
    expect(long.data.pcs[0].mark).toBe("A".repeat(FIELD_MAX.mark));
    expect(long.data.pcs[0].size).toBe("W".repeat(FIELD_MAX.size));
  });
  it("recomputes derived beam/joist weights without changing stored length", () => {
    const r = rec(1, 0, [piece("p")]), sheets = [sheetOf(1, "E1", [{ n: 0, state: "issued", pdf: true }])];
    const size = changePieceBulk(r, ["p"], { type: "edit", fields: { size: "W24X55" } }, who);
    expect(MD.rows(sheets, [{ ...r, ...size.data }], MD.noSettings())[0].lb).toBe(1100);
    const joist = changePieceBulk(size.data, ["p"], { type: "edit", fields: { kind: "joist", mark: "T12" } }, who);
    expect(MD.rows(sheets, [{ ...r, ...joist.data }], { allow: 5, base: null, jw: [{ mark: "T12", lb: 2000 }] })[0].lb).toBe(2100);
    expect(joist.data.pcs[0].len).toBe(r.pcs[0].len);
  });
});

describe("visible selection and delete guards", () => {
  it("keeps filter-hidden choices but never includes them; removed choices are pruned", () => {
    const selected = new Set(["a", "b", "removed"]);
    expect(pieceSelection(selected, ["a", "b", "c"], ["b", "c"])).toEqual({ keys: ["b"], hidden: 1 });
    expect(pieceSelection(selected, ["a", "b", "c"], [])).toEqual({ keys: [], hidden: 2 });
    expect(pieceSelection(selected, ["a", "b", "c"], ["a", "b", "c"])).toEqual({ keys: ["a", "b"], hidden: 0 });
  });
  it("shift selection/deselection follows current visible order, not hidden rows", () => {
    const selected = new Set(["hidden"]), visible = ["c", "a", "b", "d"];
    const checked = togglePieceSelection(selected, visible, "b", true, "c");
    expect([...checked]).toEqual(["hidden", "c", "a", "b"]);
    expect([...togglePieceSelection(checked, visible, "c", false, "b")]).toEqual(["hidden"]);
    expect([...togglePieceSelection(selected, visible, "b", true, "gone")]).toEqual(["hidden", "b"]);
    expect([...togglePieceSelection(selected, visible, "gone", true, "a")]).toEqual(["hidden"]);
    expect([...selected]).toEqual(["hidden"]);
  });
  it("requires DELETE at 20 existing unique pieces, or any accepted/fixed/added piece", () => {
    const r = rec(1, 0, Array.from({ length: 20 }, (_, i) => piece("p" + i)));
    const keys = r.pcs.map(p => r.key + "/" + p.id);
    expect(pieceDeleteFacts([r], keys.slice(0, 19))).toMatchObject({ count: 19, requiresDelete: false, suggested: 19 });
    expect(pieceDeleteFacts([r], [...keys, keys[0], "missing/p1"])).toMatchObject({ count: 20, requiresDelete: true });
    for (const st of ["ok", "edit", "add"] as const) {
      const x = rec(2, 0, [piece("p", { st, via: st === "add" ? "hand" : "" })]);
      expect(pieceDeleteFacts([x], [x.key + "/p"])).toMatchObject({ count: 1, accepted: 1, requiresDelete: true });
    }
    expect(pieceDeleteFacts([], keys)).toEqual({ count: 0, accepted: 0, suggested: 0, requiresDelete: false });
  });
});

function apiFixture() {
  const save = vi.fn<PieceBulkApi["save"]>().mockResolvedValue(true);
  const api: PieceBulkApi = { save, me: 7, canEdit: true, sheets: [sheetOf(1, "E1", []), sheetOf(2, "E2", [])] };
  return { api, save };
}
describe("sequential grouped bulk saves (mock API only)", () => {
  it("saves each read once using held identity/version and clear actual-change summaries", async () => {
    const a = rec(1, 0, [piece("p1"), piece("p2")], { version: 4 }), b = rec(2, 1, [piece("p1")], { pg: 2, version: 9 });
    const { api, save } = apiFixture();
    const keys = [a.key + "/p1", b.key + "/p1", a.key + "/p2", a.key + "/p1"];
    const result = await applyPieceBulk(api, [a, b], keys, { type: "accept" });
    expect(result).toEqual({ done: 3, skipped: 0, failed: [] });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toBe(a); expect(save.mock.calls[1][0]).toBe(b);
    expect(save.mock.calls[0][2]).toBe("Bulk: 2 pieces accepted");
    expect(save.mock.calls[1][2]).toBe("Bulk: 1 piece accepted");
    expect(save.mock.calls[0][3]).toEqual({ quiet: true });
    expect(save.mock.calls[0][1]).not.toHaveProperty("key");
    expect(a.pcs.every(p => p.st === "auto")).toBe(true);
  });
  it("awaits a save before starting the next, then continues after a version conflict without retry", async () => {
    const a = rec(1, 0, [piece("p")]), b = rec(2, 0, [piece("p")]), c = rec(3, 0, [piece("p")]);
    const { api, save } = apiFixture();
    let release!: (value: boolean) => void;
    save.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    save.mockRejectedValueOnce(Object.assign(new Error("stale version"), { data: { code: "CONFLICT" } }));
    const pending = applyPieceBulk(api, [a, b, c], [a, b, c].map(r => r.key + "/p"), { type: "reject" });
    expect(save).toHaveBeenCalledTimes(1);
    release(true);
    const result = await pending;
    expect(save).toHaveBeenCalledTimes(3);
    expect(result.done).toBe(2);
    expect(result.failed).toEqual([{ sheet: "E2 Rev 0 p1", why: expect.stringMatching(/Version conflict/) }]);
    expect(save.mock.calls[2][0]).toBe(c);
  });
  it("reports false/error/missing read and missing piece independently, preserving successful saves", async () => {
    const a = rec(1, 0, [piece("p")]), b = rec(2, 0, [piece("p")]), c = rec(3, 0, [piece("p")]);
    const { api, save } = apiFixture();
    save.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("Permission denied"));
    const result = await applyPieceBulk(api, [a, b, c], [a.key + "/p", b.key + "/p", c.key + "/p", c.key + "/gone", "missing/p", "malformed"], { type: "delete" });
    expect(result.done).toBe(1); expect(result.failed).toHaveLength(5); expect(save).toHaveBeenCalledTimes(3);
    expect(result.failed.map(f => f.why).join(" ")).toMatch(/Permission denied/);
    expect(result.failed.map(f => f.why).join(" ")).toMatch(/no longer on this page/);
  });
  it("skips all no-op reads and returns changed-piece rather than selected-piece counts", async () => {
    const r = rec(1, 0, page().pcs), { api, save } = apiFixture();
    const keys = r.pcs.map(p => r.key + "/" + p.id);
    expect(await applyPieceBulk(api, [r], keys, { type: "accept" })).toEqual({ done: 1, skipped: 4, failed: [] });
    expect(save).toHaveBeenCalledTimes(1);
    save.mockClear();
    const accepted = { ...r, pcs: r.pcs.map(p => p.st === "auto" ? { ...p, st: "ok" as const } : p) };
    expect(await applyPieceBulk(api, [accepted], keys, { type: "accept" })).toEqual({ done: 0, skipped: 5, failed: [] });
    expect(save).not.toHaveBeenCalled();
    expect(await applyPieceBulk(api, [r], [], { type: "delete" })).toEqual({ done: 0, skipped: 0, failed: [] });
  });
  it("keeps piece ids that contain a slash intact", async () => {
    const r = rec(1, 0, [piece("p/1"), piece("p")]), { api, save } = apiFixture();
    const result = await applyPieceBulk(api, [r], [r.key + "/p/1"], { type: "delete" });
    expect(result).toEqual({ done: 1, skipped: 0, failed: [] });
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][1] as { pcs: { id: string }[] }).pcs.map(q => q.id)).toEqual(["p"]);
  });
  it("does not call save for a read-only user", async () => {
    const r = rec(1, 0, [piece("p")]), { api, save } = apiFixture();
    const result = await applyPieceBulk({ ...api, canEdit: false }, [r], [r.key + "/p"], { type: "delete" });
    expect(result.done).toBe(0); expect(result.failed[0].why).toMatch(/Only editors/); expect(save).not.toHaveBeenCalled();
  });
});
