import { useMemo, useState } from "react";
import { Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { JHA_STATUSES, jhaProblems, type Attendee, type JhaStatus, type JhaStep } from "@shared/safety";
import { ConfirmButton, RecordDrawer, SimpleSelect } from "@/components/brand/Controls";
import { EmptyState, ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Attendees, PpePicker, StepsEditor } from "@/features/safety/parts";
import { errMsg, fmtDate } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useJob } from "./JobContext";

const today = () => new Date().toLocaleDateString("en-CA");
const STATUS_TONE: Record<JhaStatus, "gray" | "green" | "amber"> = { draft: "amber", active: "green", archived: "gray" };
const PrintLink = ({ href }: { href: string }) => (
  <Button size="sm" variant="outline" asChild>
    <a href={href} target="_blank" rel="noreferrer"><Printer className="size-3.5" /> Print</a>
  </Button>
);

type Seq = { id: number; name: string };

/** Job tab: JHA/AHA, daily pre-task plans, toolbox talks, and the incident / near-miss log. */
export default function Safety() {
  const { projectId, can } = useJob();
  const editable = can("dailyreport.create");
  const tasks = trpc.tasks.list.useQuery({ projectId });
  const seqs = useMemo<Seq[]>(() => (tasks.data?.tasks ?? []).filter(t => !t.isSummary).map(t => ({ id: t.id, name: t.name })), [tasks.data]);
  return (
    <Panel title="Safety" bodyClassName="p-0">
      <Tabs defaultValue="jha">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="jha">JHA / AHA</TabsTrigger>
          <TabsTrigger value="ptp">Pre-task plans</TabsTrigger>
          <TabsTrigger value="talks">Toolbox talks</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
        </TabsList>
        <TabsContent value="jha"><Jhas projectId={projectId} seqs={seqs} editable={editable} /></TabsContent>
        <TabsContent value="ptp"><Ptps projectId={projectId} seqs={seqs} editable={editable} /></TabsContent>
        <TabsContent value="talks"><Talks projectId={projectId} editable={editable} /></TabsContent>
        <TabsContent value="incidents">
          <div className="space-y-3 p-4 text-sm">
            <p>Incidents, near misses, hazards and good catches are logged in the Safety log. Incidents record the injured person, treatment, OSHA recordable, days away and the date reported to the GC.</p>
            <Button size="sm" asChild><Link href={`/jobs/${projectId}/logs/safety`}>Open the Safety log</Link></Button>
          </div>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

const seqOptions = (seqs: Seq[]) => seqs.map(s => ({ value: String(s.id), label: s.name }));

function Jhas({ projectId, seqs, editable }: { projectId: number; seqs: Seq[]; editable: boolean }) {
  const q = trpc.safety.jhas.list.useQuery({ projectId });
  const utils = trpc.useUtils();
  type J = NonNullable<typeof q.data>[number];
  const [open, setOpen] = useState<J | "new" | null>(null);
  const done = { onSuccess: () => { void utils.safety.jhas.invalidate(); setOpen(null); }, onError: (e: unknown) => toast.error(errMsg(e)) };
  const create = trpc.safety.jhas.create.useMutation(done);
  const update = trpc.safety.jhas.update.useMutation(done);
  const remove = trpc.safety.jhas.remove.useMutation(done);
  const blank = { title: "", taskId: null as number | null, status: "draft" as JhaStatus, steps: [] as JhaStep[], ppe: ["hard_hat", "safety_glasses", "hi_vis", "gloves", "boots"], competentPerson: "", reviewedOn: today() };
  const [d, setD] = useState(blank);
  if (q.isLoading) return <Loading label="Loading JHAs…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const start = (j: J | "new") => {
    setOpen(j);
    setD(j === "new" ? blank : { title: j.title, taskId: j.taskId, status: j.status as JhaStatus, steps: j.steps, ppe: j.ppe, competentPerson: j.competentPerson ?? "", reviewedOn: j.reviewedOn ?? "" });
  };
  const problems = jhaProblems({ ...d, competentPerson: d.competentPerson || null });
  const save = () => {
    const input = { ...d, title: d.title.trim(), competentPerson: d.competentPerson.trim() || null, reviewedOn: d.reviewedOn || null, status: d.status as never };
    if (open === "new") create.mutate({ projectId, ...input });
    else if (open) update.mutate({ id: open.id, ...input });
  };
  const rows = q.data ?? [];
  return (
    <div>
      <div className="flex justify-end px-4 py-2">{editable && <Button size="sm" onClick={() => start("new")}><Plus className="size-3.5" /> JHA</Button>}</div>
      {!rows.length ? (
        <EmptyState title="No JHAs yet" body="Write a job hazard analysis for each activity — steps, hazards, controls, PPE and the competent person. Pre-task plans start from it." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead><tr><th>Activity</th><th>Sequence / task</th><th>Steps</th><th>Competent person</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(j => (
                <tr key={j.id} className="cursor-pointer" onClick={() => editable && start(j)}>
                  <td className="font-medium">{j.title}</td>
                  <td>{seqs.find(s => s.id === j.taskId)?.name ?? "—"}</td>
                  <td className="num">{j.steps.length}</td>
                  <td>{j.competentPerson || "—"}</td>
                  <td><Pill tone={STATUS_TONE[j.status as JhaStatus] ?? "gray"}>{JHA_STATUSES[j.status as JhaStatus] ?? j.status}</Pill></td>
                  <td className="right" onClick={e => e.stopPropagation()}><PrintLink href={`/print/jha/${j.id}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordDrawer
        open={open != null}
        onOpenChange={o => !o && setOpen(null)}
        eyebrow="JHA / AHA"
        title={open === "new" ? "New JHA" : d.title || "JHA"}
        width={860}
        footer={
          <div className="flex items-center justify-between gap-2">
            {open && open !== "new" ? <ConfirmButton destructive title="Delete this JHA?" confirmLabel="Delete" onConfirm={() => remove.mutate({ id: open.id })}>Delete</ConfirmButton> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
              <Button disabled={create.isPending || update.isPending} onClick={save}>Save</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Activity"><Input value={d.title} onChange={e => setD({ ...d, title: e.target.value })} placeholder="e.g. Setting joists, Level 2" /></Field>
            <Field label="Sequence / task"><SimpleSelect value={d.taskId == null ? null : String(d.taskId)} allowNone options={seqOptions(seqs)} onChange={v => setD({ ...d, taskId: v ? Number(v) : null })} /></Field>
            <Field label="Competent person"><Input value={d.competentPerson} onChange={e => setD({ ...d, competentPerson: e.target.value })} /></Field>
            <Field label="Reviewed on"><Input type="date" value={d.reviewedOn} onChange={e => setD({ ...d, reviewedOn: e.target.value })} /></Field>
            <Field label="Status"><SimpleSelect value={d.status} options={JHA_STATUSES} onChange={v => v && setD({ ...d, status: v as JhaStatus })} /></Field>
          </div>
          {d.status === "active" && problems.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-sm text-[var(--tp-red)]">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
          <Field label="Steps, hazards and controls"><StepsEditor steps={d.steps} onChange={steps => setD({ ...d, steps })} /></Field>
          <Field label="Required PPE"><PpePicker value={d.ppe} onChange={ppe => setD({ ...d, ppe })} /></Field>
        </div>
      </RecordDrawer>
    </div>
  );
}

function Ptps({ projectId, seqs, editable }: { projectId: number; seqs: Seq[]; editable: boolean }) {
  const q = trpc.safety.ptps.list.useQuery({ projectId });
  const jhaQ = trpc.safety.jhas.list.useQuery({ projectId });
  const { ref, userName } = useRefData();
  const utils = trpc.useUtils();
  type P = NonNullable<typeof q.data>[number];
  const [open, setOpen] = useState<P | "new" | null>(null);
  const done = { onSuccess: () => { void utils.safety.ptps.invalidate(); setOpen(null); }, onError: (e: unknown) => toast.error(errMsg(e)) };
  const create = trpc.safety.ptps.create.useMutation(done);
  const update = trpc.safety.ptps.update.useMutation(done);
  const remove = trpc.safety.ptps.remove.useMutation(done);
  const blank = { planDate: today(), foremanId: null as number | null, taskId: null as number | null, jhaId: null as number | null, workDescription: "", steps: [] as JhaStep[], ppe: [] as string[], attendees: [] as Attendee[] };
  const [d, setD] = useState(blank);
  if (q.isLoading) return <Loading label="Loading pre-task plans…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const jhaList = (jhaQ.data ?? []).filter(j => j.status === "active");
  const start = (p: P | "new") => {
    setOpen(p);
    setD(p === "new" ? blank : { planDate: p.planDate, foremanId: p.foremanId, taskId: p.taskId, jhaId: p.jhaId, workDescription: p.workDescription ?? "", steps: p.steps, ppe: p.ppe, attendees: p.attendees });
  };
  const fromJha = (id: number) => {
    const j = (jhaQ.data ?? []).find(x => x.id === id);
    if (j) setD({ ...d, jhaId: j.id, steps: j.steps, ppe: j.ppe, taskId: d.taskId ?? j.taskId });
  };
  const save = () => {
    const input = { ...d, workDescription: d.workDescription.trim() || null, ppe: d.ppe as never };
    if (open === "new") create.mutate({ projectId, ...input });
    else if (open) update.mutate({ id: open.id, ...input });
  };
  const rows = q.data ?? [];
  const foremen = (ref?.users ?? []).filter(u => u.isActive).map(u => ({ value: String(u.id), label: u.name ?? `#${u.id}` }));
  return (
    <div>
      <div className="flex justify-end px-4 py-2">{editable && <Button size="sm" onClick={() => start("new")}><Plus className="size-3.5" /> Pre-task plan</Button>}</div>
      {!rows.length ? (
        <EmptyState title="No pre-task plans yet" body="The foreman's daily plan: today's work, its hazards and controls, PPE, and the crew's sign-in. Start one from an active JHA." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead><tr><th>Date</th><th>Foreman</th><th>Sequence / task</th><th>Work</th><th className="right">Crew</th><th /></tr></thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="cursor-pointer" onClick={() => editable && start(p)}>
                  <td className="num">{fmtDate(p.planDate)}</td>
                  <td>{p.foremanId ? userName(p.foremanId) : "—"}</td>
                  <td>{seqs.find(s => s.id === p.taskId)?.name ?? "—"}</td>
                  <td className="max-w-md truncate">{p.workDescription || "—"}</td>
                  <td className="right num">{p.attendees.length}</td>
                  <td className="right" onClick={e => e.stopPropagation()}><PrintLink href={`/print/ptp/${p.id}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordDrawer
        open={open != null}
        onOpenChange={o => !o && setOpen(null)}
        eyebrow="Pre-task plan"
        title={open === "new" ? "New pre-task plan" : `Pre-task plan ${fmtDate(d.planDate)}`}
        width={860}
        footer={
          <div className="flex items-center justify-between gap-2">
            {open && open !== "new" ? <ConfirmButton destructive title="Delete this pre-task plan?" confirmLabel="Delete" onConfirm={() => remove.mutate({ id: open.id })}>Delete</ConfirmButton> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
              <Button disabled={create.isPending || update.isPending || !d.planDate} onClick={save}>Save</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date"><Input type="date" value={d.planDate} onChange={e => setD({ ...d, planDate: e.target.value })} /></Field>
            <Field label="Foreman"><SimpleSelect value={d.foremanId == null ? null : String(d.foremanId)} allowNone options={foremen} onChange={v => setD({ ...d, foremanId: v ? Number(v) : null })} /></Field>
            <Field label="Sequence / task"><SimpleSelect value={d.taskId == null ? null : String(d.taskId)} allowNone options={seqOptions(seqs)} onChange={v => setD({ ...d, taskId: v ? Number(v) : null })} /></Field>
            <Field label="Start from JHA">
              <SimpleSelect value={d.jhaId == null ? null : String(d.jhaId)} allowNone placeholder={jhaList.length ? "Pick an active JHA…" : "No active JHAs"} options={jhaList.map(j => ({ value: String(j.id), label: j.title }))} onChange={v => v && fromJha(Number(v))} />
            </Field>
          </div>
          <Field label="Today's work"><Textarea rows={2} value={d.workDescription} onChange={e => setD({ ...d, workDescription: e.target.value })} /></Field>
          <Field label="Steps, hazards and controls"><StepsEditor steps={d.steps} onChange={steps => setD({ ...d, steps })} /></Field>
          <Field label="PPE"><PpePicker value={d.ppe} onChange={ppe => setD({ ...d, ppe })} /></Field>
          <Field label="Crew sign-in"><Attendees value={d.attendees} onChange={attendees => setD({ ...d, attendees })} /></Field>
        </div>
      </RecordDrawer>
    </div>
  );
}

function Talks({ projectId, editable }: { projectId: number; editable: boolean }) {
  const q = trpc.safety.talks.list.useQuery({ projectId });
  const utils = trpc.useUtils();
  type T = NonNullable<typeof q.data>[number];
  const [open, setOpen] = useState<T | "new" | null>(null);
  const done = { onSuccess: () => { void utils.safety.talks.invalidate(); setOpen(null); }, onError: (e: unknown) => toast.error(errMsg(e)) };
  const create = trpc.safety.talks.create.useMutation(done);
  const update = trpc.safety.talks.update.useMutation(done);
  const remove = trpc.safety.talks.remove.useMutation(done);
  const blank = { talkDate: today(), topic: "", presenter: "", notes: "", attendees: [] as Attendee[] };
  const [d, setD] = useState(blank);
  if (q.isLoading) return <Loading label="Loading toolbox talks…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const start = (t: T | "new") => {
    setOpen(t);
    setD(t === "new" ? blank : { talkDate: t.talkDate, topic: t.topic, presenter: t.presenter ?? "", notes: t.notes ?? "", attendees: t.attendees });
  };
  const save = () => {
    const input = { talkDate: d.talkDate, topic: d.topic.trim(), presenter: d.presenter.trim() || null, notes: d.notes.trim() || null, attendees: d.attendees };
    if (open === "new") create.mutate({ projectId, ...input });
    else if (open) update.mutate({ id: open.id, ...input });
  };
  const rows = q.data ?? [];
  return (
    <div>
      <div className="flex justify-end px-4 py-2">{editable && <Button size="sm" onClick={() => start("new")}><Plus className="size-3.5" /> Toolbox talk</Button>}</div>
      {!rows.length ? (
        <EmptyState title="No toolbox talks yet" body="Record each talk's topic, presenter and who attended, then print the sign-in sheet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead><tr><th>Date</th><th>Topic</th><th>Presenter</th><th className="right">Attendees</th><th /></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} className="cursor-pointer" onClick={() => editable && start(t)}>
                  <td className="num">{fmtDate(t.talkDate)}</td>
                  <td className="font-medium">{t.topic}</td>
                  <td>{t.presenter || "—"}</td>
                  <td className="right num">{t.attendees.length}</td>
                  <td className="right" onClick={e => e.stopPropagation()}><PrintLink href={`/print/toolbox/${t.id}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordDrawer
        open={open != null}
        onOpenChange={o => !o && setOpen(null)}
        eyebrow="Toolbox talk"
        title={open === "new" ? "New toolbox talk" : d.topic || "Toolbox talk"}
        footer={
          <div className="flex items-center justify-between gap-2">
            {open && open !== "new" ? <ConfirmButton destructive title="Delete this toolbox talk?" confirmLabel="Delete" onConfirm={() => remove.mutate({ id: open.id })}>Delete</ConfirmButton> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
              <Button disabled={create.isPending || update.isPending || !d.topic.trim() || !d.talkDate} onClick={save}>Save</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date"><Input type="date" value={d.talkDate} onChange={e => setD({ ...d, talkDate: e.target.value })} /></Field>
            <Field label="Presenter"><Input value={d.presenter} onChange={e => setD({ ...d, presenter: e.target.value })} /></Field>
          </div>
          <Field label="Topic"><Input value={d.topic} onChange={e => setD({ ...d, topic: e.target.value })} placeholder="e.g. 100% tie-off on decking" /></Field>
          <Field label="Notes"><Textarea rows={3} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} /></Field>
          <Field label="Attendees"><Attendees value={d.attendees} onChange={attendees => setD({ ...d, attendees })} /></Field>
        </div>
      </RecordDrawer>
    </div>
  );
}
