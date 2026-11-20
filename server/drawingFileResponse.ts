import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";

export type DrawingFileKind = "pdf" | "preview";
type Disposition = "inline" | "attachment";

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

/** Never trust the uploader's MIME type; only recognized signatures render inline. */
export function drawingContentDecision(bytes: Uint8Array, kind: DrawingFileKind): { contentType: string; disposition: Disposition } {
  if (kind === "pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { contentType: "application/pdf", disposition: "inline" };
  }
  if (kind === "preview") {
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", disposition: "inline" };
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png", disposition: "inline" };
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
      return { contentType: "image/webp", disposition: "inline" };
    }
  }
  return { contentType: "application/octet-stream", disposition: "attachment" };
}

/** ASCII-only header with a Unicode RFC 5987 filename, including malformed-surrogate safety. */
export function drawingContentDisposition(filename: string, disposition: Disposition): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8Name = Buffer.from(filename, "utf8").toString("utf8");
  const encoded = encodeURIComponent(utf8Name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function drawingResponseHeaders(bytes: Uint8Array, kind: DrawingFileKind, filename: string): Record<string, string> {
  const decision = drawingContentDecision(bytes, kind);
  return {
    "Content-Type": decision.contentType,
    "Content-Disposition": drawingContentDisposition(filename, decision.disposition),
    "X-Content-Type-Options": "nosniff",
    // A sandbox on PDFs disables Chrome's built-in PDF viewer. Only sandbox attachments.
    ...(decision.disposition === "attachment" ? { "Content-Security-Policy": "default-src 'none'; sandbox" } : {}),
  };
}

export const drawingFileEtag = (key: string, kind: DrawingFileKind): string =>
  `"${createHash("sha1").update(`${kind}\0${key}`).digest("hex")}"`;

/** GET uses weak comparison; recognize the wildcard and comma-separated validators. */
export function drawingEtagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  return !!ifNoneMatch && ifNoneMatch.split(",").some(value => {
    const candidate = value.trim();
    return candidate === "*" || candidate === etag || candidate === `W/${etag}`;
  });
}

/** Sniff at most 12 prefix bytes, then replay every chunk through pipeline with backpressure. */
export async function streamDrawingBody(
  body: ReadableStream<Uint8Array>,
  res: Response,
  kind: DrawingFileKind,
  filename: string,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  try {
    const prefix = new Uint8Array(12);
    const firstChunks: Uint8Array[] = [];
    let length = 0;
    // Signatures can be split across arbitrarily small upstream chunks.
    while (length < prefix.length) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.length) continue;
      firstChunks.push(value);
      const count = Math.min(value.length, prefix.length - length);
      prefix.set(value.subarray(0, count), length);
      length += count;
    }
    signal.throwIfAborted();
    res.set(drawingResponseHeaders(prefix.subarray(0, length), kind, filename));
    async function* chunks() {
      yield* firstChunks;
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    }
    await pipeline(Readable.from(chunks(), { objectMode: false }), res, { signal });
  } finally {
    reader.releaseLock();
  }
}
