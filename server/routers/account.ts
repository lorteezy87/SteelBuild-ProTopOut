import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { localCredentials, users } from "../../drizzle/schema";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { hashPassword, verifyPassword } from "../_core/localAuth";
import { changePasswordError } from "../_core/ownerAuth";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";

export const accountRouter = router({
  changePassword: protectedProcedure
    .input(z.object({ current: z.string().max(200), next: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [cred] = await d.select().from(localCredentials).where(eq(localCredentials.userId, ctx.user.id)).limit(1);
      const err = changePasswordError({ currentOk: !!cred && (await verifyPassword(input.current, cred.passwordHash)), next: input.next });
      if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
      const nextVersion = (ctx.user.sessionVersion ?? 0) + 1;
      await d.transaction(async tx => {
        await tx.update(localCredentials).set({ passwordHash: await hashPassword(input.next) }).where(eq(localCredentials.userId, ctx.user.id));
        // Signs out every other device; this browser gets a fresh cookie below.
        await tx.update(users).set({ sessionVersion: nextVersion }).where(eq(users.id, ctx.user.id));
      });
      const token = await sdk.createSessionToken(ctx.user.openId, { name: ctx.user.name ?? "", sessionVersion: nextVersion, expiresInMs: ONE_YEAR_MS });
      ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
      return { ok: true as const };
    }),
});
