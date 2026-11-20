/**
 * Cloudflare R2 (S3-compatible) storage for self-hosted installs such as Railway.
 * Active only when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are all set;
 * otherwise the Manus storage path in storage.ts is used unchanged.
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

let client: S3Client | null = null;
function s3() {
  if (!client) {
    const e = env();
    client = new S3Client({
      region: "auto",
      endpoint: `https://${e.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey },
    });
  }
  return client;
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

/**
 * On Manus the platform serves /manus-storage/<key>. Self-hosted, the app serves it: signed-in, active
 * users only, redirected to a 5-minute signed R2 URL. Registered only when R2 is configured.
 */
export function registerStorageRoute(app: Express) {
  if (!r2Configured()) return;
  app.get(/^\/manus-storage\/(.+)$/, async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || !user.isActive || user.accessType === "passive") return res.status(401).send("Sign in required");
      const key = decodeURIComponent((req.params as Record<string, string>)[0] ?? "");
      if (!key || key.includes("..")) return res.status(400).send("Bad key");
      res.set("Cache-Control", "private, no-store");
      res.redirect(302, await r2SignedGetUrl(key));
    } catch (e) {
      console.error("[R2] download failed", e instanceof Error ? e.message : e);
      res.status(502).send("File unavailable");
    }
  });
}
