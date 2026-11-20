import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Plus,
  X,
  Save,
  Download,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { errMsg } from "@/lib/format";
import {
  PageHeader,
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ks/Layout";
import {
  RecordDrawer,
  SimpleSelect,
  NumberInput,
} from "@/components/ks/Controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_SOURCES, type SourceKey } from "@shared/reports";
import { ReportResult } from "@/features/reports/ReportResult";
import { FilterBuilder } from "@/features/reports/FilterBuilder";
import {
  defaultConfig,
  exportCsv,
  normalizeConfig,
  type ReportConfig,
} from "@/features/reports/model";

export default function ReportEditor({ params }: { params?: { id?: string } }) {
  const id = params?.id ? Number(params.id) : undefined;
  const { canGlobal } = useRefData();
  const q = trpc.reports.get.useQuery({ id: id || 1 }, { enabled: !!id });
  if (params?.id && (!id || !Number.isFinite(id)))
    return <ErrorState error={new Error("Invalid report ID")} />;
  if (id && q.isLoading) return <Loading />;
  if (id && q.error) return <ErrorState error={q.error} />;
  if (!id && !canGlobal("report.create"))
    return (
      <EmptyState
        title="Report creation is restricted"
        body="Ask an administrator for report.create access."
      />
    );
  return <Builder key={id ?? "new"} report={q.data} />;
}
function Builder({ report }: { report?: RouterOutputs["reports"]["get"] }) {
  const { ref, canGlobal } = useRefData();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [config, setConfig] = useState<ReportConfig>(() =>
    report ? normalizeConfig(report.config) : defaultConfig()
  );
  const [previewConfig, setPreviewConfig] = useState(config);
  const [saveMode, setSaveMode] = useState<"save" | "copy" | null>(null);
  const [name, setName] = useState(report?.name ?? "");
  const [description, setDescription] = useState(report?.description ?? "");
  const [shared, setShared] = useState(report?.isShared ?? false);
  const [dirty, setDirty] = useState(false);
  const sources = trpc.reports.sources.useQuery();
  const columns = trpc.reports.columns.useQuery({
    source: config.source,
    appKey: config.appKey,
  });
  const cols = columns.data ?? [];
  const numeric = cols.filter(c =>
    ["number", "currency", "percent"].includes(c.type)
  );
  const preview = trpc.reports.run.useQuery(
    { config: previewConfig },
    {
      enabled: config.source !== "logs" || !!previewConfig.appKey,
      retry: false,
    }
  );
  const exportQuery = trpc.reports.run.useQuery(
    { config: { ...previewConfig, output: "table", limit: 15000 } },
    { enabled: false, retry: false }
  );
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewConfig(config), 400);
    return () => clearTimeout(timer);
  }, [config]);
  const update = (changes: Partial<ReportConfig>) => {
    setConfig(c => ({ ...c, ...changes }));
    setDirty(true);
  };
  const save = trpc.reports.save.useMutation({
    onSuccess: async r => {
      setSaveMode(null);
      setDirty(false);
      await Promise.all([
        utils.reports.list.invalidate(),
        utils.reports.get.invalidate({ id: r.id }),
        utils.reports.dashboard.invalidate(),
      ]);
      toast.success("Report saved");
      navigate(`/reports/${r.id}`);
    },
    onError: e => toast.error(errMsg(e)),
  });
  const author = canGlobal("report.create");
  const canSave = author && (!report || report.canEdit);
  const validMetric =
    !config.metric || config.metric.agg === "count" || !!config.metric.field;
  const ready =
    !!config.columns.length &&
    (config.source !== "logs" || !!config.appKey) &&
    validMetric;
  const doExport = async () => {
    setExporting(true);
    try {
      const response = await exportQuery.refetch();
      if (response.error) throw response.error;
      if (response.data)
        exportCsv(response.data, name || report?.name || "report");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExporting(false);
    }
  };
  const moveColumn = (key: string, delta: number) => {
    const list = [...config.columns];
    const i = list.indexOf(key),
      j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update({ columns: list });
  };
  return (
    <div>
      <PageHeader
        eyebrow="Reporting / builder"
        title={report?.name ?? "New report"}
        subtitle={
          report && !report.canEdit
            ? "Shared report · explore freely; Save as to keep a copy."
            : dirty
              ? "Unsaved changes · preview updates automatically."
              : "Select a source, define a view, then save it."
        }
        actions={
          <>
            <Link href="/reports">
              <Button size="sm" variant="outline">
                <ArrowLeft className="size-3.5" />
                Library
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready || exporting || previewConfig !== config}
              onClick={() => void doExport()}
            >
              <Download className="size-3.5" />
              {exporting ? "Exporting…" : "CSV"}
            </Button>
            {author && report && (
              <Button
                size="sm"
                variant="outline"
                disabled={!ready}
                onClick={() => {
                  setName(`${report.name} copy`);
                  setDescription(report.description ?? "");
                  setShared(report.isShared);
                  setSaveMode("copy");
                }}
              >
                Save as
              </Button>
            )}
            {canSave && (
              <Button
                size="sm"
                disabled={!ready || save.isPending}
                onClick={() => {
                  if (report) {
                    setName(report.name);
                    setDescription(report.description ?? "");
                    setShared(report.isShared);
                  }
                  setSaveMode("save");
                }}
              >
                <Save className="size-3.5" />
                Save
              </Button>
            )}
          </>
        }
      />
      <div className="grid items-start gap-4 p-5 2xl:grid-cols-[540px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="01 / source & output" bodyClassName="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Source">
                <SimpleSelect
                  value={config.source}
                  onChange={v => {
                    if (v) {
                      setConfig(defaultConfig(v));
                      setDirty(true);
                    }
                  }}
                  options={(sources.data ?? Object.values(REPORT_SOURCES)).map(
                    s => ({ value: s.key as SourceKey, label: s.label })
                  )}
                />
              </Field>
              <Field label="Output">
                <SimpleSelect
                  value={config.output}
                  onChange={v => update({ output: v ?? "table" })}
                  options={{
                    table: "Table",
                    bar: "Bar",
                    line: "Line",
                    pie: "Pie",
                  }}
                />
              </Field>
            </div>
            {config.source === "logs" && (
              <Field label="Log app">
                <SimpleSelect
                  value={config.appKey}
                  onChange={v =>
                    update({
                      appKey: v ?? undefined,
                      columns: [...REPORT_SOURCES.logs.defaultColumns],
                      filters: [],
                      groupBy: undefined,
                      sort: [],
                      metric: { agg: "count" },
                    })
                  }
                  options={(ref?.apps ?? []).map(a => ({
                    value: a.key,
                    label: a.name,
                  }))}
                  placeholder="Choose RFI, CO, backcharge…"
                />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Group by">
                <SimpleSelect
                  value={config.groupBy}
                  onChange={v => update({ groupBy: v ?? undefined })}
                  options={cols.map(c => ({ value: c.key, label: c.label }))}
                  allowNone
                />
              </Field>
              <Field label="Row limit / max 15,000">
                <NumberInput
                  min={1}
                  step={1}
                  value={config.limit ?? 15000}
                  onChange={v =>
                    update({
                      limit: Math.min(
                        15000,
                        Math.max(1, Math.round(v ?? 15000))
                      ),
                    })
                  }
                />
              </Field>
            </div>
            {config.output !== "table" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Metric">
                  <SimpleSelect
                    value={config.metric?.agg ?? "count"}
                    onChange={v =>
                      update({
                        metric: {
                          agg: v ?? "count",
                          field:
                            v === "count"
                              ? undefined
                              : (config.metric?.field ?? numeric[0]?.key),
                        },
                      })
                    }
                    options={{
                      count: "Count records",
                      sum: "Sum",
                      avg: "Average",
                      min: "Minimum",
                      max: "Maximum",
                    }}
                  />
                </Field>
                {config.metric?.agg !== "count" && (
                  <Field label="Numeric field">
                    <SimpleSelect
                      value={config.metric?.field}
                      onChange={v =>
                        update({
                          metric: {
                            agg: config.metric?.agg ?? "sum",
                            field: v ?? undefined,
                          },
                        })
                      }
                      options={numeric.map(c => ({
                        value: c.key,
                        label: c.label,
                      }))}
                    />
                  </Field>
                )}
              </div>
            )}
            {(config.output === "line" ||
              cols.find(c => c.key === config.groupBy)?.type === "date") && (
              <div className="flex items-end gap-4">
                <Field label="Date bucket">
                  <SimpleSelect
                    value={config.dateBucket ?? "week"}
                    onChange={v => update({ dateBucket: v ?? "week" })}
                    options={{ day: "Day", week: "Week", month: "Month" }}
                  />
                </Field>
                {config.output === "line" && (
                  <label className="flex h-9 items-center gap-2 text-xs">
                    <Checkbox
                      checked={config.cumulative ?? false}
                      onCheckedChange={v => update({ cumulative: !!v })}
                    />
                    Cumulative
                  </label>
                )}
              </div>
            )}
            {config.output === "line" && (
              <p className="text-[11px] text-muted-foreground">
                Group by a date field. With no date selected, the source's first
                date field is used.
              </p>
            )}
          </Panel>
          <Panel
            title={`02 / columns (${config.columns.length}/40)`}
            bodyClassName="p-4"
          >
            {columns.isLoading ? (
              <Loading className="py-4" />
            ) : columns.error ? (
              <ErrorState error={columns.error} />
            ) : (
              <>
                <div className="grid max-h-64 grid-cols-2 gap-x-4 gap-y-2 overflow-auto">
                  {cols.map(c => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 text-xs"
                    >
                      <Checkbox
                        checked={config.columns.includes(c.key)}
                        disabled={
                          !config.columns.includes(c.key) &&
                          config.columns.length >= 40
                        }
                        onCheckedChange={v =>
                          update({
                            columns: v
                              ? [...config.columns, c.key]
                              : config.columns.filter(k => k !== c.key),
                          })
                        }
                      />
                      <span>
                        {c.label}
                        {c.key.startsWith("cf_") && (
                          <span className="ml-1 text-muted-foreground">
                            custom
                          </span>
                        )}
                        {c.financial && (
                          <span className="ml-1 text-muted-foreground">$</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 max-h-40 overflow-auto border-t border-[var(--ks-rule)] pt-2">
                  {config.columns.map((key, i) => (
                    <div
                      key={key}
                      className="flex items-center gap-1 py-0.5 text-xs"
                    >
                      <span className="num w-5 text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="flex-1">
                        {cols.find(c => c.key === key)?.label ?? key}
                      </span>
                      <button
                        aria-label={`Move ${key} up`}
                        disabled={!i}
                        onClick={() => moveColumn(key, -1)}
                        className="p-1 disabled:opacity-20"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        aria-label={`Move ${key} down`}
                        disabled={i === config.columns.length - 1}
                        onClick={() => moveColumn(key, 1)}
                        className="p-1 disabled:opacity-20"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
          <Panel title="03 / filters" bodyClassName="p-4">
            <FilterBuilder
              columns={cols}
              filters={config.filters}
              onChange={filters => update({ filters })}
            />
          </Panel>
          <Panel title="04 / sort" bodyClassName="space-y-2 p-4">
            {(config.sort ?? []).map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_32px] gap-2">
                <SimpleSelect
                  value={s.field}
                  onChange={v =>
                    update({
                      sort: config.sort?.map((x, n) =>
                        n === i ? { ...x, field: v ?? "" } : x
                      ),
                    })
                  }
                  options={cols.map(c => ({ value: c.key, label: c.label }))}
                  size="sm"
                />
                <SimpleSelect
                  value={s.dir}
                  onChange={v =>
                    update({
                      sort: config.sort?.map((x, n) =>
                        n === i ? { ...x, dir: v ?? "asc" } : x
                      ),
                    })
                  }
                  options={{ asc: "Ascending", desc: "Descending" }}
                  size="sm"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove sort"
                  onClick={() =>
                    update({ sort: config.sort?.filter((_, n) => n !== i) })
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={!cols.length || (config.sort?.length ?? 0) >= 4}
              onClick={() =>
                update({
                  sort: [
                    ...(config.sort ?? []),
                    { field: cols[0].key, dir: "asc" },
                  ],
                })
              }
            >
              <Plus className="size-3" />
              Add sort
            </Button>
          </Panel>
        </div>
        <Panel
          title="Live preview"
          actions={
            <span className="text-xs text-muted-foreground">
              {preview.isFetching || previewConfig !== config
                ? "Updating…"
                : "Current"}
            </span>
          }
          className="2xl:sticky 2xl:top-3"
        >
          {!ready ? (
            <EmptyState
              title="Complete the report definition"
              body="Choose columns, a log app if needed, and a numeric metric for charts."
            />
          ) : preview.isLoading ? (
            <Loading />
          ) : preview.error ? (
            <ErrorState error={preview.error} />
          ) : (
            preview.data && (
              <ReportResult result={preview.data} config={previewConfig} />
            )
          )}
        </Panel>
      </div>
      <RecordDrawer
        open={!!saveMode}
        onOpenChange={open => {
          if (!open) setSaveMode(null);
        }}
        eyebrow="Report / save"
        title={saveMode === "copy" ? "Save a report copy" : "Save report"}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveMode(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!name.trim() || save.isPending || !ready}
              onClick={() =>
                save.mutate({
                  id:
                    saveMode === "save" && report?.canEdit
                      ? report.id
                      : undefined,
                  name: name.trim(),
                  description: description.trim() || null,
                  isShared: shared,
                  config,
                })
              }
            >
              {save.isPending ? "Saving…" : "Save report"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={200}
              className="bg-[var(--ks-paper)]"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              className="bg-[var(--ks-paper)]"
            />
          </Field>
          <label className="flex items-center gap-2">
            <Checkbox checked={shared} onCheckedChange={v => setShared(!!v)} />
            Shared with other users
          </label>
          <p className="text-xs text-muted-foreground">
            Reports always respect each viewer's job and financial privileges.
          </p>
        </div>
      </RecordDrawer>
    </div>
  );
}
