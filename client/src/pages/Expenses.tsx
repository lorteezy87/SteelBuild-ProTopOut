import {
  ConfirmButton,
  DateInput,
  NumberInput,
  RecordDrawer,
  SimpleSelect,
} from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Field,
  Kpi,
  Loading,
  PageHeader,
  Panel,
} from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EntryState, editableState } from "@/features/time/shared";
import {
  errMsg,
  fileToBase64,
  fmtDate,
  fmtMoney,
  weekStart,
} from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ExternalLink, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ExpenseRow = RouterOutputs["expenses"]["mine"][number];
export default function Expenses() {
  const utils = trpc.useUtils();
  const query = trpc.expenses.mine.useQuery();
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const [filter, setFilter] = useState<string | null>("all");
  const invalidate = async () => {
    setSelected([]);
    await Promise.all([
      utils.expenses.mine.invalidate(),
      utils.expenses.byProject.invalidate(),
      utils.expenses.approvals.invalidate(),
      utils.ref.badges.invalidate(),
      utils.financials.summary.invalidate(),
    ]);
  };
  const submit = trpc.expenses.submit.useMutation({
    onSuccess: async () => {
      toast.success("Expenses submitted.");
      await invalidate();
    },
    onError: error => toast.error(errMsg(error)),
  });
  const remove = trpc.expenses.remove.useMutation({
    onSuccess: async () => {
      toast.success("Expense deleted.");
      await invalidate();
    },
    onError: error => toast.error(errMsg(error)),
  });
  const rows = (query.data ?? []).filter(
    row => filter === "all" || row.e.state === filter
  );
  const selectable = rows.filter(row => editableState(row.e.state));
  const selectedIds = selected.filter(id =>
    selectable.some(row => row.e.id === id)
  );
  const editable = (query.data ?? []).filter(row => editableState(row.e.state));
  const pending = (query.data ?? []).filter(row => row.e.state === "submitted");
  return (
    <>
      <PageHeader
        eyebrow="Out-of-pocket job costs"
        title="My expenses"
        subtitle="Save receipts, then submit selected expenses for approval."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Add expense
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi
            label="Ready to submit"
            value={fmtMoney(editable.reduce((n, row) => n + row.e.amount, 0))}
            sub={`${editable.length} saved / rejected expenses`}
          />
          <Kpi
            label="Awaiting approval"
            value={fmtMoney(pending.reduce((n, row) => n + row.e.amount, 0))}
            tone="amber"
            sub={`${pending.length} submitted expenses`}
          />
          <Kpi
            label="Total expenses"
            value={fmtMoney(
              (query.data ?? []).reduce((n, row) => n + row.e.amount, 0)
            )}
            sub="Latest 500 records"
          />
        </div>
        <Panel
          title="Expense register"
          actions={
            <>
              <div className="w-36">
                <SimpleSelect
                  value={filter}
                  onChange={setFilter}
                  options={{
                    all: "All states",
                    saved: "Saved",
                    submitted: "Submitted",
                    approved: "Approved",
                    rejected: "Rejected",
                    invoiced: "Invoiced",
                  }}
                />
              </div>
              <Button
                size="sm"
                disabled={!selectedIds.length || submit.isPending}
                onClick={() => submit.mutate({ ids: selectedIds })}
              >
                <Send className="size-3.5" />
                Submit {selectedIds.length || "selected"}
              </Button>
            </>
          }
        >
          {query.isLoading ? (
            <Loading />
          ) : query.error ? (
            <ErrorState error={query.error} />
          ) : !rows.length ? (
            <EmptyState
              title="No expenses in this view."
              body="Add a job expense and attach its receipt."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tp-table min-w-[1050px]">
                <thead>
                  <tr>
                    <th>
                      <Checkbox
                        aria-label="Select all editable expenses"
                        checked={
                          selectable.length > 0 &&
                          selectedIds.length === selectable.length
                        }
                        onCheckedChange={checked =>
                          setSelected(
                            checked ? selectable.map(row => row.e.id) : []
                          )
                        }
                      />
                    </th>
                    <th>Code</th>
                    <th>Date</th>
                    <th>Job</th>
                    <th>Vendor / description</th>
                    <th className="right">Amount</th>
                    <th>Bill / cost</th>
                    <th>Receipt</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.e.id}
                      className={
                        selectedIds.includes(row.e.id) ? "is-selected" : ""
                      }
                      onClick={() => setEditing(row)}
                    >
                      <td onClick={event => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select expense ${row.e.id}`}
                          disabled={!editableState(row.e.state)}
                          checked={selectedIds.includes(row.e.id)}
                          onCheckedChange={checked =>
                            setSelected(
                              checked
                                ? [...selected, row.e.id]
                                : selected.filter(id => id !== row.e.id)
                            )
                          }
                        />
                      </td>
                      <td>{row.codeName ?? "Uncoded"}</td>
                      <td className="num whitespace-nowrap">
                        {fmtDate(row.e.expenseDate)}
                      </td>
                      <td>
                        <span className="num font-semibold">
                          {row.projectCode}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {row.projectName}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => setEditing(row)}
                        >
                          {row.e.vendor ?? "—"}
                        </button>
                        <div className="max-w-72 truncate text-xs text-muted-foreground">
                          {row.e.description}
                        </div>
                      </td>
                      <td className="right num">
                        {fmtMoney(row.e.amount, { cents: true })}
                      </td>
                      <td className="text-xs">
                        {row.e.billable ? "Billable" : "Non-billable"}
                        <div>
                          {row.e.costable ? "Costable" : "Non-costable"}
                        </div>
                      </td>
                      <td>
                        {row.e.receiptUrl ? (
                          <a
                            href={row.e.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={event => event.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[var(--tp-blue)]"
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
                        {row.e.rejectReason && (
                          <div className="mt-1 max-w-52 text-xs text-[var(--tp-red-strong)]">
                            {row.e.rejectReason}
                          </div>
                        )}
                      </td>
                      <td onClick={event => event.stopPropagation()}>
                        {editableState(row.e.state) && (
                          <ConfirmButton
                            title="Delete this expense?"
                            confirmLabel="Delete"
                            destructive
                            disabled={remove.isPending}
                            onConfirm={() => remove.mutate({ id: row.e.id })}
                          >
                            <Trash2 className="size-3.5" />
                          </ConfirmButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {editing && (
        <ExpenseDrawer
          key={editing === "new" ? "new" : editing.e.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await invalidate();
          }}
        />
      )}
    </>
  );
}
function ExpenseDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: ExpenseRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { today, ref } = useRefData();
  const jobs = trpc.time.week.useQuery({ weekStart: weekStart(today) });
  const [project, setProject] = useState<string | null>(
    row ? String(row.e.projectId) : null
  );
  const [code, setCode] = useState<string | null>(
    row?.e.expenseCodeId ? String(row.e.expenseCodeId) : null
  );
  const [date, setDate] = useState<string | null>(row?.e.expenseDate ?? today);
  const [vendor, setVendor] = useState(row?.e.vendor ?? "");
  const [description, setDescription] = useState(row?.e.description ?? "");
  const [amount, setAmount] = useState<number | null>(row?.e.amount ?? null);
  const [billable, setBillable] = useState(row?.e.billable ?? true);
  const [costable, setCostable] = useState(row?.e.costable ?? true);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = !!row && !editableState(row.e.state);
  const save = trpc.expenses.save.useMutation();
  const jobOptions = (jobs.data?.projects ?? []).map(job => ({
    value: String(job.id),
    label: `${job.code ?? ""} · ${job.name}`,
  }));
  if (row && !jobOptions.some(job => job.value === String(row.e.projectId)))
    jobOptions.push({
      value: String(row.e.projectId),
      label: `${row.projectCode ?? ""} · ${row.projectName}`,
    });
  async function persist() {
    if (!project || !date || !amount || amount <= 0 || locked) return;
    setBusy(true);
    try {
      if (receipt && receipt.size > 10 * 1024 * 1024)
        throw new Error("Receipt must be 10 MB or smaller.");
      const upload = receipt
        ? {
            fileName: receipt.name,
            mimeType: receipt.type || "application/octet-stream",
            base64: await fileToBase64(receipt),
          }
        : undefined;
      await save.mutateAsync({
        id: row?.e.id,
        projectId: Number(project),
        expenseCodeId: code ? Number(code) : null,
        expenseDate: date,
        vendor: vendor || null,
        description: description || null,
        amount,
        billable,
        costable,
        receipt: upload,
      });
      toast.success("Expense saved.");
      await onSaved();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <RecordDrawer
      open
      onOpenChange={open => !open && !busy && onClose()}
      eyebrow="My expenses"
      title={row ? `Expense · ${fmtDate(row.e.expenseDate)}` : "Add expense"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {locked ? "Close" : "Cancel"}
          </Button>
          {!locked && (
            <Button
              disabled={
                busy ||
                !project ||
                !date ||
                !amount ||
                amount <= 0 ||
                amount > 10000000
              }
              onClick={persist}
            >
              {busy ? "Saving…" : "Save expense"}
            </Button>
          )}
        </div>
      }
    >
      {row && (
        <div className="mb-4">
          <EntryState state={row.e.state} />
          {row.e.rejectReason && (
            <div className="mt-2 border bg-[var(--tp-red-soft)] p-3 text-[var(--tp-red-strong)]">
              {row.e.rejectReason}
            </div>
          )}
          {locked && (
            <p className="mt-2 text-xs text-muted-foreground">
              Submitted, approved and invoiced expenses are locked.
            </p>
          )}
        </div>
      )}
      {jobs.error && <ErrorState error={jobs.error} />}
      <fieldset disabled={locked || busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="Job" className="sm:col-span-2">
          <SimpleSelect
            value={project}
            onChange={setProject}
            options={jobOptions}
            disabled={locked || busy}
          />
        </Field>
        <Field label="Expense code">
          <SimpleSelect
            value={code}
            allowNone
            disabled={locked || busy}
            onChange={value => {
              setCode(value);
              const definition = ref?.expenseCodes.find(
                code => code.id === Number(value)
              );
              if (definition) {
                setBillable(definition.billable);
                setCostable(definition.costable);
              }
            }}
            options={(ref?.expenseCodes ?? [])
              .filter(code => code.isActive || code.id === row?.e.expenseCodeId)
              .map(code => ({ value: String(code.id), label: code.name }))}
          />
        </Field>
        <Field label="Date">
          <DateInput
            value={date}
            onChange={setDate}
            disabled={locked || busy}
          />
        </Field>
        <Field label="Vendor">
          <Input
            value={vendor}
            maxLength={200}
            onChange={event => setVendor(event.target.value)}
          />
        </Field>
        <Field label="Amount ($)">
          <NumberInput
            value={amount}
            min={0.01}
            step="0.01"
            onChange={setAmount}
            disabled={locked || busy}
          />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea
            value={description}
            maxLength={500}
            rows={3}
            onChange={event => setDescription(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={billable}
            disabled={locked || busy}
            onCheckedChange={value => setBillable(value === true)}
          />
          Billable
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={costable}
            disabled={locked || busy}
            onCheckedChange={value => setCostable(value === true)}
          />
          Costable
        </label>
        {!locked && (
          <Field label="Receipt · up to 10 MB" className="sm:col-span-2">
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={event => {
                const file = event.target.files?.[0] ?? null;
                if (file && file.size > 10 * 1024 * 1024) {
                  toast.error("Receipt must be 10 MB or smaller.");
                  event.target.value = "";
                  return;
                }
                setReceipt(file);
              }}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              {receipt
                ? receipt.name
                : "Existing receipt is retained unless replaced."}
            </div>
          </Field>
        )}
      </fieldset>
      {row?.e.receiptUrl && (
        <a
          className="mt-4 inline-flex items-center gap-1 text-[var(--tp-blue)]"
          href={row.e.receiptUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open receipt
          <ExternalLink className="size-3" />
        </a>
      )}
    </RecordDrawer>
  );
}
