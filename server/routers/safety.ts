import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { JHA_STATUSES, PPE_KEYS, jhaProblems, normalizeAttendees } from "@shared/safety";
import { jhas, preTaskPlans, tasks, toolboxTalks, users } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule } from "../security/guard";
import { bad, defined, getProjectOr404, zDay, zDayOpt, zId, zText } from "./_util";

const step = z.object({ step: zText(300), hazards: zText(1000), controls: zText(1000) });
const steps = z.array(step).max(60);
const ppe = z.array(z.enum(PPE_KEYS as [string, ...string[]])).max(PPE_KEYS.length);
const attendees = z.array(z.object({ userId: zId.nullable(), name: zText(120) })).max(200);
const notes = z.string().max(20000).nullable().optional();

async function assertTask(projectId: number, taskId: number | null | undefined) {
  if (taskId == null) return;
  const d = await db();
  const [t] = await d.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || t.projectId !== projectId) bad("Pick a sequence or task on this job");
}

function refuseIncomplete(j: { title: string; steps: z.infer<typeof steps>; competentPerson: string | null }) {
  const problems = jhaProblems(j);
  if (problems.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Can't activate this JHA: ${problems.join("; ")}` });
}

async function jhaOr404(id: number) {
  const d = await db();
  const [j] = await d.select().from(jhas).where(eq(jhas.id, id)).limit(1);
  if (!j) bad("JHA not found");
  return j;
}

const jhaFields = {
  taskId: zId.nullable().optional(),
  title: zText(200),
  status: z.enum(Object.keys(JHA_STATUSES) as [string, ...string[]]).default("draft"),
  steps: steps.default([]),
  ppe: ppe.default([]),
  competentPerson: zText(120).nullable().optional(),
  reviewedOn: zDayOpt,
};

const ptpFields = {
  planDate: zDay,
  foremanId: zId.nullable().optional(),
  taskId: zId.nullable().optional(),
  jhaId: zId.nullable().optional(),
  workDescription: notes,
  steps: steps.default([]),
  ppe: ppe.default([]),
  attendees: attendees.default([]),
};

const talkFields = {
  talkDate: zDay,
  topic: zText(200).min(1),
  presenter: zText(120).nullable().optional(),
  notes,
  attendees: attendees.default([]),
};

const partial = <T extends Record<string, z.ZodTypeAny>>(f: T) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.optional()])) as { [K in keyof T]: z.ZodOptional<T[K]> };

