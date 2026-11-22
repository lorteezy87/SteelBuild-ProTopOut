import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { JOB_TAB_LABEL_MAX, isDefaultJobTabs, normalizeJobTabSave, resolveJobTabs } from "@shared/jobTabs";
import { jobTabs } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule, requirePriv } from "../security/guard";
import { logActivity } from "../services/events";
import { bad, getProjectOr404, zId } from "./_util";

async function storedRows(projectId: number) {
  const d = await db();
  return d
    .select({ key: jobTabs.key, label: jobTabs.label, position: jobTabs.position, hidden: jobTabs.hidden })
    .from(jobTabs)
    .where(eq(jobTabs.projectId, projectId))
    .orderBy(asc(jobTabs.position));
}

/** Per-job tab layout: order, custom names and which tabs are tucked away. See shared/jobTabs.ts. */
export const jobTabsRouter = router({
  list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
    await requireJobModule(ctx, input.projectId);
    const rows = await storedRows(input.projectId);
    return { tabs: resolveJobTabs(rows), customized: rows.length > 0 };
  }),

  /** Replace the job's tab layout with the given order. Tabs left out keep their default place after the listed ones. */
  save: protectedProcedure
    .input(
      z.object({
        projectId: zId,
        tabs: z
          .array(z.object({ key: z.string().max(32), label: z.string().max(JOB_TAB_LABEL_MAX * 2).nullable().optional(), hidden: z.boolean().optional() }))
          .max(64),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requirePriv(ctx, "project.edit", input.projectId);
      await getProjectOr404(input.projectId);
      const result = normalizeJobTabSave(input.tabs);
      if ("error" in result) bad(result.error);
      const rows = result.rows;
      const d = await db();
      await d.transaction(async tx => {
        await tx.delete(jobTabs).where(eq(jobTabs.projectId, input.projectId));
        // A layout identical to the defaults stores nothing, so the job keeps following the registry.
        if (!isDefaultJobTabs(rows)) await tx.insert(jobTabs).values(rows.map(r => ({ ...r, projectId: input.projectId })));
      });
      await logActivity(ctx, { projectId: input.projectId, entityType: "project", entityId: input.projectId, action: "update", summary: "changed the job's tab layout" });
      const stored = await storedRows(input.projectId);
      return { tabs: resolveJobTabs(stored), customized: stored.length > 0 };
    }),

  /** Drop the job's customization and go back to the default tabs. */
  reset: protectedProcedure.input(z.object({ projectId: zId })).mutation(async ({ ctx, input }) => {
    await requirePriv(ctx, "project.edit", input.projectId);
    await getProjectOr404(input.projectId);
    const d = await db();
    await d.delete(jobTabs).where(eq(jobTabs.projectId, input.projectId));
    await logActivity(ctx, { projectId: input.projectId, entityType: "project", entityId: input.projectId, action: "update", summary: "reset the job's tabs to the defaults" });
    return { tabs: resolveJobTabs([]), customized: false };
  }),
});
