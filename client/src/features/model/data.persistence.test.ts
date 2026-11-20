import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { MD, type ReadRec } from "./domain";

const mocks = vi.hoisted(() => ({
  save: vi.fn(), remove: vi.fn(), settings: vi.fn(), refresh: vi.fn(), toastError: vi.fn(),
  job: { data: undefined as any }, reg: { data: undefined as any },
  saveOptions: vi.fn(), removeOptions: vi.fn(), settingsOptions: vi.fn(),
  openPdf: vi.fn(), pageGeometry: vi.fn(), reader: vi.fn(),
}));
// These tests exercise the hook's persistence callbacks, not React rendering.
vi.mock("react", () => ({ useCallback: (f: any) => f, useMemo: (f: any) => f() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/lib/ref", () => ({ useRefData: () => ({ ref: { me: { id: 1 } } }) }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  drawings: { register: { useQuery: () => mocks.reg } },
  model: {
    job: { useQuery: () => mocks.job },
    saveRead: { useMutation: (opts: any) => { mocks.saveOptions(opts); return { mutateAsync: mocks.save }; } },
    removeRead: { useMutation: (opts: any) => { mocks.removeOptions(opts); return { mutateAsync: mocks.remove }; } },
    saveSettings: { useMutation: (opts: any) => { mocks.settingsOptions(opts); return { mutateAsync: mocks.settings }; } },
  },
  useUtils: () => ({ model: { job: { invalidate: mocks.refresh } } }),
} }));
vi.mock("../drawings/pdf", () => ({ openPdfUrl: mocks.openPdf, pageGeometry: mocks.pageGeometry }));
vi.mock("./reader", () => ({ READER_VERSION: 7, read: mocks.reader }));
import { readSheet, useModel } from "./data";

const rec = (id = 51, version = 3, pg = 1): ReadRec => ({
  ...MD.clean({ w: 100, h: 100 }), id, version, key: MD.idOf(20, 1, pg), sid: 20, rev: 1, pg, v: 7, by: 1, at: "",
});
const conflict = () => {
  const error = new TRPCClientError("Someone else changed this read — reload");
  Object.assign(error, { data: { code: "CONFLICT" } });
  return error;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.job.data = { reads: [], canEdit: true, settings: { data: MD.noSettings(), version: 10 } };
  mocks.reg.data = { sheets: [], sequences: [] };
  mocks.save.mockResolvedValue({ id: 51, version: 4 });
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.settings.mockResolvedValue({ version: 11 });
  mocks.refresh.mockResolvedValue(undefined);
});

describe("model persistence identity/version payloads", () => {
  it("sends the held read ID and version without selecting a newer server row", async () => {
    const api = useModel(1);
    await expect(api.save(rec(), MD.clean({}), "accepted a piece")).resolves.toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ sheetId: 20, rev: 1, page: 1, expected: { id: 51, version: 3 } }));
    expect(mocks.refresh).toHaveBeenCalledWith({ projectId: 1 });
  });
  it("keeps viewer callers without an ID compatible for genuinely new pages", async () => {
    await useModel(1).save({ sid: 20, rev: 1, pg: 1, version: 0 }, MD.clean({}), "added by hand");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ expected: { id: null, version: 0 } }));
  });
  it("sends held delete versions and the settings form's version, not the latest query version", async () => {
    const api = useModel(1);
    await api.remove({ id: 51, version: 3 });
    expect(mocks.remove).toHaveBeenCalledWith({ id: 51, version: 3 });
    await api.saveSettings(MD.noSettings(), 4);
    expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({ projectId: 1, expectedVersion: 4 }));
  });
  it("disables mutation retries explicitly", () => {
    useModel(1);
    for (const options of [mocks.saveOptions, mocks.removeOptions, mocks.settingsOptions]) expect(options).toHaveBeenCalledWith({ retry: false });
  });
});

describe("conflicts are surfaced and reloaded, never silently retried", () => {
  it("returns false, refetches and toasts on a review-save conflict", async () => {
    mocks.save.mockRejectedValueOnce(conflict());
    await expect(useModel(1).save(rec(), MD.clean({}), "reviewed")).resolves.toBe(false);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledWith({ projectId: 1 });
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/reloaded/));
  });
  it("also toasts/refetches quiet read conflicts and throws to abort the operation", async () => {
    mocks.save.mockRejectedValueOnce(conflict());
    await expect(useModel(1).save(rec(), MD.clean({}), "read", { fresh: true, quiet: true })).rejects.toBeInstanceOf(TRPCClientError);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/reloaded/));
  });
  it("throws on cleanup conflicts after toast/refetch so later stale deletions do not run", async () => {
    mocks.remove.mockRejectedValueOnce(conflict());
    await expect(useModel(1).remove({ id: 51, version: 3 })).rejects.toBeInstanceOf(TRPCClientError);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/nothing cleared/));
  });
  it("returns false and reloads on a settings conflict", async () => {
    mocks.settings.mockRejectedValueOnce(conflict());
    await expect(useModel(1).saveSettings(MD.noSettings(), 4)).resolves.toBe(false);
    expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/reloaded/));
  });
});

describe("read-sheet page saves and cleanup", () => {
  it("saves the observed page identity and deletes obsolete pages using their held versions", async () => {
    const old = rec(), obsolete = rec(52, 8, 2);
    const api = { save: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(undefined), recs: [old, obsolete] };
    const page = { cleanup: vi.fn() };
    const doc = { numPages: 1, getPage: vi.fn().mockResolvedValue(page), destroy: vi.fn().mockResolvedValue(undefined) };
    mocks.openPdf.mockResolvedValue(doc);
    mocks.pageGeometry.mockResolvedValue({ w: 100, h: 100, text: [{ str: "Framing", x: 0, y: 0 }], segs: [] });
    mocks.reader.mockReturnValue({ members: [], grids: [], columns: [], unplaced: [], otherViews: [] });
    const rev = { n: 1, state: "draft", pdf: "/fixture.pdf", img: null };
    const sheet = { id: 20, sheet: "E-1", title: "Framing", seq: "", revs: [rev] };
    await expect(readSheet(api, sheet, rev)).resolves.toMatchObject({ ok: true });
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ id: 51, version: 3, sid: 20, pg: 1 }), expect.any(Object), expect.any(String), { fresh: true, quiet: true });
    expect(api.remove).toHaveBeenCalledWith({ id: 52, version: 8 });
    expect(page.cleanup).toHaveBeenCalled();
    expect(doc.destroy).toHaveBeenCalled();
  });
});
