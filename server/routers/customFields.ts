import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { FIELD_TYPES } from "@shared/domain";
import { validateFormula } from "@shared/formula";
import { customFieldDefs, customFieldValues } from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { hasPriv } from "../security/guard";
import { orgToday } from "../services/calendars";
import { getDefs, getValues, saveValues } from "../services/customFields";
import { bad, zId, zText } from "./_util";

const entityType = z.string().regex(/^(project|task|user|company|app:[a-z][a-z0-9_]*)$/, "Unknown record type");

const defInput = z.object({
  id: zId.optional(),
  entityType,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "Lowercase letters, digits and _ only"),
  label: zText(128).min(1),
  fieldType: z.enum(Object.keys(FIELD_TYPES) as [string, ...string[]]),
  options: z.array(z.object({ value: zText(64).min(1), label: zText(128).min(1), color: z.string().optional() })).nullable().optional(),
  formula: z.string().max(2000).nullable().optional(),
  required: z.boolean().default(false),
  isFinancial: z.boolean().default(false),
  rollup: z.enum(["none", "sum", "avg", "min", "max"]).default("none"),
  colorRules: z
    .array(z.object({ op: z.enum(["lt", "lte", "gt", "gte", "eq"]), value: z.union([z.number(), z.string()]), color: z.string() }))
    .nullable()
    .optional(),
  projectType: zText(64).nullable().optional(),
  helpText: zText(500).nullable().optional(),
  showInList: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const customFieldsRouter = router({
  defs: protectedProcedure.input(z.object({ entityType, includeInactive: z.boolean().default(false) })).query(async ({ ctx, input }) => {
    const d = await db();
    const rows = await d
      .select()
      .from(customFieldDefs)
      .where(input.includeInactive ? eq(customFieldDefs.entityType, input.entityType) : and(eq(customFieldDefs.entityType, input.entityType), eq(customFieldDefs.isActive, true)))
      .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.id));
    if (ctx.user.role === "admin") return rows;
    return rows.filter(r => !r.isFinancial);
  }),

  allDefs: adminProcedure.query(async () => {
    const d = await db();
    return d.select().from(customFieldDefs).orderBy(asc(customFieldDefs.entityType), asc(customFieldDefs.sortOrder));
  }),

  upsert: adminProcedure.input(defInput).mutation(async ({ input }) => {
    if (input.fieldType === "formula") {
      if (!input.formula?.trim()) bad("Enter a formula");
      const err = validateFormula(input.formula!);
      if (err) bad(`Formula: ${err}`);
    }
    if ((input.fieldType === "select" || input.fieldType === "multiselect") && !input.options?.length) bad("Add at least one option");
    if (input.rollup !== "none" && input.entityType !== "task") bad("Rollups apply to task fields only");
    if (input.rollup !== "none" && !["number", "decimal", "currency", "formula"].includes(input.fieldType)) bad("Rollups need a numeric field");
    const d = await db();
    const { id, ...rest } = input;
    const values = {
      ...rest,
      options: rest.options ?? null,
      formula: rest.fieldType === "formula" ? rest.formula ?? null : null,
      colorRules: rest.colorRules ?? null,
      projectType: rest.projectType || null,
      helpText: rest.helpText ?? null,
    };
    if (id) {
      const [cur] = await d.select().from(customFieldDefs).where(eq(customFieldDefs.id, id)).limit(1);
      if (!cur) bad("Field not found");
      if (cur.key !== rest.key || cur.entityType !== rest.entityType) bad("Key and record type cannot change after creation");
      if (cur.fieldType !== rest.fieldType) {
        const used = await d.select({ id: customFieldValues.id }).from(customFieldValues).where(eq(customFieldValues.defId, id)).limit(1);
        if (used.length) bad("Field type cannot change once values exist");
      }
      await d.update(customFieldDefs).set(values).where(eq(customFieldDefs.id, id));
      return { id };
    }
    const dup = await d
      .select({ id: customFieldDefs.id })
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.entityType, rest.entityType), eq(customFieldDefs.key, rest.key)))
      .limit(1);
    if (dup.length) bad("A field with this key already exists on this record type");
    const [{ id: newId }] = await d.insert(customFieldDefs).values(values).$returningId();
    return { id: newId };
  }),

  remove: adminProcedure.input(z.object({ id: zId })).mutation(async ({ input }) => {
    const d = await db();
    await d.delete(customFieldValues).where(eq(customFieldValues.defId, input.id));
    await d.delete(customFieldDefs).where(eq(customFieldDefs.id, input.id));
    return { ok: true };
  }),

  /** Validate a formula and preview its result against sample values. */
  testFormula: adminProcedure
    .input(z.object({ formula: z.string().max(2000), sample: z.record(z.string(), z.unknown()).default({}) }))
    .mutation(async ({ input }) => {
      const err = validateFormula(input.formula);
      if (err) return { ok: false as const, error: err };
      const { evaluateFormula } = await import("@shared/formula");
      try {
        return { ok: true as const, value: evaluateFormula(input.formula, { me: input.sample, today: await orgToday() }) };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    }),

  /** Values for user / company records (jobs, tasks and logs save through their own routers). */
  values: protectedProcedure
    .input(z.object({ entityType: z.enum(["user", "company"]), entityId: zId }))
    .query(async ({ ctx, input }) => {
      const defs = await getDefs(input.entityType);
      const vals = (await getValues(input.entityType, [input.entityId])).get(input.entityId) ?? {};
      const fin = ctx.user.role === "admin";
      return {
        defs: fin ? defs : defs.filter(x => !x.isFinancial),
        values: Object.fromEntries(Object.entries(vals).filter(([k]) => fin || !defs.find(x => x.key === k)?.isFinancial)),
      };
    }),

  saveValues: protectedProcedure
    .input(z.object({ entityType: z.enum(["user", "company"]), entityId: zId, values: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const allowed =
        ctx.user.role === "admin" || (input.entityType === "company" && (await hasPriv(ctx, "project.create")));
      if (!allowed) bad("You cannot edit these fields");
      await saveValues({
        entityType: input.entityType,
        entityId: input.entityId,
        values: input.values,
        base: {},
        canFinancial: ctx.user.role === "admin",
        today: await orgToday(),
      });
      return { ok: true };
    }),
});
