import {
  EmptyState,
  ErrorState,
  Kpi,
  Loading,
  Panel,
  TitleBlock,
} from "@/components/brand/Layout";
import { FinancialTransactions } from "@/features/financials/FinancialTransactions";
import { fmtHours, fmtMoney, fmtNum, fmtPct, fmtTons } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useJob } from "./JobContext";

const ratioTone = (value: number | null) =>
  value == null
    ? ("gray" as const)
    : value < 0.95
      ? ("red" as const)
      : value < 1
        ? ("amber" as const)
        : ("green" as const);
export default function Financials() {
  const { projectId, data: job } = useJob();
  const query = trpc.financials.summary.useQuery(
    { projectId },
    { enabled: job.canFinancials }
  );
  if (!job.canFinancials)
    return (
      <ErrorState
        error={new Error("Financial access is required for this job.")}
      />
    );
  if (query.isLoading) return <Loading label="Loading job financials…" />;
  if (query.error) return <ErrorState error={query.error} />;
  const data = query.data;
  if (!data) return null;
  const eva = data.eva;
  return (
    <div className="space-y-4 p-6">
      <Panel
        title="Contract / change orders"
        actions={
          <span className="label-caps">
            {data.contractType.replaceAll("_", " ")}
          </span>
        }
      >
        <TitleBlock
          cells={[
            {
              label: "Original contract",
              value: (
                <span className="num">{fmtMoney(data.contractValue)}</span>
              ),
            },
            {
              label: "Approved COs",
              value: (
                <span className="num text-[var(--tp-green)]">
                  + {fmtMoney(data.changeOrders.coApproved)}
                </span>
              ),
            },
            {
              label: "Pending COs · excluded",
              value: (
                <span className="num text-[var(--tp-amber)]">
                  {fmtMoney(data.changeOrders.coPending)}
                </span>
              ),
            },
            {
              label: "Revised contract",
              value: (
                <span className="num font-semibold">
                  {fmtMoney(data.revisedContract)}
                </span>
              ),
            },
          ]}
        />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Actual job cost"
          value={fmtMoney(data.costs.total)}
          sub={`Cost budget ${fmtMoney(data.budget)}`}
          tone={data.costs.total > data.budget ? "red" : "gray"}
        />
        <Kpi
          label="Labor cost"
          value={fmtMoney(data.costs.laborCost)}
          sub={`${fmtHours(data.costs.laborHours)} · ST/OT at stored cost rates`}
        />
        <Kpi
          label="Equipment cost"
          value={fmtMoney(data.costs.equipmentCost)}
          sub="Final daily reports · operating + standby"
        />
        <Kpi
          label="Expense cost"
          value={fmtMoney(data.costs.expenseCost)}
          sub="Recorded / invoiced · costable only"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Projected final cost"
          value={fmtMoney(data.projectedCost)}
          sub={`Variance to budget ${fmtMoney(data.budget - data.projectedCost)}`}
          tone={data.projectedCost > data.budget ? "red" : "green"}
        />
        <Kpi
          label="Projected margin"
          value={fmtMoney(data.projectedMargin)}
          sub={`${fmtPct(data.projectedMarginPct, 1)} of revised contract`}
          tone={data.projectedMargin < 0 ? "red" : "green"}
        />
        <Kpi
          label="Cost per erected ton"
          value={fmtMoney(data.costPerTon)}
          sub={`${fmtTons(data.erectedTonsEstimate)} estimated erected · plan × % complete`}
        />
        <Kpi
          label="Labor hours per ton"
          value={
            data.laborHoursPerTon == null
              ? "—"
              : `${fmtNum(data.laborHoursPerTon, 2)} h/t`
          }
          sub="Total crew hours / estimated erected tons"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Earned revenue"
          value={fmtMoney(data.earnedRevenue)}
          sub={
            data.contractType === "lump_sum"
              ? "Revised contract × job % complete"
              : "Billable work + approved change orders"
          }
        />
        <Kpi
          label="Billed to date"
          value={fmtMoney(data.billedToDate)}
          sub="Invoiced time / expenses + billed COs"
        />
        <Kpi
          label="Retainage held"
          value={fmtMoney(data.retainageHeld)}
          sub={`${fmtPct(data.retainagePct, 1)} of billed value`}
        />
        <Kpi
          label="Backcharge exposure"
          value={fmtMoney(data.changeOrders.bcOutstanding)}
          sub={`${fmtMoney(data.changeOrders.bcRecovered)} recovered`}
          tone={data.changeOrders.bcOutstanding > 0 ? "amber" : "gray"}
        />
      </div>
      <Panel title="Earned value analysis" bodyClassName="p-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="PV · planned value"
            value={fmtMoney(eva.pv)}
            sub="Baseline value scheduled to date"
          />
          <Kpi
            label="EV · earned value"
            value={fmtMoney(eva.ev)}
            sub="Budgeted value of completed work"
          />
          <Kpi
            label="AC · actual cost"
            value={fmtMoney(eva.ac)}
            sub="Posted job actuals"
          />
          <Kpi
            label="EAC · estimate at completion"
            value={fmtMoney(eva.eac)}
            sub="Cost budget / CPI"
            tone={eva.eac != null && eva.eac > data.budget ? "red" : "gray"}
          />
          <Kpi
            label="CPI · cost performance"
            value={fmtNum(eva.cpi, 2)}
            sub="EV / AC · below 1 = cost overrun"
            tone={ratioTone(eva.cpi)}
          />
          <Kpi
            label="SPI · schedule performance"
            value={fmtNum(eva.spi, 2)}
            sub="EV / PV · below 1 = behind plan"
            tone={ratioTone(eva.spi)}
          />
          <Kpi
            label="SV · schedule variance"
            value={fmtMoney(eva.sv)}
            sub="EV − PV"
            tone={eva.sv < 0 ? "red" : "green"}
          />
          <Kpi
            label="CV · cost variance"
            value={fmtMoney(eva.cv)}
            sub="EV − AC"
            tone={eva.cv < 0 ? "red" : "green"}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Active-baseline values. CPI / SPI below 0.95 are red; below 1.00 are
          amber. A dash means no valid denominator. Labor actuals include
          recorded and invoiced time; saved entries are excluded.
        </p>
      </Panel>
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Panel title="Labor by time code">
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Time code</th>
                  <th className="right">Hours</th>
                  <th className="right">Cost</th>
                  <th className="right">Bill value</th>
                </tr>
              </thead>
              <tbody>
                {data.byTimeCode.map(row => (
                  <tr key={row.code}>
                    <td>{row.code}</td>
                    <td className="right num">{fmtHours(row.hours)}</td>
                    <td className="right num">{fmtMoney(row.cost)}</td>
                    <td className="right num">{fmtMoney(row.bill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.byTimeCode.length && (
            <EmptyState
              title="No posted labor."
              body="Submit timesheets or approve daily reports to post crew hours."
            />
          )}
        </Panel>
        <Panel title="Expenses by code">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Expense code</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.byExpenseCode.map(row => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td className="right num">{fmtMoney(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.byExpenseCode.length && (
            <EmptyState
              title="No recorded expenses."
              body="Record job expenses to include them here."
            />
          )}
          <p className="border-t border-[var(--tp-rule)] px-3 py-2 text-[11px] text-muted-foreground">
            Gross recorded / invoiced amounts, including non-costable expenses.
          </p>
        </Panel>
        <Panel title="Equipment cost">
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th className="right">Operating</th>
                  <th className="right">Standby</th>
                  <th className="right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.byEquipment.map(row => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td className="right num">{fmtHours(row.operating)}</td>
                    <td className="right num">{fmtHours(row.standby)}</td>
                    <td className="right num">{fmtMoney(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.byEquipment.length && (
            <EmptyState
              title="No equipment use posted."
              body="Finalize daily reports with crane or equipment hours."
            />
          )}
        </Panel>
      </div>
      <Panel title="Monthly labor cost" bodyClassName="p-4">
        {!data.monthlyLabor.length ? (
          <EmptyState
            title="No monthly labor actuals."
            body="Posted crew time will populate this chart."
          />
        ) : (
          <div className="h-64" role="img" aria-label="Labor cost by month">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.monthlyLabor}
                margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid vertical={false} stroke="var(--tp-rule)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
                />
                <YAxis
                  tickFormatter={value =>
                    fmtMoney(Number(value), { compact: true })
                  }
                  tick={{ fontSize: 11 }}
                  width={80}
                />
                <Tooltip
                  cursor={{ fill: "var(--tp-gray-soft)" }}
                  labelStyle={{ color: "var(--tp-ink)" }}
                  itemStyle={{ color: "var(--tp-ink-2)" }}
                  formatter={value => [
                    fmtMoney(Number(value), { cents: true }),
                    "Labor cost",
                  ]}
                  contentStyle={{
                    border: "1px solid var(--tp-rule)",
                    borderRadius: 3,
                    fontSize: 12,
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                  }}
                />
                <Bar
                  dataKey="cost"
                  fill="var(--chart-2)"
                  maxBarSize={64}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
      <FinancialTransactions projectId={projectId} />
    </div>
  );
}
