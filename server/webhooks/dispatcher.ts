import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { webhookDeliveries, webhooks } from "../../drizzle/schema";
import { db } from "../db";

/**
 * Outbound webhooks.
 *
 * Signature = hex(HMAC-SHA256(secret, `${timestamp}.${body}`)).
 * Headers: X-SteelBuild-Timestamp, X-SteelBuild-Signature, X-SteelBuild-Delivery-Id, X-SteelBuild-Event.
 * Failed deliveries retry with exponential backoff (1, 4, 16, 64 min) up to 5 attempts.
 */

export const MAX_ATTEMPTS = 5;

export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, body), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function enqueueEvent(event: string, data: unknown) {
  const d = await db();
  const hooks = await d.select().from(webhooks).where(eq(webhooks.isActive, true));
  const targets = hooks.filter(h => (h.events ?? []).includes(event) || (h.events ?? []).includes("*"));
  for (const h of targets) {
    const deliveryId = randomUUID();
    const payload = { event, deliveryId, occurredAt: new Date().toISOString(), data };
    const res = await d.insert(webhookDeliveries).values({
      webhookId: h.id,
      deliveryId,
      event,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    const insertId = Number((res as unknown as [{ insertId: number }])[0].insertId);
    void attemptDelivery(insertId).catch(() => undefined);
  }
}

export async function attemptDelivery(deliveryRowId: number) {
  const d = await db();
  const [row] = await d.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryRowId)).limit(1);
  if (!row || row.status === "success") return;
  const [hook] = await d.select().from(webhooks).where(eq(webhooks.id, row.webhookId)).limit(1);
  if (!hook) return;

  const body = JSON.stringify(row.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(hook.secret, timestamp, body);
  let code: number | null = null;
  let text = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "SteelBuild-Pro-Webhooks/1.0",
        "X-SteelBuild-Timestamp": timestamp,
        "X-SteelBuild-Signature": signature,
        "X-SteelBuild-Delivery-Id": row.deliveryId,
        "X-SteelBuild-Event": row.event,
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    code = resp.status;
    text = (await resp.text().catch(() => "")).slice(0, 1000);
  } catch (e) {
    text = e instanceof Error ? e.message.slice(0, 1000) : "Request failed";
  }
  const attempts = row.attempts + 1;
  const ok = code != null && code >= 200 && code < 300;
  const done = ok || attempts >= MAX_ATTEMPTS;
  await d
    .update(webhookDeliveries)
    .set({
      attempts,
      responseCode: code,
      responseBody: text,
      status: ok ? "success" : done ? "failed" : "pending",
      nextAttemptAt: done ? null : new Date(Date.now() + 4 ** (attempts - 1) * 60_000),
    })
    .where(eq(webhookDeliveries.id, row.id));
}

export async function retryDueDeliveries() {
  const d = await db();
  const due = await d
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date())))
    .limit(50);
  for (const r of due) await attemptDelivery(r.id);
}
