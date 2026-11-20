import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { WEBHOOK_ACTIONS, WEBHOOK_ENTITIES } from "@shared/domain";
import { apiTokens, users, webhookDeliveries, webhooks } from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { attemptDelivery } from "../webhooks/dispatcher";
import { bad, zId, zText } from "./_util";

export const MAX_TOKENS_PER_USER = 5;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const EVENT_NAMES = WEBHOOK_ENTITIES.flatMap(e => WEBHOOK_ACTIONS.map(a => `${e}.${a}`));

export const integrationRouter = router({
  allTokens: adminProcedure.query(async () => {
    const d = await db();
    return d
      .select({
        id: apiTokens.id,
        userId: apiTokens.userId,
        ownerName: users.name,
        ownerEmail: users.email,
        name: apiTokens.name,
        last4: apiTokens.last4,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .leftJoin(users, eq(users.id, apiTokens.userId))
      .orderBy(desc(apiTokens.createdAt));
  }),
  tokens: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const rows = await d.select().from(apiTokens).where(eq(apiTokens.userId, ctx.user.id)).orderBy(desc(apiTokens.createdAt));
    return rows.map(({ tokenHash: _h, ...r }) => r);
  }),

  /** Creates a token and returns its value once; only a SHA-256 hash is stored. */
  createToken: protectedProcedure.input(z.object({ name: zText(128).min(1) })).mutation(async ({ ctx, input }) => {
    if (ctx.user.accessType !== "full" && ctx.user.role !== "admin") bad("API tokens require a Full access user");
    const d = await db();
    const [{ n }] = await d.select({ n: sql<number>`count(*)` }).from(apiTokens).where(eq(apiTokens.userId, ctx.user.id));
    if (Number(n) >= MAX_TOKENS_PER_USER) bad(`You can have at most ${MAX_TOKENS_PER_USER} API tokens. Revoke one first.`);
    const token = `ks_${randomBytes(24).toString("base64url")}`;
    await d.insert(apiTokens).values({ userId: ctx.user.id, name: input.name, tokenHash: hashToken(token), last4: token.slice(-4) });
    return { token };
  }),

  revokeToken: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
    const d = await db();
    const cond = ctx.user.role === "admin" ? eq(apiTokens.id, input.id) : and(eq(apiTokens.id, input.id), eq(apiTokens.userId, ctx.user.id));
    await d.delete(apiTokens).where(cond);
    return { ok: true };
  }),

  eventNames: protectedProcedure.query(() => EVENT_NAMES),

  webhooks: adminProcedure.query(async () => {
    const d = await db();
    const rows = await d.select().from(webhooks).orderBy(desc(webhooks.createdAt));
    const stats = await d
      .select({
        webhookId: webhookDeliveries.webhookId,
        failed: sql<number>`sum(case when ${webhookDeliveries.status} = 'failed' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(webhookDeliveries)
      .groupBy(webhookDeliveries.webhookId);
    return rows.map(h => {
      const s = stats.find(x => x.webhookId === h.id);
      return { ...h, secret: `${h.secret.slice(0, 6)}…`, failed: Number(s?.failed ?? 0), total: Number(s?.total ?? 0) };
    });
  }),

  upsertWebhook: adminProcedure
    .input(
      z.object({
        id: zId.optional(),
        name: zText(128).min(1),
        url: z.string().url().max(1000).refine(u => /^https?:\/\//.test(u), "Use an http(s) URL"),
        events: z.array(z.string()).min(1).refine(ev => ev.every(e => e === "*" || EVENT_NAMES.includes(e)), "Unknown event"),
        isActive: z.boolean().default(true),
        regenerateSecret: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const newSecret = () => `whsec_${randomBytes(24).toString("hex")}`;
      if (input.id) {
        const set: Record<string, unknown> = { name: input.name, url: input.url, events: input.events, isActive: input.isActive };
        let secret: string | null = null;
        if (input.regenerateSecret) {
          secret = newSecret();
          set.secret = secret;
        }
        await d.update(webhooks).set(set).where(eq(webhooks.id, input.id));
        return { id: input.id, secret };
      }
      const secret = newSecret();
      const [{ id }] = await d
        .insert(webhooks)
        .values({ name: input.name, url: input.url, events: input.events, isActive: input.isActive, secret, createdBy: ctx.user.id })
        .$returningId();
      return { id, secret };
    }),

  removeWebhook: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
    const d = await db();
    await d.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, input.id));
    await d.delete(webhooks).where(eq(webhooks.id, input.id));
    return { ok: true };
  }),

  deliveries: adminProcedure.input(z.object({ webhookId: zId, limit: z.number().int().min(1).max(200).default(50) })).query(async ({ input }) => {
    const d = await db();
    return d
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, input.webhookId))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(input.limit);
  }),

  /** Send a signed test event to one endpoint immediately. */
  ping: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
    const d = await db();
    const [h] = await d.select().from(webhooks).where(eq(webhooks.id, input.id)).limit(1);
    if (!h) bad("Webhook not found");
    const deliveryId = randomUUID();
    const [{ id }] = await d
      .insert(webhookDeliveries)
      .values({
        webhookId: h.id,
        deliveryId,
        event: "ping",
        payload: { event: "ping", deliveryId, occurredAt: new Date().toISOString(), data: { message: "SteelBuild Pro webhook test" } },
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .$returningId();
    await attemptDelivery(id);
    const [row] = await d.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1);
    return row;
  }),

  redeliver: adminProcedure.input(z.object({ deliveryRowId: zId })).mutation(async ({ input }) => {
    const d = await db();
    await d.update(webhookDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: new Date() }).where(eq(webhookDeliveries.id, input.deliveryRowId));
    await attemptDelivery(input.deliveryRowId);
    const [row] = await d.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, input.deliveryRowId)).limit(1);
    return row;
  }),
});
