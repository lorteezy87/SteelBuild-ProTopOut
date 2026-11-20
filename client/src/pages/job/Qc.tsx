import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  BOLT_GRADES,
  BOLT_METHODS,
  NDT_METHODS,
  QC_RESULTS,
  SEQUENCE_QC_LABEL,
  SI_RESULTS,
  SI_TYPES,
  WELD_PROCESSES,
  type SequenceQcStatus,
} from "@shared/qc";
import { SimpleSelect } from "@/components/brand/Controls";
import { ErrorState, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nullableNumber, nullableText, text, type Draft, type EditorField } from "@/features/admin/Editor";
import { RecordList, type Column } from "@/features/records/RecordList";
import { useRefData } from "@/lib/ref";
import { errMsg, fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useJob } from "./JobContext";

const STATUS_TONE: Record<SequenceQcStatus, "red" | "amber" | "green" | "gray"> = { deficiency: "red", pending: "amber", clear: "green", no_records: "gray" };
const RESULT_TONE: Record<string, "red" | "amber" | "green" | "gray"> = { fail: "red", failed: "red", pending: "amber", requested: "amber", scheduled: "amber", pass: "green", passed: "green", na: "gray" };
const lbl = (m: Record<string, string>, k: string | null | undefined) => (k ? m[k] ?? k : "—");
const nullableId = (d: Draft, k: string) => (d[k] == null || d[k] === "" ? null : Number(d[k]));
const today = () => new Date().toLocaleDateString("en-CA");

type Row = { id: number; taskId: number | null; result: string; punchItemId: number | null; punchLabel: string | null } & Record<string, unknown>;

