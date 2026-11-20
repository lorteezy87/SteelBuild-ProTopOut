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
        if (row.state !== "saved" && row.state !== "rejected")
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

  submit: protectedProcedure
    .input(z.object({ ids: z.array(zId).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const rows = await d
        .select()
        .from(expenses)
        .where(inArray(expenses.id, input.ids));
      for (const r of rows) {
        if (r.userId !== ctx.user.id)
          bad("You can only submit your own expenses");
        if (r.state !== "saved" && r.state !== "rejected")
          bad("Some expenses are already submitted");
      }
      await d
        .update(expenses)
        .set({ state: "submitted" })
        .where(
          inArray(
            expenses.id,
            rows.map(r => r.id)
          )
        );
      const pms = await d
        .select({ managerId: projects.managerId })
        .from(projects)
        .where(
          inArray(projects.id, Array.from(new Set(rows.map(r => r.projectId))))
        );
      await notify(
        ctx,
        pms.map(p => p.managerId),
        {
          title: `Expenses submitted by ${ctx.user.name ?? "user"}`,
          link: "/approvals?tab=expenses",
        }
      );
      for (const r of rows)
        await emit(ctx, "expense", "update", {
          id: r.id,
          projectId: r.projectId,
          state: "submitted",
        });
      return { count: rows.length };
    }),

  approvals: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const s = await sec(ctx);
    if (!hasJobModuleAccess(s)) return [];
    const pids: number[] = [];
    s.projectIds.forEach(pid => {
      if (effectivePrivileges(s, pid).has("expense.approve")) pids.push(pid);
    });
    if (!pids.length) return [];
    return d
      .select({
        e: expenses,
        userName: users.name,
        projectName: projects.name,
        projectCode: projects.code,
        codeName: expenseCodes.name,
      })
      .from(expenses)
      .innerJoin(users, eq(users.id, expenses.userId))
      .innerJoin(projects, eq(projects.id, expenses.projectId))
      .leftJoin(expenseCodes, eq(expenseCodes.id, expenses.expenseCodeId))
      .where(
        and(eq(expenses.state, "submitted"), inArray(expenses.projectId, pids))
      );
  }),

  /** Accounting queue; financial privilege is required on each returned job. */
  approved: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const s = await sec(ctx);
    const pids: number[] = [];
    s.projectIds.forEach(pid => {
      if (effectivePrivileges(s, pid).has("project.financials")) pids.push(pid);
    });
    if (!pids.length) return [];
    return d
      .select({
        e: expenses,
        userName: users.name,
        projectName: projects.name,
        projectCode: projects.code,
        codeName: expenseCodes.name,
      })
      .from(expenses)
      .innerJoin(users, eq(users.id, expenses.userId))
      .innerJoin(projects, eq(projects.id, expenses.projectId))
      .leftJoin(expenseCodes, eq(expenseCodes.id, expenses.expenseCodeId))
      .where(
        and(eq(expenses.state, "approved"), inArray(expenses.projectId, pids))
      );
  }),

  decide: protectedProcedure
    .input(
      z.object({
        ids: z.array(zId).min(1),
        action: z.enum(["approve", "reject", "invoice"]),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action === "reject" && !input.reason?.trim())
        bad("A reason is required to reject an expense");
      const d = await db();
      const s = await sec(ctx);
      const rows = await d
        .select()
        .from(expenses)
        .where(inArray(expenses.id, input.ids));
      for (const r of rows) {
        const privs = effectivePrivileges(s, r.projectId);
        if (input.action === "invoice") {
          if (r.state !== "approved")
            bad("Only approved expenses can be invoiced");
          if (!privs.has("project.financials"))
            bad("Missing privilege: project.financials");
        } else {
          if (r.state !== "submitted")
            bad("Only submitted expenses can be approved or rejected");
          if (!privs.has("expense.approve"))
            bad("Missing privilege: expense.approve");
          if (r.userId === ctx.user.id && ctx.user.role !== "admin")
            bad("You cannot approve your own expenses");
        }
      }
      const now = new Date();
      const set =
        input.action === "approve"
          ? {
              state: "approved",
              approvedBy: ctx.user.id,
              approvedAt: now,
              rejectReason: null,
            }
          : input.action === "reject"
            ? { state: "rejected", rejectReason: input.reason ?? null }
            : { state: "invoiced" };
      await d
        .update(expenses)
        .set(set)
        .where(
          inArray(
            expenses.id,
            rows.map(r => r.id)
          )
        );
      if (input.action !== "invoice") {
        await notify(ctx, Array.from(new Set(rows.map(r => r.userId))), {
          title:
            input.action === "approve"
              ? "Your expense was approved"
              : "Your expense was rejected",
          body: input.reason,
          link: "/expenses",
        });
      }
      for (const pid of Array.from(new Set(rows.map(r => r.projectId))))
        await recomputeProject(pid);
      for (const r of rows)
        await emit(ctx, "expense", "update", {
          id: r.id,
          projectId: r.projectId,
          ...set,
        });
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
      if (row.state !== "saved" && row.state !== "rejected")
        bad("Submitted expenses cannot be deleted");
      await d.delete(expenses).where(eq(expenses.id, input.id));
      await emit(ctx, "expense", "delete", {
        id: row.id,
        projectId: row.projectId,
      });
      return { ok: true };
    }),
});
