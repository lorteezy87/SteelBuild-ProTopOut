import { ConfirmButton, RecordDrawer } from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Panel,
} from "@/components/brand/Layout";
import { Checkbox } from "@/components/ui/checkbox";
import { EntryState } from "@/features/time/shared";
import { errMsg, fmtDate, fmtHours, fmtMoney } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type Expense = RouterOutputs["expenses"]["byProject"][number];
export function FinancialTransactions({ projectId }: { projectId: number }) {
  const expenses = trpc.expenses.byProject.useQuery({ projectId });
  const time = trpc.time.billable.useQuery({ projectId });
  const [selected, setSelected] = useState<Expense | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const utils = trpc.useUtils();
  const ids = selection.filter(id => time.data?.some(row => row.e.id === id));
  const invoice = trpc.time.markInvoiced.useMutation({
    onSuccess: async () => {
      setSelection([]);
      toast.success("Time marked invoiced.");
      await Promise.all([
        utils.time.billable.invalidate({ projectId }),
        utils.time.week.invalidate(),
        utils.financials.summary.invalidate({ projectId }),
      ]);
    },
    onError: error => toast.error(errMsg(error)),
  });
  return (
    <div className="space-y-4">
      <Panel
        title="Job expense register"
        actions={
          <span className="num text-xs">
            {expenses.data?.length ?? 0} records
          </span>
        }
      >
        {expenses.isLoading ? (
          <Loading />
        ) : expenses.error ? (
          <ErrorState error={expenses.error} />
        ) : !expenses.data?.length ? (
          <EmptyState
            title="No job expenses."
            body="Team members can add expenses from My expenses."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table min-w-[850px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Person</th>
                  <th>Code</th>
                  <th>Vendor / description</th>
                  <th className="right">Amount</th>
                  <th>Bill / cost</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {expenses.data.map(row => (
                  <tr key={row.e.id} onClick={() => setSelected(row)}>
                    <td className="num">{fmtDate(row.e.expenseDate)}</td>
                    <td>{row.userName}</td>
                    <td>{row.codeName ?? "Uncoded"}</td>
                    <td>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setSelected(row)}
                      >
                        {row.e.vendor ??
                          row.e.description ??
                          `Expense ${row.e.id}`}
                      </button>
                      <div className="max-w-80 truncate text-xs text-muted-foreground">
                        {row.e.description}
                      </div>
                    </td>
                    <td className="right num">
                      {fmtMoney(row.e.amount, { cents: true })}
                    </td>
                    <td className="text-xs">
                      {row.e.billable ? "Billable" : "Non-billable"} /{" "}
                      {row.e.costable ? "Costable" : "Non-costable"}
                    </td>
                    <td>
                      <EntryState state={row.e.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title="Approved time · ready to bill"
        actions={
          <ConfirmButton
            title="Mark selected time invoiced?"
            body="Includes approved timesheet and daily-report hours. This updates billing state; it does not send an invoice."
            confirmLabel="Mark invoiced"
            disabled={!ids.length || invoice.isPending}
            onConfirm={() => invoice.mutate({ ids })}
          >
            Mark invoiced ({ids.length})
          </ConfirmButton>
        }
      >
        {time.isLoading ? (
          <Loading />
        ) : time.error ? (
          <ErrorState error={time.error} />
        ) : !time.data?.length ? (
          <EmptyState
            title="No approved time awaiting billing."
            body="Approved timesheet and field-report hours appear here until invoiced."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table min-w-[750px]">
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      aria-label="Select all approved job time"
                      disabled={invoice.isPending}
                      checked={
                        time.data.length > 0 && ids.length === time.data.length
                      }
                      onCheckedChange={checked =>
                        setSelection(
                          checked
                            ? time.data!.map(row => row.e.id).slice(0, 5000)
                            : []
                        )
                      }
                    />
                  </th>
                  <th>Date</th>
                  <th>Person</th>
                  <th>Time code</th>
                  <th>Source / notes</th>
                  <th className="right">Hours</th>
                  <th className="right">Cost</th>
                  <th className="right">Bill value</th>
                </tr>
              </thead>
              <tbody>
                {time.data.map(row => (
                  <tr
                    key={row.e.id}
                    className={ids.includes(row.e.id) ? "is-selected" : ""}
                  >
                    <td>
                      <Checkbox
                        aria-label={`Select approved time ${row.e.id}`}
                        disabled={invoice.isPending}
                        checked={ids.includes(row.e.id)}
                        onCheckedChange={checked =>
                          setSelection(current =>
                            checked
                              ? [...current, row.e.id].slice(0, 5000)
                              : current.filter(id => id !== row.e.id)
                          )
                        }
                      />
                    </td>
                    <td className="num">{fmtDate(row.e.entryDate)}</td>
                    <td>{row.userName}</td>
                    <td>{row.codeName ?? "Uncoded"}</td>
                    <td>
                      {row.e.source === "daily_report" ? (
                        <Link
                          className="text-[var(--tp-blue)] hover:underline"
                          href={`/jobs/${projectId}/daily/${row.e.sourceId}`}
                        >
                          Daily report #{row.e.sourceId}
                        </Link>
                      ) : (
                        "Timesheet"
                      )}
                      <div className="max-w-80 truncate text-xs text-muted-foreground">
                        {row.e.notes}
                      </div>
                    </td>
                    <td className="right num">{fmtHours(row.e.hours)}</td>
                    <td className="right num">
                      {fmtMoney(row.e.costAmount, { cents: true })}
                    </td>
                    <td className="right num">
                      {fmtMoney(row.e.billAmount, { cents: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="right font-semibold">
                    Ready-to-bill value
                  </td>
                  <td className="right num font-semibold">
                    {fmtMoney(
                      time.data.reduce((sum, row) => sum + row.e.billAmount, 0),
                      { cents: true }
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
      <RecordDrawer
        open={!!selected}
        onOpenChange={open => !open && setSelected(null)}
        eyebrow="Job expense · read-only"
        title={selected?.e.vendor ?? "Expense details"}
      >
        {selected && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Person">{selected.userName}</Field>
            <Field label="Date">
              <span className="num">{fmtDate(selected.e.expenseDate)}</span>
            </Field>
            <Field label="Code">{selected.codeName ?? "Uncoded"}</Field>
            <Field label="Amount">
              <span className="num">
                {fmtMoney(selected.e.amount, { cents: true })}
              </span>
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <div className="whitespace-pre-wrap">
                {selected.e.description ?? "—"}
              </div>
            </Field>
            <Field label="State">
              <EntryState state={selected.e.state} />
            </Field>
            <Field label="Flags">
              {selected.e.billable ? "Billable" : "Non-billable"} /{" "}
              {selected.e.costable ? "Costable" : "Non-costable"}
            </Field>
            {selected.e.rejectReason && (
              <Field label="Rejection reason" className="sm:col-span-2">
                <span className="text-[var(--tp-red-strong)]">
                  {selected.e.rejectReason}
                </span>
              </Field>
            )}
            {selected.e.receiptUrl && (
              <Field label="Receipt">
                <a
                  href={selected.e.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--tp-blue)]"
                >
                  View receipt
                  <ExternalLink className="size-3" />
                </a>
              </Field>
            )}
          </div>
        )}
      </RecordDrawer>
    </div>
  );
}