/** Job tab: field bolting and welding logs, special inspections, and failed entries turned into punch items. */
export default function Qc() {
  const { projectId, can } = useJob();
  const editable = can("task.edit");
  const tasks = trpc.tasks.list.useQuery({ projectId });
  const seqs = useMemo(() => (tasks.data?.tasks ?? []).filter(t => t.kind === "sequence" && !t.isSummary), [tasks.data]);
  const [seq, setSeq] = useState<string | null>(null);
  const filter = { projectId, ...(seq ? { taskId: Number(seq) } : {}) };
  const summary = trpc.qc.summary.useQuery({ projectId });
  const bolts = trpc.qc.bolts.list.useQuery(filter);
  const welds = trpc.qc.welds.list.useQuery(filter);
  const insp = trpc.qc.inspections.list.useQuery(filter);
  const { ref } = useRefData();
  const utils = trpc.useUtils();
  const refresh = () => Promise.all([utils.qc.invalidate()]);
  const opts = { onSuccess: refresh };
  const m = {
    bolt: { c: trpc.qc.bolts.create.useMutation(opts), u: trpc.qc.bolts.update.useMutation(opts), r: trpc.qc.bolts.remove.useMutation(opts) },
    weld: { c: trpc.qc.welds.create.useMutation(opts), u: trpc.qc.welds.update.useMutation(opts), r: trpc.qc.welds.remove.useMutation(opts) },
    inspection: { c: trpc.qc.inspections.create.useMutation(opts), u: trpc.qc.inspections.update.useMutation(opts), r: trpc.qc.inspections.remove.useMutation(opts) },
  };
  const punch = trpc.qc.createPunch.useMutation({
    onSuccess: r => {
      toast.success(`Created ${r.label}`);
      void refresh();
    },
    onError: e => toast.error(errMsg(e)),
  });
  if (bolts.isLoading || welds.isLoading || insp.isLoading || summary.isLoading) return <Loading label="Loading QC logs…" />;
  const err = bolts.error || welds.error || insp.error || summary.error;
  if (err) return <ErrorState error={err} />;

  const seqOpts = seqs.map(s => ({ value: String(s.id), label: s.name }));
  const seqName = (id: number | null) => (id ? seqs.find(s => s.id === id)?.name ?? "—" : "—");
  const seqField: EditorField = { key: "taskId", label: "Sequence", type: "select", nullable: true, options: seqOpts };
  const crewOpts = (ref?.users ?? []).filter(u => u.isActive).map(u => ({ value: String(u.id), label: u.name ?? `#${u.id}` }));
  const result = (r: Row) => <Pill tone={RESULT_TONE[r.result] ?? "gray"}>{lbl({ ...QC_RESULTS, ...SI_RESULTS }, r.result)}</Pill>;
  const punchCell = (kind: "bolt" | "weld" | "inspection") => (r: Row) =>
    r.punchLabel && r.punchItemId ? (
      <Link className="font-medium text-[var(--tp-accent-ink)] underline" href={`/jobs/${projectId}/logs/punch/${r.punchItemId}`}>{r.punchLabel}</Link>
    ) : (r.result === "fail" || r.result === "failed") && editable ? (
      <Button size="sm" variant="outline" disabled={punch.isPending} onClick={() => punch.mutate({ kind, id: r.id })}>Create punch item</Button>
    ) : null;
  const save = (kind: keyof typeof m, input: Record<string, unknown>) => (_: Draft, row: Row | null) =>
    row ? m[kind].u.mutateAsync({ id: row.id, ...input } as never) : m[kind].c.mutateAsync({ projectId, ...input } as never);
  const toDraft = (r: Row): Draft => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "taskId" || k === "welderUserId" ? (v == null ? null : String(v)) : (v as Draft[string])]));
  const need = (d: Draft, ...keys: string[]) => (keys.some(k => !text(d, k).trim()) ? "Fill in the required fields: date, location and type" : null);

  const boltFields: EditorField[] = [
    { key: "logDate", label: "Date", type: "date", required: true },
    seqField,
    { key: "location", label: "Connection / location (grid, level)", required: true },
    { key: "grade", label: "Bolt grade", type: "select", options: BOLT_GRADES },
    { key: "method", label: "Installation method", type: "select", options: BOLT_METHODS },
    { key: "lotNumber", label: "Lot / heat number" },
    { key: "boltCount", label: "Bolt count", type: "number", step: 1, help: "Blank = not counted." },
    { key: "inspectorName", label: "Inspector" },
    { key: "result", label: "Result", type: "select", options: QC_RESULTS },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const boltInput = (d: Draft) => ({
    logDate: text(d, "logDate"), taskId: nullableId(d, "taskId"), location: text(d, "location").trim(), grade: text(d, "grade") as never, method: text(d, "method") as never,
    lotNumber: nullableText(d, "lotNumber"), boltCount: nullableNumber(d, "boltCount"), inspectorName: nullableText(d, "inspectorName"), result: text(d, "result") as never, notes: nullableText(d, "notes"),
  });
  const weldFields: EditorField[] = [
    { key: "logDate", label: "Date", type: "date", required: true },
    seqField,
    { key: "location", label: "Joint / location", required: true },
    { key: "welderUserId", label: "Welder (crew)", type: "select", nullable: true, options: crewOpts },
    { key: "welderName", label: "Welder (if not on the crew list)" },
    { key: "wps", label: "WPS" },
    { key: "process", label: "Process", type: "select", options: WELD_PROCESSES },
    { key: "weldSize", label: "Weld size" },
    { key: "ndt", label: "NDT", type: "select", options: NDT_METHODS },
    { key: "inspectorName", label: "Inspector" },
    { key: "result", label: "Result", type: "select", options: QC_RESULTS },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const weldInput = (d: Draft) => ({
    logDate: text(d, "logDate"), taskId: nullableId(d, "taskId"), location: text(d, "location").trim(), welderUserId: nullableId(d, "welderUserId"), welderName: nullableText(d, "welderName"),
    wps: nullableText(d, "wps"), process: text(d, "process") as never, weldSize: nullableText(d, "weldSize"), ndt: text(d, "ndt") as never, inspectorName: nullableText(d, "inspectorName"), result: text(d, "result") as never, notes: nullableText(d, "notes"),
  });
  const siFields: EditorField[] = [
    { key: "type", label: "Inspection", type: "select", options: SI_TYPES },
    seqField,
    { key: "agency", label: "Agency / inspector" },
    { key: "requestedDate", label: "Requested", type: "date" },
    { key: "scheduledDate", label: "Scheduled", type: "date" },
    { key: "inspectedDate", label: "Inspected", type: "date" },
    { key: "result", label: "Result", type: "select", options: SI_RESULTS },
    { key: "reportNumber", label: "Report #" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const day = (d: Draft, k: string) => nullableText(d, k);
  const siInput = (d: Draft) => ({
    type: text(d, "type") as never, taskId: nullableId(d, "taskId"), agency: nullableText(d, "agency"), requestedDate: day(d, "requestedDate"), scheduledDate: day(d, "scheduledDate"),
    inspectedDate: day(d, "inspectedDate"), result: text(d, "result") as never, reportNumber: nullableText(d, "reportNumber"), notes: nullableText(d, "notes"),
  });
  const blankSeq = seq ?? null;
  const common: Column<Row>[] = [{ label: "Sequence", cell: r => seqName(r.taskId) }];
  const del = (kind: keyof typeof m) => (r: Row) => m[kind].r.mutateAsync({ id: r.id });

  return (
    <div className="space-y-4">
      <Panel
        title="QC by sequence"
        actions={
          <div className="flex items-center gap-2">
            <div className="w-56"><SimpleSelect value={seq} allowNone noneLabel="All sequences" options={seqOpts} onChange={v => setSeq(v)} /></div>
            <Button size="sm" variant="outline" asChild>
              <a href={`/print/qc/${projectId}${seq ? `?sequence=${seq}` : ""}`} target="_blank" rel="noreferrer"><Printer className="size-3.5" /> Print QC log</a>
            </Button>
          </div>
        }
      >
        {!(summary.data ?? []).length ? (
          <p className="text-sm text-muted-foreground">Add sequences to the schedule to track QC by sequence.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(summary.data ?? []).map(s => (
              <span key={s.taskId} className="inline-flex items-center gap-1.5 text-sm">
                {s.name} <Pill tone={STATUS_TONE[s.status]}>{SEQUENCE_QC_LABEL[s.status]}</Pill>
              </span>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="QC logs" bodyClassName="p-0">
        <Tabs defaultValue="bolt">
          <TabsList className="mx-4 mt-3">
            <TabsTrigger value="bolt">Bolting ({(bolts.data ?? []).length})</TabsTrigger>
            <TabsTrigger value="weld">Welding ({(welds.data ?? []).length})</TabsTrigger>
            <TabsTrigger value="inspection">Special inspections ({(insp.data ?? []).length})</TabsTrigger>
          </TabsList>
          <TabsContent value="bolt">
            <RecordList<Row>
              rows={(bolts.data ?? []) as Row[]}
              noun="Bolting entry"
              editable={editable}
              minWidth={980}
              empty={{ title: "No bolting entries", body: "Log each connection's bolt grade, lot, installation method and the inspector's result." }}
              columns={[
                { label: "Date", cell: r => fmtDate(r.logDate as string), className: "num" },
                ...common,
                { label: "Location", cell: r => String(r.location) },
                { label: "Grade", cell: r => lbl(BOLT_GRADES, r.grade as string) },
                { label: "Method", cell: r => lbl(BOLT_METHODS, r.method as string) },
                { label: "Lot", cell: r => (r.lotNumber as string) || "—" },
                { label: "Inspector", cell: r => (r.inspectorName as string) || "—" },
                { label: "Result", cell: result },
              ]}
              rowActions={punchCell("bolt")}
              fields={boltFields}
              blank={{ logDate: today(), taskId: blankSeq, grade: "a325", method: "turn_of_nut", result: "pending" }}
              toDraft={toDraft}
              validate={d => need(d, "logDate", "location")}
              onSave={(d, row) => save("bolt", boltInput(d))(d, row)}
              onDelete={del("bolt")}
            />
          </TabsContent>
          <TabsContent value="weld">
            <RecordList<Row>
              rows={(welds.data ?? []) as Row[]}
              noun="Weld entry"
              editable={editable}
              minWidth={1040}
              empty={{ title: "No weld entries", body: "Log field welds with the welder, WPS, process, NDT and the inspector's result." }}
              columns={[
                { label: "Date", cell: r => fmtDate(r.logDate as string), className: "num" },
                ...common,
                { label: "Joint", cell: r => String(r.location) },
                { label: "Welder", cell: r => (r.welderName as string) || (r.welderUserId ? crewOpts.find(c => c.value === String(r.welderUserId))?.label : null) || "—" },
                { label: "WPS", cell: r => (r.wps as string) || "—" },
                { label: "Process", cell: r => lbl(WELD_PROCESSES, r.process as string) },
                { label: "NDT", cell: r => lbl(NDT_METHODS, r.ndt as string) },
                { label: "Result", cell: result },
              ]}
              rowActions={punchCell("weld")}
              fields={weldFields}
              blank={{ logDate: today(), taskId: blankSeq, process: "fcaw", ndt: "none", result: "pending" }}
              toDraft={toDraft}
              validate={d => need(d, "logDate", "location")}
              onSave={(d, row) => save("weld", weldInput(d))(d, row)}
              onDelete={del("weld")}
            />
          </TabsContent>
          <TabsContent value="inspection">
            <RecordList<Row>
              rows={(insp.data ?? []) as Row[]}
              noun="Inspection"
              editable={editable}
              minWidth={980}
              empty={{ title: "No special inspections", body: "Track each required special inspection per sequence — requested, scheduled, and the agency's result." }}
              columns={[
                { label: "Inspection", cell: r => lbl(SI_TYPES, r.type as string) },
                ...common,
                { label: "Agency", cell: r => (r.agency as string) || "—" },
                { label: "Requested", cell: r => fmtDate(r.requestedDate as string | null), className: "num" },
                { label: "Scheduled", cell: r => fmtDate(r.scheduledDate as string | null), className: "num" },
                { label: "Inspected", cell: r => fmtDate(r.inspectedDate as string | null), className: "num" },
                { label: "Report", cell: r => (r.reportNumber as string) || "—" },
                { label: "Result", cell: result },
              ]}
              rowActions={punchCell("inspection")}
              fields={siFields}
              blank={{ type: "bolting", taskId: blankSeq, requestedDate: today(), result: "requested" }}
              toDraft={toDraft}
              validate={d => need(d, "type")}
              onSave={(d, row) => save("inspection", siInput(d))(d, row)}
              onDelete={del("inspection")}
            />
          </TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}
