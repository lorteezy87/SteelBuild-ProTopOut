import { ConfirmButton } from "@/components/ks/Controls";
import {
  EmptyState,
  ErrorState,
  Loading,
  Panel,
  TabStrip,
} from "@/components/ks/Layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errMsg, fmtDate, fmtHours, fmtMoney, weekStart } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { Check, ExternalLink, Receipt, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { EntryState, RejectDrawer } from "./shared";

function useApprovalInvalidation() {
  const utils = trpc.useUtils();
  return () =>
    Promise.all([
      utils.time.approvals.invalidate(),
      utils.time.week.invalidate(),
      utils.time.billable.invalidate(),
      utils.expenses.approvals.invalidate(),
      utils.expenses.approved.invalidate(),
      utils.expenses.mine.invalidate(),
      utils.expenses.byProject.invalidate(),
      utils.daily.pending.invalidate(),
      utils.daily.list.invalidate(),
      utils.daily.get.invalidate(),
      utils.ref.badges.invalidate(),
      utils.financials.summary.invalidate(),
      utils.projects.get.invalidate(),
      utils.projects.list.invalidate(),
      utils.dashboard.portfolio.invalidate(),
    ]);
}
function QueueActions({
  count,
  busy,
  approved,
  onApprove,
  onReject,
  onInvoice,
}: {
  count: number;
  busy: boolean;
  approved: boolean;
  onApprove: () => void;
  onReject: () => void;
  onInvoice: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {approved ? (
        <ConfirmButton
          title="Mark selected records invoiced?"
          body="This changes their billing state. It does not generate or send an invoice."
          confirmLabel="Mark invoiced"
          disabled={!count || busy}
          onConfirm={onInvoice}
        >
          <Receipt className="size-3.5" />
          Mark invoiced ({count})
        </ConfirmButton>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={!count || busy}
            onClick={onReject}
          >
            <X className="size-3.5" />
            Reject ({count})
          </Button>
          <Button size="sm" disabled={!count || busy} onClick={onApprove}>
            <Check className="size-3.5" />
            Approve ({count})
          </Button>
        </>
      )}
    </div>
  );
}
export function TimeApprovalQueue() {
  const [state, setState] = useState("submitted");
  return (
    <div className="space-y-4">
      <TabStrip
        active={state}
        onSelect={setState}
        tabs={[
          { key: "submitted", label: "Awaiting approval" },
          { key: "approved", label: "Approved / ready to invoice" },
        ]}
      />
      <TimeQueue key={state} approved={state === "approved"} />
    </div>
  );
}
function TimeQueue({ approved }: { approved: boolean }) {
  const { ref } = useRefData();
  const invalidate = useApprovalInvalidation();
  const query = trpc.time.approvals.useQuery({
    state: approved ? "approved" : "submitted",
  });
  const [selection, setSelection] = useState<number[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const decide = trpc.time.decide.useMutation();
  const invoice = trpc.time.markInvoiced.useMutation();
  const [busy, setBusy] = useState(false);
  const rows = query.data ?? [];
  const eligible = rows
    .filter(row => (approved ? row.canInvoice : row.canDecide))
    .map(row => row.id);
  const ids = selection.filter(id => eligible.includes(id));
  const groups = new Map<
    string,
    { name: string; week: string; entries: typeof rows }
  >();
  for (const row of rows) {
    const week = weekStart(row.entryDate),
      key = `${row.userId}:${week}`;
    if (!groups.has(key))
      groups.set(key, {
        name: row.userName ?? `User ${row.userId}`,
        week,
        entries: [],
      });
    groups.get(key)!.entries.push(row);
  }
  function toggle(group: number[], checked: boolean) {
    setSelection(current =>
      checked
        ? Array.from(new Set([...current, ...group])).slice(
            0,
            approved ? 5000 : 1000
          )
        : current.filter(id => !group.includes(id))
    );
  }
  async function action(
    kind: "approve" | "reject" | "invoice",
    reason?: string
  ) {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      let awaiting = 0;
      if (kind === "invoice") await invoice.mutateAsync({ ids });
      else {
        const result = await decide.mutateAsync({ ids, action: kind, reason });
        awaiting = result.awaiting;
      }
      toast.success(
        kind === "invoice"
          ? "Time marked invoiced."
          : kind === "approve"
            ? awaiting > 0
              ? "Approved by you. Awaiting other approvers."
              : "Time approved."
            : "Time returned for correction."
      );
      setSelection([]);
      setRejecting(false);
      await invalidate();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            aria-label="Select all permitted time entries"
            disabled={busy || !eligible.length}
            checked={eligible.length > 0 && ids.length === eligible.length}
            onCheckedChange={checked => toggle(eligible, checked === true)}
          />
          Select permitted entries{" "}
          <span className="num text-muted-foreground">
            ({ids.length}/{eligible.length})
          </span>
        </label>
        <QueueActions
          count={ids.length}
          busy={busy}
          approved={approved}
          onApprove={() => action("approve")}
          onReject={() => setRejecting(true)}
          onInvoice={() => action("invoice")}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {approved
          ? "Only entries on jobs where you hold financial access can be marked invoiced."
          : "The job PM and supervisor must both approve when eligible. Grouped by person and Monday-start week. You cannot approve your own time unless you are an admin."}{" "}
        Maximum {approved ? "5,000" : "1,000"} entries per decision.
      </p>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !rows.length ? (
        <Panel>
          <EmptyState
            title={
              approved
                ? "No approved time awaiting invoicing."
                : "No timesheets awaiting approval."
            }
            body="The queue contains only entries within your approval scope."
          />
        </Panel>
      ) : (
        Array.from(groups.entries())
          .sort(
            (a, b) =>
              b[1].week.localeCompare(a[1].week) ||
              a[1].name.localeCompare(b[1].name)
          )
          .map(([key, group]) => {
            const groupIds = group.entries
              .filter(row => eligible.includes(row.id))
              .map(row => row.id);
            return (
              <Panel
                key={key}
                title={
                  <span className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`Select ${group.name}, week of ${group.week}`}
                      disabled={busy || !groupIds.length}
                      checked={
                        groupIds.length > 0 &&
                        groupIds.every(id => ids.includes(id))
                      }
                      onCheckedChange={checked =>
                        toggle(groupIds, checked === true)
                      }
                    />
                    {group.name} · week of {fmtDate(group.week)}
                  </span>
                }
                actions={
                  <span className="num font-semibold">
                    {fmtHours(
                      group.entries.reduce((sum, row) => sum + row.hours, 0)
                    )}
                  </span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="ks-table min-w-[850px]">
                    <thead>
                      <tr>
                        <th />
                        <th>Date</th>
                        <th>Job / task</th>
                        <th>Code / notes</th>
                        <th className="right">Hours</th>
                        <th className="right">Cost</th>
                        <th className="right">Bill</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries
                        .sort(
                          (a, b) =>
                            a.entryDate.localeCompare(b.entryDate) ||
                            a.projectId - b.projectId
                        )
                        .map(row => (
                          <tr
                            key={row.id}
                            className={
                              ids.includes(row.id) ? "is-selected" : ""
                            }
                          >
                            <td>
                              <Checkbox
                                aria-label={`Select time entry ${row.id}`}
                                disabled={busy || !eligible.includes(row.id)}
                                checked={ids.includes(row.id)}
                                onCheckedChange={checked =>
                                  toggle([row.id], checked === true)
                                }
                              />
                            </td>
                            <td className="num">{fmtDate(row.entryDate)}</td>
                            <td>
                              <Link
                                className="font-medium hover:underline"
                                href={`/jobs/${row.projectId}/tasks${row.taskId ? `?task=${row.taskId}` : ""}`}
                              >
                                {row.projectCode ?? row.projectName}
                              </Link>
                              <div className="text-xs text-muted-foreground">
                                {row.taskName ??
                                  (row.wfItemId
                                    ? `Log item #${row.wfItemId}`
                                    : "Job-level time")}
                              </div>
                            </td>
                            <td>
                              {ref?.timeCodes.find(
                                code => code.id === row.timeCodeId
                              )?.name ?? "Uncoded"}
                              <div className="max-w-64 whitespace-pre-wrap text-xs text-muted-foreground">
                                {row.notes}
                              </div>
                            </td>
                            <td className="right num">{fmtHours(row.hours)}</td>
                            <td className="right num">
                              {fmtMoney(row.costAmount, { cents: true })}
                            </td>
                            <td className="right num">
                              {fmtMoney(row.billAmount, { cents: true })}
                            </td>
                            <td>
                              <EntryState state={row.state} />
                              {!approved && (
                                <div className="mt-1 max-w-56 text-[10px] text-muted-foreground">
                                  {row.awaitingApprovers.length
                                    ? `Awaiting: ${row.awaitingApprovers.map(user => user.name).join(", ")}`
                                    : "Awaiting: any eligible time approver"}
                                </div>
                              )}
                              {!(approved ? row.canInvoice : row.canDecide) && (
                                <div className="text-[10px] text-muted-foreground">
                                  {approved
                                    ? "No financial access"
                                    : row.locked
                                      ? `Time locked through ${fmtDate(row.timeLockedThrough)}`
                                      : row.approvedByYou
                                        ? "Approved by you, awaiting others"
                                        : row.userId === ref?.me.id
                                          ? "Own time"
                                          : "Required approvers only"}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })
      )}
      {rejecting && (
        <RejectDrawer
          open
          count={ids.length}
          busy={busy}
          onClose={() => setRejecting(false)}
          onReject={reason => action("reject", reason)}
        />
      )}
    </div>
  );
}
export function ExpenseApprovalQueue() {
  const [state, setState] = useState("submitted");
  return (
    <div className="space-y-4">
      <TabStrip
        active={state}
        onSelect={setState}
        tabs={[
          { key: "submitted", label: "Awaiting approval" },
          { key: "approved", label: "Approved / ready to invoice" },
        ]}
      />
      <ExpenseQueue key={state} approved={state === "approved"} />
    </div>
  );
}
function ExpenseQueue({ approved }: { approved: boolean }) {
  const { ref, isAdmin } = useRefData();
  const submitted = trpc.expenses.approvals.useQuery(undefined, {
    enabled: !approved,
  });
  const invoicable = trpc.expenses.approved.useQuery(undefined, {
    enabled: approved,
  });
  const query = approved ? invoicable : submitted;
  const rows = query.data ?? [];
  const [selection, setSelection] = useState<number[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const invalidate = useApprovalInvalidation();
  const eligible = rows
    .filter(row => approved || isAdmin || row.e.userId !== ref?.me.id)
    .map(row => row.e.id);
  const ids = selection.filter(id => eligible.includes(id));
  const mutation = trpc.expenses.decide.useMutation();
  async function decide(
    action: "approve" | "reject" | "invoice",
    reason?: string
  ) {
    if (!ids.length) return;
    try {
      await mutation.mutateAsync({ ids, action, reason });
      toast.success(
        action === "invoice"
          ? "Expenses marked invoiced."
          : action === "approve"
            ? "Expenses approved."
            : "Expenses returned for correction."
      );
      setSelection([]);
      setRejecting(false);
      await invalidate();
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  return (
    <Panel
      title={approved ? "Approved job expenses" : "Submitted job expenses"}
      actions={
        <QueueActions
          count={ids.length}
          busy={mutation.isPending}
          approved={approved}
          onApprove={() => decide("approve")}
          onReject={() => setRejecting(true)}
          onInvoice={() => decide("invoice")}
        />
      }
    >
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !rows.length ? (
        <EmptyState
          title={
            approved
              ? "No approved expenses awaiting invoicing."
              : "No expenses awaiting approval."
          }
          body="Only jobs in your permitted scope appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ks-table min-w-[1050px]">
            <thead>
              <tr>
                <th>
                  <Checkbox
                    aria-label="Select all permitted expenses"
                    disabled={mutation.isPending || !eligible.length}
                    checked={
                      eligible.length > 0 && ids.length === eligible.length
                    }
                    onCheckedChange={checked =>
                      setSelection(checked ? eligible : [])
                    }
                  />
                </th>
                <th>Person</th>
                <th>Date</th>
                <th>Job</th>
                <th>Code / vendor / description</th>
                <th className="right">Amount</th>
                <th>Bill / cost</th>
                <th>Receipt</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.e.id}
                  className={ids.includes(row.e.id) ? "is-selected" : ""}
                >
                  <td>
                    <Checkbox
                      aria-label={`Select expense ${row.e.id}`}
                      disabled={
                        mutation.isPending || !eligible.includes(row.e.id)
                      }
                      checked={ids.includes(row.e.id)}
                      onCheckedChange={checked =>
                        setSelection(current =>
                          checked
                            ? [...current, row.e.id]
                            : current.filter(id => id !== row.e.id)
                        )
                      }
                    />
                  </td>
                  <td>{row.userName}</td>
                  <td className="num">{fmtDate(row.e.expenseDate)}</td>
                  <td>
                    <Link
                      className="hover:underline"
                      href={`/jobs/${row.e.projectId}/financials`}
                    >
                      {row.projectCode ?? row.projectName}
                    </Link>
                  </td>
                  <td>
                    <div className="font-medium">
                      {row.codeName ?? "Uncoded"} ·{" "}
                      {row.e.vendor ?? "No vendor"}
                    </div>
                    <div className="max-w-80 whitespace-pre-wrap text-xs text-muted-foreground">
                      {row.e.description}
                    </div>
                  </td>
                  <td className="right num">
                    {fmtMoney(row.e.amount, { cents: true })}
                  </td>
                  <td className="text-xs">
                    {row.e.billable ? "Billable" : "Non-billable"}
                    <div>{row.e.costable ? "Costable" : "Non-costable"}</div>
                  </td>
                  <td>
                    {row.e.receiptUrl ? (
                      <a
                        href={row.e.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--ks-blue)]"
                      >
                        View
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <EntryState state={row.e.state} />
                    {!eligible.includes(row.e.id) && (
                      <div className="text-[10px] text-muted-foreground">
                        Own expense
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rejecting && (
        <RejectDrawer
          open
          count={ids.length}
          busy={mutation.isPending}
          onClose={() => setRejecting(false)}
          onReject={reason => decide("reject", reason)}
        />
      )}
    </Panel>
  );
}
export function DailyApprovalQueue() {
  const query = trpc.daily.pending.useQuery();
  const approve = trpc.daily.approve.useMutation();
  const reject = trpc.daily.reject.useMutation();
  const invalidate = useApprovalInvalidation();
  const [rejecting, setRejecting] = useState<
    RouterOutputs["daily"]["pending"][number] | null
  >(null);
  const busy = approve.isPending || reject.isPending;
  async function decide(id: number, reason?: string) {
    try {
      if (reason) await reject.mutateAsync({ id, reason });
      else await approve.mutateAsync({ id });
      toast.success(
        reason
          ? "Daily report returned for correction."
          : "Daily report approved. Crew hours and erection progress posted."
      );
      setRejecting(null);
      await invalidate();
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  return (
    <Panel title="Submitted daily field reports">
      <div className="border-b border-[var(--ks-rule)] p-3 text-xs text-muted-foreground">
        Approval posts ST/OT crew hours, equipment cost and erection progress.
        Review the report before posting.
      </div>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !query.data?.length ? (
        <EmptyState
          title="No daily reports awaiting approval."
          body="Submitted field reports on your jobs will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ks-table min-w-[850px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th>Foreman</th>
                <th>Work performed</th>
                <th>Review</th>
                <th className="right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map(row => (
                <tr key={row.id}>
                  <td className="num">{fmtDate(row.reportDate)}</td>
                  <td>
                    <span className="font-medium num">{row.projectCode}</span>
                    <div className="text-xs text-muted-foreground">
                      {row.projectName}
                    </div>
                  </td>
                  <td>{row.foremanName ?? "—"}</td>
                  <td>
                    <div className="max-w-80 whitespace-pre-wrap">
                      {row.workPerformed || "—"}
                    </div>
                  </td>
                  <td>
                    <Link
                      className="text-[var(--ks-blue)] hover:underline"
                      href={`/jobs/${row.projectId}/daily/${row.id}`}
                    >
                      Open report #{row.id}
                    </Link>
                  </td>
                  <td className="right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRejecting(row)}
                      >
                        Reject
                      </Button>
                      <ConfirmButton
                        title={`Approve daily report ${fmtDate(row.reportDate)}?`}
                        body="Crew time, equipment cost and erection quantities will be posted to the job."
                        confirmLabel="Approve and post"
                        variant="default"
                        disabled={busy}
                        onConfirm={() => decide(row.id)}
                      >
                        Approve
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rejecting && (
        <RejectDrawer
          key={rejecting.id}
          open
          count={1}
          busy={busy}
          maxLength={1000}
          onClose={() => setRejecting(null)}
          onReject={reason => decide(rejecting.id, reason)}
        />
      )}
    </Panel>
  );
}
