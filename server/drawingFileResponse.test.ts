import { describe, expect, it } from "vitest";
import { validateHeaderValue } from "node:http";
import { Writable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import type { Response } from "express";
import {
  drawingContentDecision,
  drawingContentDisposition,
  drawingEtagMatches,
  drawingFileEtag,
  drawingResponseHeaders,
  streamDrawingBody,
  type DrawingFileKind,
} from "./drawingFileResponse";

const pdf = Buffer.from("%PDF-1.7\ncontents");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 1, 2, 3]), Buffer.from("WEBP")]);

describe("drawing content signatures and response headers", () => {
  it.each([
    ["pdf", pdf, "application/pdf"],
    ["preview", jpeg, "image/jpeg"],
    ["preview", png, "image/png"],
    ["preview", webp, "image/webp"],
  ] as const)("serves recognized %s bytes as exactly %s", (kind, bytes, contentType) => {
    expect(drawingContentDecision(bytes, kind)).toEqual({ contentType, disposition: "inline" });
    const headers = drawingResponseHeaders(bytes, kind, "drawing.pdf");
    expect(headers["Content-Type"]).toBe(contentType);
    expect(headers["Content-Disposition"]).toMatch(/^inline;/);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers).not.toHaveProperty("Content-Security-Policy");
  });

  const unsafe = [
    Buffer.from("<!DOCTYPE html><script>alert(1)</script>"),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    Buffer.from("\ufeff%PDF-1.7"),
    Buffer.from("prefix%PDF-1.7"),
    Buffer.from("%PDF"),
    Buffer.from([0xff, 0xd8]),
    png.subarray(0, 7),
    Buffer.from("RIFF1234WAVE"),
    Buffer.from("RIFFWEBP"),
    Buffer.alloc(0),
  ];
  it.each(unsafe.map(bytes => [bytes]))("downloads unknown or truncated signatures safely (%j)", bytes => {
    for (const kind of ["pdf", "preview"] as const) {
      const headers = drawingResponseHeaders(bytes, kind, "untrusted.html");
      expect(headers["Content-Type"]).toBe("application/octet-stream");
      expect(headers["Content-Disposition"]).toMatch(/^attachment;/);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    }
  });

  it.each([
    ["pdf", jpeg], ["pdf", png], ["pdf", webp], ["preview", pdf],
  ] as const)("does not accept another kind's signature for %s", (kind, bytes) => {
    expect(drawingContentDecision(bytes, kind)).toEqual({ contentType: "application/octet-stream", disposition: "attachment" });
  });
});

describe("Content-Disposition filenames", () => {
  it.each(["计划 étage 📄.pdf", "楼层-É1-R2.jpg"])("preserves Unicode filename %s using RFC 5987", filename => {
    const header = drawingContentDisposition(filename, "inline");
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(header).toContain(`filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"`);
    const encoded = header.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe(filename);
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
  });

  it("sanitizes controls, quotes, backslashes and non-ASCII in the fallback", () => {
    const header = drawingContentDisposition('a"\\\r\n\t\0é.pdf', "attachment");
    expect(header).toContain('attachment; filename="a_______.pdf";');
    expect(header).not.toMatch(/[\r\n\t\0]/);
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
  });

  it("percent-encodes RFC 5987 delimiters and malformed Unicode without throwing", () => {
    expect(drawingContentDisposition("a'()*!.pdf", "inline")).toContain("a%27%28%29%2A%21.pdf");
    const header = drawingContentDisposition("broken\ud800.pdf", "attachment");
    expect(header).toContain("broken%EF%BF%BD.pdf");
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
  });
});

describe("storage-key ETags", () => {
  const tag = drawingFileEtag("drawings/first.pdf", "pdf");
  it("is quoted, deterministic, opaque, and changes with storage key or kind", () => {
    expect(tag).toMatch(/^"[a-f0-9]{40}"$/);
    expect(drawingFileEtag("drawings/first.pdf", "pdf")).toBe(tag);
    expect(drawingFileEtag("drawings/replacement.pdf", "pdf")).not.toBe(tag);
    expect(drawingFileEtag("drawings/first.pdf", "preview")).not.toBe(tag);
    expect(tag).not.toContain("drawings/");
  });
  it.each([tag, `W/${tag}`, `"other", ${tag}`, ` W/${tag} , "other" `, "*"])("matches GET validator %s", value => {
    expect(drawingEtagMatches(value, tag)).toBe(true);
  });
  it.each([undefined, "", '"other"', 'W/"other"', tag.slice(1, -1), `${tag}junk`])("does not match unrelated or malformed validator %s", value => {
    expect(drawingEtagMatches(value, tag)).toBe(false);
  });
});

function responseSink() {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const writable = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      setTimeout(done, 1);
    },
  });
  const res = Object.assign(writable, {
    set(values: Record<string, string>) { Object.assign(headers, values); return this; },
  }) as unknown as Response;
  return { res, headers, chunks };
}

describe("drawing body streaming", () => {
  it.each([["pdf", pdf], ["preview", webp]] as const)("replays split %s signature bytes with backpressure", async (kind: DrawingFileKind, bytes) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const sink = responseSink();
    await streamDrawingBody(body, sink.res, kind, "楼层.pdf", new AbortController().signal);
    expect(Buffer.concat(sink.chunks)).toEqual(bytes);
    expect(sink.headers["Content-Type"]).toBe(kind === "pdf" ? "application/pdf" : "image/webp");
    expect(sink.res.writableFinished).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("handles an empty body as an attachment without retaining the reader", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const sink = responseSink();
    await streamDrawingBody(body, sink.res, "pdf", "empty.pdf", new AbortController().signal);
    expect(sink.headers["Content-Type"]).toBe("application/octet-stream");
    expect(Buffer.concat(sink.chunks)).toHaveLength(0);
    expect(body.locked).toBe(false);
  });

  it("propagates upstream errors and releases the reader", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("Storage disconnected")); } });
    const sink = responseSink();
    await expect(streamDrawingBody(body, sink.res, "pdf", "sheet.pdf", new AbortController().signal)).rejects.toThrow("Storage disconnected");
    expect(body.locked).toBe(false);
  });
});
