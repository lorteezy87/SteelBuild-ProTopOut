import { beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import type { Express, Request, Response } from "express";
import { drawingFileEtag } from "./drawingFileResponse";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), db: vi.fn(), access: vi.fn(), signedUrl: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
vi.mock("./db", () => ({ db: mocks.db }));
vi.mock("./security/guard", () => ({ requireJobModule: mocks.access }));
vi.mock("./storage", () => ({ storageGetSignedUrl: mocks.signedUrl }));
import { registerDrawingFiles, revFileUrl } from "./drawingFiles";

// No HTTP server, SDK calls or DB connection: capture the registered route directly.
let handler: (req: Request, res: Response) => Promise<void>;
let revision: { id: number; sheetId: number; number: number; fileKey: string; previewKey: string | null; fileName: string; mimeType: string };
let requestStorage: ReturnType<typeof vi.fn>;
class Sink extends Writable {
  statusCode = 200;
  headersSent = false;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  onFirstWrite?: () => void;
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    const hook = this.onFirstWrite;
    this.onFirstWrite = undefined;
    hook?.();
    done();
  }
  set(name: string | Record<string, string>, value?: string) {
    if (typeof name === "string") this.headers[name.toLowerCase()] = value!;
    else for (const [key, val] of Object.entries(name)) this.headers[key.toLowerCase()] = val;
    return this;
  }
  removeHeader(name: string) { delete this.headers[name.toLowerCase()]; }
  status(code: number) { this.statusCode = code; return this; }
  send(text: string) { this.end(text); return this; }
  get body() { return Buffer.concat(this.chunks); }
}
function req(kind = "pdf", etag?: string) {
  return { params: { id: "1", kind }, headers: {}, get: (name: string) => name === "If-None-Match" ? etag : undefined } as unknown as Request;
}
function call(request: Request, sink = new Sink()) { return handler(request, sink as unknown as Response); }

beforeEach(() => {
  vi.clearAllMocks();
  requestStorage = vi.fn().mockResolvedValue(new globalThis.Response("%PDF-1.7\nfixture", { headers: { "content-length": "16", "content-type": "text/html" } }));
  vi.stubGlobal("fetch", requestStorage);
  revision = { id: 1, sheetId: 2, number: 3, fileKey: "draft/first.pdf", previewKey: "preview.jpg", fileName: "计划.pdf", mimeType: "text/html" };
  mocks.authenticate.mockResolvedValue({ id: 4, isActive: true, accessType: "full" });
  mocks.access.mockResolvedValue(undefined);
  mocks.signedUrl.mockResolvedValue("https://storage.example/fixture");
  const query = { from() { return this; }, where() { return this; }, limit: vi.fn() };
  query.limit.mockImplementationOnce(async () => [revision]).mockImplementationOnce(async () => [{ projectId: 5, sheetNumber: "楼层-1" }]);
  mocks.db.mockResolvedValue({ select: () => query });
  registerDrawingFiles({ get: (_path: string, callback: typeof handler) => { handler = callback; } } as unknown as Express);
});
import { afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());

describe("authorized drawing file route", () => {
  it("preserves the existing revision URL signature", () => {
    expect(revFileUrl(12, "pdf")).toBe("/api/drawings/rev/12/pdf");
    expect(revFileUrl(12, "preview")).toBe("/api/drawings/rev/12/preview");
  });

  it("checks authentication and access before 304, without even signing or fetching storage", async () => {
    const tag = drawingFileEtag(revision.fileKey, "pdf");
    const sink = new Sink();
    await call(req("pdf", `"other", W/${tag}`), sink);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.access).toHaveBeenCalledOnce();
    expect(sink.statusCode).toBe(304);
    expect(sink.headers).toMatchObject({ "cache-control": "private, no-cache", etag: tag, "x-content-type-options": "nosniff" });
    expect(mocks.signedUrl).not.toHaveBeenCalled();
    expect(requestStorage).not.toHaveBeenCalled();
  });

  it("does not honor matching validators for unauthenticated users", async () => {
    mocks.authenticate.mockRejectedValueOnce(new Error("Invalid session"));
    const sink = new Sink();
    await call(req("pdf", "*"), sink);
    expect(sink.statusCode).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(requestStorage).not.toHaveBeenCalled();
  });

  it.each([{ isActive: false, accessType: "full" }, { isActive: true, accessType: "passive" }])("rejects blocked users before conditional handling (%j)", async user => {
    mocks.authenticate.mockResolvedValueOnce(user);
    const sink = new Sink();
    await call(req("pdf", "*"), sink);
    expect(sink.statusCode).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(requestStorage).not.toHaveBeenCalled();
  });

  it("does not honor a matching validator when job access is denied", async () => {
    mocks.access.mockRejectedValueOnce(new Error("Access denied"));
    const sink = new Sink();
    await call(req("pdf", drawingFileEtag(revision.fileKey, "pdf")), sink);
    expect(sink.statusCode).toBe(403);
    expect(sink.headers).not.toHaveProperty("etag");
    expect(mocks.signedUrl).not.toHaveBeenCalled();
    expect(requestStorage).not.toHaveBeenCalled();
  });

  it("streams PDF bytes with safe headers, Unicode disposition, and upstream Content-Length", async () => {
    const sink = new Sink();
    await call(req(), sink);
    expect(sink.body.toString()).toBe("%PDF-1.7\nfixture");
    expect(sink.headers).toMatchObject({ "content-type": "application/pdf", "content-length": "16", "cache-control": "private, no-cache" });
    expect(sink.headers["content-disposition"]).toContain("filename*=UTF-8''%E8%AE%A1%E5%88%92.pdf");
    expect(sink.headers).not.toHaveProperty("content-security-policy");
    expect(requestStorage.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("fetches a replaced draft rather than returning 304 for the old storage key", async () => {
    const oldTag = drawingFileEtag(revision.fileKey, "pdf");
    revision.fileKey = "draft/replacement.pdf";
    const sink = new Sink();
    await call(req("pdf", oldTag), sink);
    expect(sink.statusCode).toBe(200);
    expect(sink.headers.etag).toBe(drawingFileEtag(revision.fileKey, "pdf"));
    expect(mocks.signedUrl).toHaveBeenCalledWith("draft/replacement.pdf");
  });

  it("forces uploaded HTML to download regardless of the claimed PDF MIME type", async () => {
    revision.mimeType = "application/pdf";
    requestStorage.mockResolvedValueOnce(new globalThis.Response("<html><script>alert(1)</script></html>"));
    const sink = new Sink();
    await call(req(), sink);
    expect(sink.headers).toMatchObject({ "content-type": "application/octet-stream", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
    expect(sink.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("safely serves preview filenames containing Unicode sheet numbers", async () => {
    requestStorage.mockResolvedValueOnce(new globalThis.Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])));
    const sink = new Sink();
    await call(req("preview"), sink);
    expect(sink.headers["content-type"]).toBe("image/jpeg");
    expect(sink.headers["content-disposition"]).toContain("%E6%A5%BC%E5%B1%82-1-R3.jpg");
  });

  it("aborts upstream when the client disconnects before the stream finishes", async () => {
    let signal!: AbortSignal;
    requestStorage.mockImplementationOnce(async (_url, init) => {
      signal = init.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("%PDF-1.7\nstreaming"));
          signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      });
      return new globalThis.Response(body);
    });
    const sink = new Sink();
    sink.onFirstWrite = () => sink.destroy();
    await expect(call(req(), sink)).resolves.toBeUndefined();
    expect(signal.aborted).toBe(true);
    expect(sink.destroyed).toBe(true);
    expect(sink.writableFinished).toBe(false);
  });
});
