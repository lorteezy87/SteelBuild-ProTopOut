import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { projects, tasks } from "../../drizzle/schema";
import { db } from "../db";

export const zId = z.number().int().positive();
export const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zDayOpt = zDay.nullable().optional();
export const zMoney = z.number().finite();
export const zText = (max = 255) => z.string().trim().max(max);

export function notFound(what = "Record"): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${what} not found` });
}

export function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export async function getProjectOr404(projectId: number) {
  const d = await db();
  const [p] = await d.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) notFound("Job");
  return p;
}

export async function getTaskOr404(taskId: number) {
  const d = await db();
  const [t] = await d.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t) notFound("Task");
  return t;
}

/** Remove undefined keys so partial updates don't null out columns. */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
