import { and, eq, inArray } from "drizzle-orm";
import { activities, followers, notifications, users } from "../../drizzle/schema";
import { db } from "../db";
import { enqueueEvent } from "../webhooks/dispatcher";

type EvCtx = { user: { id: number; name: string | null }; quiet?: boolean };

export async function logActivity(
  ctx: EvCtx,
  a: { projectId: number | null; entityType: string; entityId: number; action: string; summary: string }
) {
  const d = await db();
  await d.insert(activities).values({ ...a, userId: ctx.user.id, summary: a.summary.slice(0, 500) });
}

export async function notify(
  ctx: EvCtx,
  userIds: (number | null | undefined)[],
  n: { title: string; body?: string; link?: string }
) {
  if (ctx.quiet) return;
  const ids = Array.from(new Set(userIds.filter((x): x is number => typeof x === "number" && x !== ctx.user.id)));
  if (!ids.length) return;
  const d = await db();
  await d.insert(notifications).values(
    ids.map(userId => ({ userId, title: n.title.slice(0, 255), body: n.body ?? null, link: n.link ?? null }))
  );
}

export async function notifyFollowers(
  ctx: EvCtx,
  entityType: string,
  entityId: number,
  n: { title: string; body?: string; link?: string },
  extra: (number | null | undefined)[] = []
) {
  const d = await db();
  const f = await d
    .select({ userId: followers.userId })
    .from(followers)
    .where(and(eq(followers.entityType, entityType), eq(followers.entityId, entityId)));
  await notify(ctx, [...f.map(x => x.userId), ...extra], n);
}

export async function follow(entityType: string, entityId: number, userId: number) {
  const d = await db();
  await d
    .insert(followers)
    .values({ entityType, entityId, userId })
    .onDuplicateKeyUpdate({ set: { userId } });
}

/** Extract @mentions ("@First Last" or "@email") and resolve to user ids. */
export async function resolveMentions(body: string): Promise<number[]> {
  const tokens = Array.from(body.matchAll(/@([\w.+-]+@[\w.-]+|[A-Za-z][\w'-]*(?:\s[A-Z][\w'-]*)?)/g)).map(m =>
    m[1].toLowerCase()
  );
  if (!tokens.length) return [];
  const d = await db();
  const all = await d.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const ids = new Set<number>();
  for (const t of tokens) {
    for (const u of all) {
      if ((u.email && u.email.toLowerCase() === t) || (u.name && u.name.toLowerCase() === t)) ids.add(u.id);
      else if (u.name && u.name.toLowerCase().split(" ")[0] === t && !t.includes(" ")) ids.add(u.id);
    }
  }
  return Array.from(ids);
}

export async function emit(ctx: EvCtx, entity: string, action: "add" | "update" | "delete", data: unknown) {
  if (ctx.quiet) return;
  try {
    await enqueueEvent(`${entity}.${action}`, data);
  } catch (e) {
    console.warn("[webhooks] enqueue failed", e instanceof Error ? e.message : e);
  }
}

export async function userNames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const d = await db();
  const rows = await d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map(r => [r.id, r.name ?? `User ${r.id}`]));
}
