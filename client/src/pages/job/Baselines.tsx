import { useState } from "react";
import { Link } from "wouter";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ConfirmButton,
  RecordDrawer,
  SimpleSelect,
} from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Field,
  Kpi,
  Loading,
  Panel,
} from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { varianceLabel } from "@/features/jobs/metrics";
import { errMsg, fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useJob, useJobInvalidate } from "./JobContext";

export default function Baselines() {
  const { projectId, data, can } = useJob();
  const utils = trpc.useUtils();
  const invalidate = useJobInvalidate();
  const q = trpc.baselines.list.useQuery({ projectId });
  const [selected, setSelected] = useState<string | null>(null);
  const compareId = selected
    ? Number(selected)
    : (q.data?.activeBaselineId ?? q.data?.baselines[0]?.id);
  const compare = trpc.baselines.compare.useQuery(
    { projectId, baselineId: compareId ?? 0 },
    { enabled: !!compareId }
  );
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const refresh = async () => {
    await Promise.all([
      utils.baselines.list.invalidate({ projectId }),
      utils.baselines.compare.invalidate({ projectId }),
      invalidate(projectId),
    ]);
  };
  const create = trpc.baselines.create.useMutation({
    onSuccess: r => {
      setSelected(String(r.id));
      setSaving(false);
      setName("");
      void refresh();
      toast.success("Baseline saved.");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const activate = trpc.baselines.setActive.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success("Active baseline updated.");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.baselines.remove.useMutation({
    onSuccess: () => {
      setSelected(null);
      void refresh();
      toast.success("Baseline deleted.");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const earned = data.eva;
  const varianceClass = (v: number | null) =>
    v == null
      ? "text-muted-foreground"
      : v > 0
        ? "hazard text-[var(--tp-red-strong)]"
        : v < 0
          ? "text-[var(--tp-green)]"
          : "";
  return (
    <div className="space-y-4 p-5">
      {data.canFinancials && earned && (
        <Panel title="Earned value analysis" bodyClassName="p-3">
          <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {(["pv", "ev", "ac", "cpi", "spi", "sv", "cv", "eac"] as const).map(
              key => (
                <Kpi
                  key={key}
                  label={key.toUpperCase()}
                  value={
                    <span className="text-[17px]">
                      {key === "cpi" || key === "spi"
                        ? fmtNum(earned[key], 2)
                        : fmtMoney(earned[key], { compact: true })}
                    </span>
                  }
                  tone={
                    (key === "sv" || key === "cv") && (earned[key] ?? 0) < 0
                      ? "red"
                      : "gray"
                  }
                />
              )
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            PV planned value · EV earned value · AC actual cost · CPI/SPI
            performance indices · SV/CV variances · EAC estimate at completion.
            Current budget and active baseline dates drive EVA.
          </p>
        </Panel>
      )}
      <Panel
        title="Schedule baselines"
        actions={
          can("baseline.manage") && (
            <Button size="sm" onClick={() => setSaving(true)}>
              <Plus className="size-3.5" />
              Save baseline
            </Button>
          )
        }
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.baselines.length ? (
          <EmptyState
            title="No baseline saved"
            body="Save the approved schedule before tracking finish variance."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>State</th>
                  <th className="right">Tasks</th>
                  <th>Planned finish</th>
                  {data.canFinancials && <th className="right">Budget</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.baselines.map(b => (
                  <tr
                    key={b.id}
                    className={compareId === b.id ? "is-selected" : ""}
                  >
                    <td>
                      <button
                        className="font-semibold hover:text-[var(--tp-accent-ink)]"
                        onClick={() => setSelected(String(b.id))}
                      >
                        {b.name}
                      </button>
                    </td>
                    <td className="num">{fmtDateTime(b.createdAt)}</td>
                    <td>
                      {q.data.activeBaselineId === b.id ? (
                        <Pill tone="orange">
                          <Check className="size-3" />
                          Active
                        </Pill>
                      ) : (
                        <Pill>Saved</Pill>
                      )}
                    </td>
                    <td className="right num">{b.taskCount}</td>
                    <td className="num">{fmtDate(b.plannedFinish)}</td>
                    {data.canFinancials && (
                      <td className="right num">{fmtMoney(b.budget)}</td>
                    )}
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(String(b.id))}
                        >
                          Compare
                        </Button>
                        {can("baseline.manage") && (
                          <>
                            {q.data.activeBaselineId !== b.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={activate.isPending}
                                onClick={() =>
                                  activate.mutate({
                                    projectId,
                                    baselineId: b.id,
                                  })
                                }
                              >
                                Set active
                              </Button>
                            )}
                            <ConfirmButton
                              destructive
                              title={`Delete baseline "${b.name}"?`}
                              body="This snapshot cannot be restored. The current schedule is not changed."
                              onConfirm={() => remove.mutate({ id: b.id })}
                              disabled={remove.isPending}
                            >
                              <Trash2 className="size-3.5" />
                            </ConfirmButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!!q.data?.activeBaselineId && can("baseline.manage") && (
          <div className="border-t border-[var(--tp-rule)] p-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={activate.isPending}
              onClick={() => activate.mutate({ projectId, baselineId: null })}
            >
              Clear active baseline
            </Button>
          </div>
        )}
      </Panel>
      {!!compareId && (
        <Panel
          title="Baseline vs current schedule"
          actions={
            <div className="w-56">
              <SimpleSelect
                value={String(compareId)}
                onChange={setSelected}
                options={(q.data?.baselines ?? []).map(b => ({
                  value: String(b.id),
                  label: b.name,
                }))}
                size="sm"
              />
            </div>
          }
        >
          {compare.isLoading ? (
            <Loading />
          ) : compare.error ? (
            <ErrorState error={compare.error} />
          ) : (
            compare.data && (
              <>
                <div className="flex flex-wrap items-center gap-5 border-b border-[var(--tp-rule)] p-4">
                  <Field label="Baseline finish">
                    <span className="num">
                      {fmtDate(compare.data.baseline.plannedFinish)}
                    </span>
                  </Field>
                  <Field label="Current finish">
                    <span className="num">
                      {fmtDate(compare.data.project.plannedFinish)}
                    </span>
                  </Field>
                  <Field label="Job finish variance">
                    <span
                      className={`num font-semibold ${varianceClass(compare.data.finishVariance)}`}
                    >
                      {varianceLabel(compare.data.finishVariance, "work days")}
                    </span>
                  </Field>
                </div>
                <div className="overflow-x-auto">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>WBS</th>
                        <th>Task</th>
                        <th>Baseline finish</th>
                        <th>Current finish</th>
                        <th className="right">Finish variance (work days)</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.data.items.map(t => (
                        <tr key={t.taskId}>
                          <td className="num">{t.wbs || "—"}</td>
                          <td className={t.isSummary ? "font-semibold" : ""}>
                            {t.removed ? (
                              t.name
                            ) : (
                              <Link
                                href={`/jobs/${projectId}/tasks?task=${t.taskId}`}
                                className="hover:text-[var(--tp-accent-ink)]"
                              >
                                {t.name}
                              </Link>
                            )}
                          </td>
                          <td className="num">{fmtDate(t.baselineFinish)}</td>
                          <td className="num">{fmtDate(t.currentFinish)}</td>
                          <td
                            className={`right num ${varianceClass(t.finishVariance)}`}
                          >
                            {t.finishVariance == null
                              ? "—"
                              : `${t.finishVariance > 0 ? "+" : ""}${t.finishVariance}`}
                          </td>
                          <td>
                            {t.removed && <Pill tone="red">Removed</Pill>}
                          </td>
                        </tr>
                      ))}
                      {compare.data.added.map(t => (
                        <tr key={t.taskId}>
                          <td className="num">{t.wbs}</td>
                          <td>{t.name}</td>
                          <td>—</td>
                          <td className="num">{fmtDate(t.currentFinish)}</td>
                          <td>—</td>
                          <td>
                            <Pill tone="blue">Added</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </Panel>
      )}
      {saving && (
        <RecordDrawer
          open
          onOpenChange={o => !o && setSaving(false)}
          eyebrow="Schedule control"
          title="Save baseline"
          width={460}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || create.isPending}
                onClick={() =>
                  create.mutate({
                    projectId,
                    name: name.trim(),
                    setActive: active,
                  })
                }
              >
                Save baseline
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Baseline name">
              <Input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Approved erection schedule / Rev 0"
              />
            </Field>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={active}
                onCheckedChange={v => setActive(v === true)}
              />
              Set as active baseline
            </label>
            <p className="text-[12px] text-muted-foreground">
              Captures task dates, duration, effort, planned tons and budget.
              Active baseline dates drive EVA and the schedule ghost bars.
            </p>
          </div>
        </RecordDrawer>
      )}
    </div>
  );
}
