/**
 * Cloudflare R2 (S3-compatible) storage. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Express } from "express";
import { sdk } from "./_core/sdk";

const env = () => ({
  accountId: process.env.R2_ACCOUNT_ID ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.R2_BUCKET ?? "",
});

export const r2Configured = () => {
  const e = env();
  return Boolean(e.accountId && e.accessKeyId && e.secretAccessKey && e.bucket);
};

/** A client per call: cheap, and always reflects the current environment. */
function s3() {
  const e = env();
  if (!r2Configured()) throw new Error("File storage is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
  return new S3Client({
    region: "auto",
    forcePathStyle: true,
    endpoint: `https://${e.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey },
  });
}

export async function r2Put(key: string, data: Buffer | Uint8Array | string, contentType: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env().bucket,
      Key: key,
      Body: typeof data === "string" ? Buffer.from(data) : data,
      ContentType: contentType,
    }),
  );
}

/** Short-lived (5 min) download URL. Never handed to anyone who has not signed in. */
export async function r2SignedGetUrl(key: string, expiresIn = 300) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env().bucket, Key: key }), { expiresIn });
}

/** Serves /files/<key> to the signed-in owner only, as a 5-minute signed R2 URL. */
export function registerStorageRoute(app: Express) {
  app.get(/^\/files\/(.+)$/, async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || user.role !== "admin" || !user.isActive) return res.status(401).send("Sign in required");
      const key = decodeURIComponent((req.params as Record<string, string>)[0] ?? "");
      if (!key || key.split("/").some(part => part === ".." || part === ".")) return res.status(400).send("Bad key");
      res.set("Cache-Control", "private, no-store");
      res.redirect(302, await r2SignedGetUrl(key));
    } catch (e) {
      console.error("[files] download failed", e instanceof Error ? e.message : e);
      res.status(502).send("File unavailable");
    }
  });
}
