import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { VIEW_PREF_MAX_BYTES, isViewPrefScope, isViewPrefScopeId, viewPrefBytes } from "@shared/viewPrefs";
import { userViewPrefs } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";

const zScope = z.string().refine(isViewPrefScope, "Invalid view scope");
const zScopeId = z.string().refine(isViewPrefScopeId, "Invalid view scope id").default("");
const address = z.object({ scope: zScope, scopeId: zScopeId });

/**
 * Per-user view state (filters, sort, layout). Every row is keyed by the signed-in user,
 * so one person's layout never leaks into or overwrites another's.
 */
export const prefsRouter = router({
  /** The stored value for one screen, or null when the user has never changed it. */
  get: protectedProcedure.input(address).query(async ({ ctx, input }) => {
    const d = await db();
    const [row] = await d
      .select({ value: userViewPrefs.value })
      .from(userViewPrefs)
      .where(and(eq(userViewPrefs.userId, ctx.user.id), eq(userViewPrefs.scope, input.scope), eq(userViewPrefs.scopeId, input.scopeId)))
      .limit(1);
    return { value: (row?.value ?? null) as unknown };
  }),

  set: protectedProcedure.input(address.extend({ value: z.unknown() })).mutation(async ({ ctx, input }) => {
    if (input.value === undefined || input.value === null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to save. Use reset to clear a view." });
    }
    if (viewPrefBytes(input.value) > VIEW_PREF_MAX_BYTES) {
      throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "This view has too many settings to save." });
    }
    const d = await db();
    await d
      .insert(userViewPrefs)
      .values({ userId: ctx.user.id, scope: input.scope, scopeId: input.scopeId, value: input.value })
      .onDuplicateKeyUpdate({ set: { value: input.value } });
    return { ok: true } as const;
  }),

  /** Forget a screen's saved view so it falls back to its defaults. */
  reset: protectedProcedure.input(address).mutation(async ({ ctx, input }) => {
    const d = await db();
    await d
      .delete(userViewPrefs)
      .where(and(eq(userViewPrefs.userId, ctx.user.id), eq(userViewPrefs.scope, input.scope), eq(userViewPrefs.scopeId, input.scopeId)));
    return { ok: true } as const;
  }),
});
