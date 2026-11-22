import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { EMPTY_SHELL_COUNTS, toCount, type ShellCounts } from "@shared/shell";
import { projects, wfItems, wfStates } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasJobModuleAccess, sec, visibleProjects } from "../security/guard";
import { orgToday } from "../services/calendars";

/**
 * Numbers for the navigation rail's badges. Two aggregate queries and nothing else, so the
 * shell never waits on page data. Scoped to active jobs the signed-in user can see.
 */
export const shellRouter = router({
  counts: protectedProcedure.query(async ({ ctx }): Promise<ShellCounts> => {
    const s = await sec(ctx);
    if (!hasJobModuleAccess(s)) return EMPTY_SHELL_COUNTS;
    const visible = await visibleProjects(ctx);
    if (!visible.length) return EMPTY_SHELL_COUNTS;
    const d = await db();
    const today = await orgToday();
    const activeVisible = and(inArray(projects.id, visible), eq(projects.state, "active"));
    const [[jobs], [logs]] = await Promise.all([
      d
        .select({ delayed: sql<number>`coalesce(sum(case when ${projects.scheduleHealth} = 'delayed' then 1 else 0 end), 0)` })
        .from(projects)
        .where(activeVisible),
      d
        .select({
          pastDue: sql<number>`coalesce(sum(case when ${and(isNotNull(wfItems.dueDate), lt(wfItems.dueDate, today))} then 1 else 0 end), 0)`,
          ourCourt: sql<number>`coalesce(sum(case when ${wfItems.ballInCourt} = 'us' then 1 else 0 end), 0)`,
        })
        .from(wfItems)
        .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
        .innerJoin(projects, eq(projects.id, wfItems.projectId))
        .where(and(activeVisible, ne(wfStates.category, "end"))),
    ]);
    return {
      logsPastDue: toCount(logs?.pastDue),
      logsOurCourt: toCount(logs?.ourCourt),
      jobsDelayed: toCount(jobs?.delayed),
    };
  }),
});
