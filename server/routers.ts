import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { accountRouter } from "./routers/account";
import { adminRouter } from "./routers/admin";
import { baselinesRouter } from "./routers/baselines";
import { collabRouter } from "./routers/collab";
import { customFieldsRouter } from "./routers/customFields";
import { dailyReportsRouter } from "./routers/dailyReports";
import { gatesRouter } from "./routers/gates";
import { cranesRouter } from "./routers/cranes";
import { tmRouter } from "./routers/tm";
import { gcReportRouter } from "./routers/gcReport";
import { qcRouter } from "./routers/qc";
import { safetyRouter } from "./routers/safety";
import { certsRouter } from "./routers/certs";
import { dashboardRouter } from "./routers/dashboard";
import { deliveriesRouter } from "./routers/deliveries";
import { drawingsRouter } from "./routers/drawings";
import { modelRouter } from "./routers/model";
import { expensesRouter } from "./routers/expenses";
import { financialsRouter } from "./routers/financials";
import { projectsRouter } from "./routers/projects";
import { refRouter } from "./routers/ref";
import { reportsRouter } from "./routers/reports";
import { resourcesRouter } from "./routers/resources";
import { tasksRouter } from "./routers/tasks";
import { todayRouter } from "./routers/today";
import { timeRouter } from "./routers/time";
import { wfRouter } from "./routers/wf";

export const appRouter = router({
  // All API routes live under /api/ so the gateway routes them correctly.
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  account: accountRouter,
  ref: refRouter,
  admin: adminRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  today: todayRouter,
  baselines: baselinesRouter,
  deliveries: deliveriesRouter,
  drawings: drawingsRouter,
  model: modelRouter,
  daily: dailyReportsRouter,
  gates: gatesRouter,
  cranes: cranesRouter,
  tm: tmRouter,
  gcReport: gcReportRouter,
  qc: qcRouter,
  safety: safetyRouter,
  certs: certsRouter,
  resources: resourcesRouter,
  time: timeRouter,
  expenses: expensesRouter,
  financials: financialsRouter,
  wf: wfRouter,
  customFields: customFieldsRouter,
  reports: reportsRouter,
  collab: collabRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
