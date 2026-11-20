import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  dailyReportEquipment,
  dailyReports,
  equipment,
  expenseCodes,
  expenses,
  timeCodes,
  timeEntries,
  wfApps,
  wfItems,
  wfStates,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { requireJobModule } from "../security/guard";
import { getValues } from "../services/customFields";
import { projectCosts } from "../services/recompute";
import { getProjectOr404, round2, zId } from "./_util";

/** Approved CO $ and backcharge exposure for a job. */
export async function changeOrderTotals(projectId: number) {
  const d = await db();
  const apps = await d
    .select()
    .from(wfApps)
    .where(inArray(wfApps.key, ["co", "backcharge"]));
  const out = {
    coApproved: 0,
    coPending: 0,
    coBilled: 0,
    coCount: 0,
    bcTotal: 0,
    bcRecovered: 0,
    bcOutstanding: 0,
  };
  for (const app of apps) {
    const rows = await d
      .select({
        item: wfItems,
        stateName: wfStates.name,
        category: wfStates.category,
      })
      .from(wfItems)
      .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
      .where(and(eq(wfItems.appId, app.id), eq(wfItems.projectId, projectId)));
    const vals = await getValues(
      `app:${app.key}`,
      rows.map(r => r.item.id)
    );
    for (const r of rows) {
      const v = vals.get(r.item.id) ?? {};
      const n = (k?: string) =>
        k && typeof v[k] === "number" ? (v[k] as number) : 0;
      const approved = app.config?.approvedField
        ? v[app.config.approvedField]
        : null;
      const approvedOrRequested =
        approved == null || approved === ""
          ? n(app.config?.costField)
          : n(app.config?.approvedField);
      if (app.key === "co") {
        out.coCount++;
        if (r.stateName === "Approved" || r.stateName === "Billed") {
          out.coApproved += approvedOrRequested;
          if (r.stateName === "Billed") out.coBilled += approvedOrRequested;
        } else if (r.category !== "end")
          out.coPending += n(app.config?.costField);
      } else {
        if (r.stateName === "Withdrawn") continue;
        const total = n(app.config?.costField);
        const rec =
          r.stateName === "Recovered"
            ? approvedOrRequested
            : n(app.config?.approvedField);
        out.bcTotal += total;
        out.bcRecovered += rec;
        if (r.category !== "end") out.bcOutstanding += Math.max(0, total - rec);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, round2(v)])
  ) as typeof out;
}

