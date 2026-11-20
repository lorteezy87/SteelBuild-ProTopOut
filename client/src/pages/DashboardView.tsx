import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  Plus,
  Pencil,
  Save,
  Trash2,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ks/Layout";
import { ConfirmButton, SimpleSelect } from "@/components/ks/Controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DASHBOARD_WIDGET_CAP } from "@shared/reports";
import { ReportResult } from "@/features/reports/ReportResult";
import { normalizeConfig, type Widget } from "@/features/reports/model";

const span = { sm: "md:col-span-2", md: "md:col-span-3", lg: "md:col-span-6" };
function DraftResult({ reportId }: { reportId: number }) {
  const q = trpc.reports.runSaved.useQuery({ id: reportId });
  return q.isLoading ? (
    <Loading />
  ) : q.error ? (
    <ErrorState error={q.error} />
  ) : q.data ? (
    <ReportResult
      compact
      result={q.data.result}
      config={normalizeConfig(q.data.report.config)}
    />
  ) : null;
}
export default function DashboardView({
  params,
}: {
  params?: { id?: string };
}) {
  const id = Number(params?.id);
  const q = trpc.reports.dashboard.useQuery(
    { id: id || 1 },
    { enabled: Number.isFinite(id) && id > 0 }
  );
  if (!Number.isFinite(id) || id <= 0)
    return <ErrorState error={new Error("Invalid dashboard ID")} />;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return q.data ? (
    <Dashboard
      key={id}
      dashboard={q.data}
      refresh={() => void q.refetch()}
      fetching={q.isFetching}
    />
  ) : null;
}
function Dashboard({
  dashboard: b,
  refresh,
  fetching,
}: {
  dashboard: RouterOutputs["reports"]["dashboard"];
  refresh: () => void;
  fetching: boolean;
}) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(b.name);
  const [shared, setShared] = useState(b.isShared);
  const [widgets, setWidgets] = useState<Widget[]>(
    b.widgets.map(w => ({ reportId: w.reportId, size: w.size, title: w.title }))
  );
  const [addId, setAddId] = useState<string | null>(null);
  const reports = trpc.reports.list.useQuery(undefined, { enabled: editing });
  const save = trpc.reports.saveDashboard.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.reports.dashboard.invalidate({ id: b.id }),
        utils.reports.dashboards.invalidate(),
      ]);
      setEditing(false);
      toast.success("Dashboard saved");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.reports.removeDashboard.useMutation({
    onSuccess: async () => {
      await utils.reports.dashboards.invalidate();
      toast.success("Dashboard deleted");
      navigate("/dashboards");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const startEdit = () => {
    setName(b.name);
    setShared(b.isShared);
    setWidgets(
      b.widgets.map(w => ({
        reportId: w.reportId,
        size: w.size,
        title: w.title,
      }))
    );
    setEditing(true);
  };
  const update = (i: number, values: Partial<Widget>) =>
    setWidgets(list => list.map((w, n) => (i === n ? { ...w, ...values } : w)));
  const reorder = (i: number, delta: number) =>
    setWidgets(list => {
      const next = [...list],
        j = i + delta;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <div>
      <PageHeader
        eyebrow="Reporting / dashboard"
        title={editing ? "Edit dashboard" : b.name}
        subtitle={`${editing ? widgets.length : b.widgets.length} / 10 widgets · ${editing ? "Changes are not saved until you save." : b.isShared ? "Shared" : "Private"}`}
        actions={
          <>
            <Link href="/dashboards">
              <Button size="sm" variant="outline">
                <ArrowLeft className="size-3.5" />
                Dashboards
              </Button>
            </Link>
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={save.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!name.trim() || save.isPending}
                  onClick={() =>
                    save.mutate({
                      id: b.id,
                      name: name.trim(),
                      isShared: shared,
                      widgets,
                    })
                  }
                >
                  <Save className="size-3.5" />
                  {save.isPending ? "Saving…" : "Save dashboard"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refresh}
                  disabled={fetching}
                >
                  <RefreshCw className="size-3.5" />
                  Refresh
                </Button>
                {b.canEdit && (
                  <Button size="sm" onClick={startEdit}>
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                )}
              </>
            )}
            {b.canEdit && (
              <ConfirmButton
                title={`Delete ${b.name}?`}
                body="Saved reports will remain available."
                destructive
                confirmLabel="Delete"
                disabled={remove.isPending || save.isPending}
                onConfirm={() => remove.mutate({ id: b.id })}
              >
                <Trash2 className="size-3.5" />
              </ConfirmButton>
            )}
          </>
        }
      />
      <div className="space-y-4 p-5">
        {editing && (
          <Panel
            title="Dashboard settings"
            bodyClassName="flex flex-wrap items-end gap-4 p-4"
          >
            <Field label="Name" className="min-w-64 flex-1">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={200}
                className="bg-[var(--ks-paper)]"
              />
            </Field>
            <label className="flex h-9 items-center gap-2">
              <Checkbox
                checked={shared}
                onCheckedChange={v => setShared(!!v)}
              />
              Shared
            </label>
            <Field label="Add saved report" className="min-w-64 flex-1">
              <SimpleSelect
                value={addId}
                onChange={setAddId}
                options={(reports.data ?? []).map(r => ({
                  value: String(r.id),
                  label: `${r.name}${r.isShared ? "" : " · private"}`,
                }))}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              disabled={!addId || widgets.length >= DASHBOARD_WIDGET_CAP}
              onClick={() => {
                if (addId)
                  setWidgets([
                    ...widgets,
                    { reportId: Number(addId), size: "md" },
                  ]);
                setAddId(null);
              }}
            >
              <Plus className="size-3.5" />
              Add widget
            </Button>
            {reports.error && <ErrorState error={reports.error} />}
            <p className="w-full text-[11px] text-muted-foreground">
              Private reports remain unavailable to other viewers, even on a
              shared dashboard. Small = one third, medium = half, large = full
              width.
            </p>
          </Panel>
        )}
        <div className="grid items-start gap-4 md:grid-cols-6">
          {editing
            ? widgets.map((w, i) => (
                <Panel
                  key={`${i}-${w.reportId}`}
                  className={cn(span[w.size])}
                  title={`${i + 1} / ${reports.data?.find(r => r.id === w.reportId)?.name ?? "Report"}`}
                  actions={
                    <>
                      <button
                        className="p-1 disabled:opacity-20"
                        disabled={!i}
                        aria-label="Move widget up"
                        onClick={() => reorder(i, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        className="p-1 disabled:opacity-20"
                        disabled={i === widgets.length - 1}
                        aria-label="Move widget down"
                        onClick={() => reorder(i, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        className="p-1"
                        aria-label="Remove widget"
                        onClick={() =>
                          setWidgets(widgets.filter((_, n) => n !== i))
                        }
                      >
                        <X className="size-3.5" />
                      </button>
                    </>
                  }
                >
                  <div className="grid grid-cols-[1fr_100px] gap-2 border-b border-[var(--ks-rule)] p-3">
                    <Input
                      aria-label="Widget title"
                      value={w.title ?? ""}
                      maxLength={120}
                      placeholder="Title override"
                      onChange={e =>
                        update(i, { title: e.target.value || undefined })
                      }
                      className="bg-[var(--ks-paper)]"
                    />
                    <SimpleSelect
                      value={w.size}
                      onChange={v => update(i, { size: v ?? "md" })}
                      options={{ sm: "Small", md: "Medium", lg: "Large" }}
                      size="sm"
                    />
                  </div>
                  <DraftResult reportId={w.reportId} />
                </Panel>
              ))
            : b.widgets.map((w, i) => (
                <Panel
                  key={`${i}-${w.reportId}`}
                  className={span[w.size]}
                  title={w.title || w.report?.name || "Unavailable report"}
                  actions={
                    w.report && (
                      <Link
                        href={`/reports/${w.report.id}`}
                        className="text-xs hover:underline"
                      >
                        Open ↗
                      </Link>
                    )
                  }
                >
                  {w.error ? (
                    <ErrorState error={new Error(w.error)} />
                  ) : (
                    w.result && (
                      <ReportResult
                        compact
                        result={w.result}
                        config={
                          w.report
                            ? normalizeConfig(w.report.config)
                            : undefined
                        }
                      />
                    )
                  )}
                </Panel>
              ))}
        </div>
        {!(editing ? widgets.length : b.widgets.length) && (
          <Panel>
            <EmptyState
              title="No widgets yet"
              body={
                b.canEdit
                  ? "Edit this dashboard and add a saved report."
                  : "The dashboard owner has not added any reports."
              }
              action={
                !editing && b.canEdit ? (
                  <Button size="sm" onClick={startEdit}>
                    Add widgets
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
