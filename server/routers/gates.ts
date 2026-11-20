import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { MANUAL_GATE_KEYS } from "@shared/gate";
import { sequenceGateItems, tasks } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule } from "../security/guard";
import { logActivity } from "../services/events";
import { gatesFor } from "../services/gates";
import { bad, getTaskOr404, zId, zText } from "./_util";

/** Ready-to-erect gate per erection sequence. */
export const gatesRouter = router({
  get: protectedProcedure.input(z.object({ taskId: zId })).query(async ({ ctx, input }) => {
    const t = await getTaskOr404(input.taskId);
    await requireJobModule(ctx, t.projectId, "project.view");
    if (t.kind !== "sequence") bad("Only erection sequences have a ready-to-erect gate");
    return (await gatesFor([t.id])).get(t.id)!;
  }),

  forProject: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId, "project.view");
    const d = await db();
    const seqs = await d.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, input.projectId), eq(tasks.kind, "sequence"), eq(tasks.isSummary, false)));
    const g = await gatesFor(seqs.map(s => s.id));
    return Object.fromEntries(Array.from(g, ([id, v]) => [String(id), v.status]));
  }),

  set: protectedProcedure
    .input(z.object({ taskId: zId, key: z.enum(MANUAL_GATE_KEYS), state: z.enum(["met", "open", "na"]), note: zText(500).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const t = await getTaskOr404(input.taskId);
      await requireJobModule(ctx, t.projectId, "task.edit");
      if (t.kind !== "sequence") bad("Only erection sequences have a ready-to-erect gate");
      const d = await db();
      const note = input.note?.trim() || null;
      await d
        .insert(sequenceGateItems)
        .values({ taskId: t.id, itemKey: input.key, state: input.state, note })
        .onDuplicateKeyUpdate({ set: { state: input.state, note } });
      await logActivity(ctx, { projectId: t.projectId, entityType: "task", entityId: t.id, action: "gate", summary: `gate · ${input.key.replace("_", " ")} → ${input.state}` });
      return (await gatesFor([t.id])).get(t.id)!;
    }),
});