export const safetyRouter = router({
  jhas: router({
    list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      const rows = await d.select().from(jhas).where(eq(jhas.projectId, input.projectId)).orderBy(asc(jhas.status), asc(jhas.title));
      return rows.map(r => ({ ...r, problems: jhaProblems(r) }));
    }),
    get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
      const j = await jhaOr404(input.id);
      await requireJobModule(ctx, j.projectId);
      const [job, task] = await Promise.all([
        getProjectOr404(j.projectId),
        j.taskId ? db().then(d => d.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, j.taskId!)).limit(1)) : Promise.resolve([]),
      ]);
      return { ...j, problems: jhaProblems(j), job: { id: job.id, code: job.code, name: job.name }, taskName: task[0]?.name ?? null };
    }),
    create: protectedProcedure.input(z.object({ projectId: zId, ...jhaFields })).mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      await assertTask(input.projectId, input.taskId);
      if (input.status === "active") refuseIncomplete({ ...input, competentPerson: input.competentPerson ?? null });
      if (!input.title.trim()) bad("Enter the activity");
      const d = await db();
      const [{ id }] = await d.insert(jhas).values({ ...input, taskId: input.taskId ?? null, competentPerson: input.competentPerson ?? null, reviewedOn: input.reviewedOn ?? null }).$returningId();
      return { id };
    }),
    update: protectedProcedure.input(z.object({ id: zId, ...partial(jhaFields) })).mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const j = await jhaOr404(id);
      await requireJobModule(ctx, j.projectId);
      if (rest.taskId !== undefined) await assertTask(j.projectId, rest.taskId);
      const next = { ...j, ...defined(rest) };
      if (next.status === "active") refuseIncomplete(next);
      if (!next.title.trim()) bad("Enter the activity");
      const d = await db();
      await d.update(jhas).set(defined(rest)).where(eq(jhas.id, id));
      return { ok: true };
    }),
    remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      const j = await jhaOr404(input.id);
      await requireJobModule(ctx, j.projectId);
      const d = await db();
      await d.delete(jhas).where(eq(jhas.id, input.id));
      return { ok: true };
    }),
  }),

  ptps: router({
    list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      return d.select().from(preTaskPlans).where(eq(preTaskPlans.projectId, input.projectId)).orderBy(desc(preTaskPlans.planDate), desc(preTaskPlans.id));
    }),
    get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
      const d = await db();
      const [p] = await d.select().from(preTaskPlans).where(eq(preTaskPlans.id, input.id)).limit(1);
      if (!p) bad("Pre-task plan not found");
      await requireJobModule(ctx, p.projectId);
      const job = await getProjectOr404(p.projectId);
      const [foreman] = p.foremanId ? await d.select({ name: users.name }).from(users).where(eq(users.id, p.foremanId)).limit(1) : [];
      const [task] = p.taskId ? await d.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, p.taskId)).limit(1) : [];
      const [jha] = p.jhaId ? await d.select({ title: jhas.title }).from(jhas).where(eq(jhas.id, p.jhaId)).limit(1) : [];
      return { ...p, job: { id: job.id, code: job.code, name: job.name }, foremanName: foreman?.name ?? null, taskName: task?.name ?? null, jhaTitle: jha?.title ?? null };
    }),
    /** With fromJhaId, the plan starts from that JHA's steps and PPE. */
    create: protectedProcedure.input(z.object({ projectId: zId, ...ptpFields, fromJhaId: zId.optional() })).mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const { fromJhaId, ...v } = input;
      await assertTask(input.projectId, v.taskId);
      let seed = { steps: v.steps, ppe: v.ppe, jhaId: v.jhaId ?? null, taskId: v.taskId ?? null };
      if (fromJhaId) {
        const j = await jhaOr404(fromJhaId);
        if (j.projectId !== input.projectId) bad("That JHA is on another job");
        seed = { steps: j.steps, ppe: j.ppe, jhaId: j.id, taskId: v.taskId ?? j.taskId };
      }
      const d = await db();
      const [{ id }] = await d
        .insert(preTaskPlans)
        .values({ ...v, ...seed, foremanId: v.foremanId ?? null, workDescription: v.workDescription ?? null, attendees: normalizeAttendees(v.attendees) })
        .$returningId();
      return { id };
    }),
    update: protectedProcedure.input(z.object({ id: zId, ...partial(ptpFields) })).mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const d = await db();
      const [p] = await d.select().from(preTaskPlans).where(eq(preTaskPlans.id, id)).limit(1);
      if (!p) bad("Pre-task plan not found");
      await requireJobModule(ctx, p.projectId);
      if (rest.taskId !== undefined) await assertTask(p.projectId, rest.taskId);
      const set = defined({ ...rest, attendees: rest.attendees ? normalizeAttendees(rest.attendees) : undefined });
      if (Object.keys(set).length) await d.update(preTaskPlans).set(set).where(eq(preTaskPlans.id, id));
      return { ok: true };
    }),
    remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      const d = await db();
      const [p] = await d.select().from(preTaskPlans).where(eq(preTaskPlans.id, input.id)).limit(1);
      if (!p) bad("Pre-task plan not found");
      await requireJobModule(ctx, p.projectId);
      await d.delete(preTaskPlans).where(eq(preTaskPlans.id, input.id));
      return { ok: true };
    }),
  }),

  talks: router({
    list: protectedProcedure.input(z.object({ projectId: zId })).query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      return d.select().from(toolboxTalks).where(eq(toolboxTalks.projectId, input.projectId)).orderBy(desc(toolboxTalks.talkDate), desc(toolboxTalks.id));
    }),
    get: protectedProcedure.input(z.object({ id: zId })).query(async ({ ctx, input }) => {
      const d = await db();
      const [t] = await d.select().from(toolboxTalks).where(eq(toolboxTalks.id, input.id)).limit(1);
      if (!t) bad("Toolbox talk not found");
      await requireJobModule(ctx, t.projectId);
      const job = await getProjectOr404(t.projectId);
      return { ...t, job: { id: job.id, code: job.code, name: job.name } };
    }),
    create: protectedProcedure.input(z.object({ projectId: zId, ...talkFields })).mutation(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId);
      const d = await db();
      const [{ id }] = await d
        .insert(toolboxTalks)
        .values({ ...input, presenter: input.presenter ?? null, notes: input.notes ?? null, attendees: normalizeAttendees(input.attendees) })
        .$returningId();
      return { id };
    }),
    update: protectedProcedure.input(z.object({ id: zId, ...partial(talkFields) })).mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const d = await db();
      const [t] = await d.select().from(toolboxTalks).where(eq(toolboxTalks.id, id)).limit(1);
      if (!t) bad("Toolbox talk not found");
      await requireJobModule(ctx, t.projectId);
      const set = defined({ ...rest, attendees: rest.attendees ? normalizeAttendees(rest.attendees) : undefined });
      if (Object.keys(set).length) await d.update(toolboxTalks).set(set).where(and(eq(toolboxTalks.id, id)));
      return { ok: true };
    }),
    remove: protectedProcedure.input(z.object({ id: zId })).mutation(async ({ ctx, input }) => {
      const d = await db();
      const [t] = await d.select().from(toolboxTalks).where(eq(toolboxTalks.id, input.id)).limit(1);
      if (!t) bad("Toolbox talk not found");
      await requireJobModule(ctx, t.projectId);
      await d.delete(toolboxTalks).where(eq(toolboxTalks.id, input.id));
      return { ok: true };
    }),
  }),
});
