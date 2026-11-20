import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { localCredentials } from "../../drizzle/schema";
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
      await d.update(localCredentials).set({ passwordHash: await hashPassword(input.next) }).where(eq(localCredentials.userId, ctx.user.id));
      return { ok: true as const };
    }),
});