export const financialsRouter = router({
  summary: protectedProcedure
    .input(z.object({ projectId: zId }))
    .query(async ({ ctx, input }) => {
      await requireJobModule(ctx, input.projectId, "project.financials");
      const p = await getProjectOr404(input.projectId);
      const costs = await projectCosts(p.id);
      const co = await changeOrderTotals(p.id);
      const d = await db();
      const [inv] = await d
        .select({
          bill: sql<number>`coalesce(sum(${timeEntries.billAmount}),0)`,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.projectId, p.id),
            eq(timeEntries.state, "invoiced")
          )
        );
      const [expInv] = await d
        .select({
          bill: sql<number>`coalesce(sum(case when ${expenses.billable} then ${expenses.amount} else 0 end),0)`,
        })
        .from(expenses)
        .where(
          and(eq(expenses.projectId, p.id), eq(expenses.state, "invoiced"))
        );
      const revisedContract = p.contractValue + co.coApproved;
      const pct = p.percentComplete / 100;
      // Lump-sum earned revenue follows % complete; T&M / unit price follows billable work.
      const tmRevenue = costs.laborBill + costs.expenseBill + co.coApproved;
      const earnedRevenue =
        p.contractType === "lump_sum" ? revisedContract * pct : tmRevenue;
      const projectedCost = p.projectedCost ?? costs.total;
      const projectedMargin = revisedContract - projectedCost;
      const billedToDate =
        Number(inv?.bill ?? 0) + Number(expInv?.bill ?? 0) + co.coBilled;
      const byCode = await d
        .select({
          code: timeCodes.name,
          hours: sql<number>`coalesce(sum(${timeEntries.hours}),0)`,
          cost: sql<number>`coalesce(sum(${timeEntries.costAmount}),0)`,
          bill: sql<number>`coalesce(sum(${timeEntries.billAmount}),0)`,
        })
        .from(timeEntries)
        .leftJoin(timeCodes, eq(timeCodes.id, timeEntries.timeCodeId))
        .where(
          and(
            eq(timeEntries.projectId, p.id),
            inArray(timeEntries.state, ["submitted", "approved", "invoiced"])
          )
        )
        .groupBy(timeCodes.name);
      const byExpense = await d
        .select({
          code: expenseCodes.name,
          amount: sql<number>`coalesce(sum(${expenses.amount}),0)`,
        })
        .from(expenses)
        .leftJoin(expenseCodes, eq(expenseCodes.id, expenses.expenseCodeId))
        .where(
          and(
            eq(expenses.projectId, p.id),
            inArray(expenses.state, ["approved", "invoiced"])
          )
        )
        .groupBy(expenseCodes.name);
      const byEquipment = await d
        .select({
          name: equipment.name,
          operating: sql<number>`coalesce(sum(${dailyReportEquipment.operatingHours}),0)`,
          standby: sql<number>`coalesce(sum(${dailyReportEquipment.standbyHours}),0)`,
          cost: sql<number>`coalesce(sum(${dailyReportEquipment.cost}),0)`,
        })
        .from(dailyReportEquipment)
        .innerJoin(
          dailyReports,
          eq(dailyReports.id, dailyReportEquipment.reportId)
        )
        .innerJoin(
          equipment,
          eq(equipment.id, dailyReportEquipment.equipmentId)
        )
        .where(
          and(
            eq(dailyReports.projectId, p.id),
            eq(dailyReports.status, "approved")
          )
        )
        .groupBy(equipment.name);
      const monthly = await d
        .select({
          month: sql<string>`date_format(${timeEntries.entryDate}, '%Y-%m')`,
          cost: sql<number>`coalesce(sum(${timeEntries.costAmount}),0)`,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.projectId, p.id),
            inArray(timeEntries.state, ["submitted", "approved", "invoiced"])
          )
        )
        .groupBy(sql`1`);
      const tons = p.totalTons > 0 ? p.totalTons : 0;
      return {
        contractType: p.contractType,
        contractValue: p.contractValue,
        changeOrders: co,
        revisedContract: round2(revisedContract),
        budget: p.budget,
        costs,
        projectedCost: round2(projectedCost),
        projectedMargin: round2(projectedMargin),
        projectedMarginPct:
          revisedContract > 0
            ? round2((projectedMargin / revisedContract) * 100)
            : null,
        earnedRevenue: round2(earnedRevenue),
        billedToDate: round2(billedToDate),
        retainagePct: p.retainagePct,
        retainageHeld: round2(billedToDate * (p.retainagePct / 100)),
        erectedTonsEstimate: round2(tons * pct),
        costPerTon: tons * pct > 0 ? round2(costs.total / (tons * pct)) : null,
        laborHoursPerTon:
          tons * pct > 0 ? round2(costs.laborHours / (tons * pct)) : null,
        eva: {
          pv: p.plannedValue,
          ev: p.earnedValue,
          ac: p.actualCost,
          cpi: p.actualCost > 0 ? round2(p.earnedValue / p.actualCost) : null,
          spi:
            p.plannedValue > 0 ? round2(p.earnedValue / p.plannedValue) : null,
          sv: round2(p.earnedValue - p.plannedValue),
          cv: round2(p.earnedValue - p.actualCost),
          eac:
            p.actualCost > 0 && p.earnedValue > 0
              ? round2(p.budget / (p.earnedValue / p.actualCost))
              : null,
        },
        byTimeCode: byCode.map(r => ({
          code: r.code ?? "Uncoded",
          hours: round2(Number(r.hours)),
          cost: round2(Number(r.cost)),
          bill: round2(Number(r.bill)),
        })),
        byExpenseCode: byExpense.map(r => ({
          code: r.code ?? "Uncoded",
          amount: round2(Number(r.amount)),
        })),
        byEquipment: byEquipment.map(r => ({
          name: r.name,
          operating: round2(Number(r.operating)),
          standby: round2(Number(r.standby)),
          cost: round2(Number(r.cost)),
        })),
        monthlyLabor: monthly
          .map(m => ({ month: m.month, cost: round2(Number(m.cost)) }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      };
    }),
});
