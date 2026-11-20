import { inArray } from "drizzle-orm";
import { activities, users } from "../../drizzle/schema";
import { db } from "../db";

type EvCtx = { user: { id: number; name: string | null }; quiet?: boolean };

export async function logActivity(
  ctx: EvCtx,
  a: { projectId: number | null; entityType: string; entityId: number; action: string; summary: string }
) {
  const d = await db();
  await d.insert(activities).values({ ...a, userId: ctx.user.id, summary: a.summary.slice(0, 500) });
}

/* TopOut has one user: there is nobody to notify, no followers and no webhooks. These stay as no-ops so the
   routers' call sites read the same as before. */
export async function notify(_ctx: EvCtx, _userIds: (number | null | undefined)[], _n: { title: string; body?: string; link?: string }) {}

export async function notifyFollowers(
  _ctx: EvCtx,
  _entityType: string,
  _entityId: number,
  _n: { title: string; body?: string; link?: string },
  _extra: (number | null | undefined)[] = []
) {}

export async function follow(_entityType: string, _entityId: number, _userId: number) {}

export async function emit(_ctx: EvCtx, _entity: string, _action: "add" | "update" | "delete", _data: unknown) {}

export async function userNames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const d = await db();
  const rows = await d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map(r => [r.id, r.name ?? `User ${r.id}`]));
}
