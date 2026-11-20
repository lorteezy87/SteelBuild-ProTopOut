import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { expenseCodes, expenses, projects, users } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { effectivePrivileges } from "../security/access";
import { hasJobModuleAccess, requirePriv, sec } from "../security/guard";
import { emit, notify } from "../services/events";
import { recomputeProject } from "../services/recompute";
import { storagePut } from "../storage";
import { bad, zDay, zId, zText } from "./_util";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export const expensesRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    return d
      .select({
        e: expenses,
        projectName: projects.name,
        projectCode: projects.code,
        codeName: expenseCodes.name,
      })
      .from(expenses)
      .innerJoin(projects, eq(projects.id, expenses.projectId))
      .leftJoin(expenseCodes, eq(expenseCodes.id, expenses.expenseCodeId))
      .where(eq(expenses.userId, ctx.user.id))
      .orderBy(desc(expenses.expenseDate))
      .limit(500);
  }),

  byProject: protectedProcedure
    .input(z.object({ projectId: zId }))
    .query(async ({ ctx, input }) => {
      await requirePriv(ctx, "project.financials", input.projectId);
      const d = await db();
      return d
        .select({
          e: expenses,
          userName: users.name,
          codeName: expenseCodes.name,
        })
        .from(expenses)
        .innerJoin(users, eq(users.id, expenses.userId))
        .leftJoin(expenseCodes, eq(expenseCodes.id, expenses.expenseCodeId))
        .where(eq(expenses.projectId, input.projectId))
        .orderBy(desc(expenses.expenseDate));
    }),

  save: protectedProcedure
    .input(
      z.object({
        id: zId.optional(),
        projectId: zId,
        expenseCodeId: zId.nullable().optional(),
        expenseDate: zDay,
        description: zText(500).nullable().optional(),
        vendor: zText(200).nullable().optional(),
        amount: z.number().positive().max(10_000_000),
        billable: z.boolean().optional(),
        costable: z.boolean().optional(),
        receipt: z
          .object({
            fileName: zText(255).min(1),
            mimeType: zText(128),
            base64: z.string(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requirePriv(ctx, "project.view", input.projectId);
      const d = await db();
      const code = input.expenseCodeId
        ? (
            await d
              .select()
              .from(expenseCodes)
              .where(eq(expenseCodes.id, input.expenseCodeId))
              .limit(1)
          )[0]
        : undefined;
      let receiptUrl: string | undefined;
      if (input.receipt) {
        const buf = Buffer.from(input.receipt.base64, "base64");
        if (buf.length > MAX_RECEIPT_BYTES)
          bad("Receipt must be 10 MB or smaller");
        const safe = input.receipt.fileName.replace(/[^\w.-]+/g, "_");
        const put = await storagePut(
          `receipts/${input.projectId}/${Date.now()}_${safe}`,
          buf,
          input.receipt.mimeType
        );
        receiptUrl = put.url;
      }
      const values = {
        projectId: input.projectId,
        expenseCodeId: input.expenseCodeId ?? null,
        expenseDate: input.expenseDate,
        description: input.description ?? null,
        vendor: input.vendor ?? null,
        amount: input.amount,
        billable: input.billable ?? code?.billable ?? true,
        costable: input.costable ?? code?.costable ?? true,
        ...(receiptUrl ? { receiptUrl } : {}),
      };
      if (input.id) {
        const [row] = await d
          .select()
          .from(expenses)
          .where(eq(expenses.id, input.id))
          .limit(1);
        if (!row || row.userId !== ctx.user.id) bad("Expense not found");
        if (row.state !== "saved")
          bad("Submitted expenses cannot be edited");
        await d
          .update(expenses)
          .set({ ...values, state: "saved", rejectReason: null })
          .where(eq(expenses.id, input.id));
        await emit(ctx, "expense", "update", {
          id: input.id,
          ...values,
          state: "saved",
        });
        return { id: input.id };
      }
      const [{ id }] = await d
        .insert(expenses)
        .values({ ...values, userId: ctx.user.id })
        .$returningId();
      await emit(ctx, "expense", "add", {
        id,
        projectId: input.projectId,
        amount: input.amount,
      });
      return { id };
    }),

  /** Locks saved expenses; recorded expenses count as job cost. */
  record: protectedProcedure
    .input(z.object({ ids: z.array(zId).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const rows = await d.select().from(expenses).where(inArray(expenses.id, input.ids));
      for (const r of rows) if (r.state !== "saved") bad("Some expenses are already recorded");
      await d.update(expenses).set({ state: "recorded", approvedBy: ctx.user.id, approvedAt: new Date() }).where(inArray(expenses.id, rows.map(r => r.id)));
      for (const r of rows) await recomputeProject(r.projectId);
      for (const r of rows) await emit(ctx, "expense", "update", { id: r.id, projectId: r.projectId, state: "recorded" });
      return { count: rows.length };
    }),

  remove: protectedProcedure
    .input(z.object({ id: zId }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(expenses)
        .where(eq(expenses.id, input.id))
        .limit(1);
      if (!row) return { ok: true };
      if (row.userId !== ctx.user.id)
        bad("You can only delete your own expenses");
      if (row.state !== "saved")
        bad("Recorded expenses cannot be deleted");
      await d.delete(expenses).where(eq(expenses.id, input.id));
      await emit(ctx, "expense", "delete", {
        id: row.id,
        projectId: row.projectId,
      });
      return { ok: true };
    }),
});
