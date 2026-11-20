// File storage: Cloudflare R2 (S3-compatible). Uploads return /files/<key>, which registerStorageRoute serves to the
// signed-in owner as a short-lived signed R2 URL.
import { r2Put, r2SignedGetUrl } from "./storageR2";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export const fileUrl = (key: string) => `/files/${key}`;

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  await r2Put(key, data, contentType);
  return { key, url: fileUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: fileUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return r2SignedGetUrl(normalizeKey(relKey));
}
