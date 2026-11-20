import { useMemo, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { RecordDrawer, SimpleSelect } from "@/components/brand/Controls";
import { EmptyState, ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { photoDayLabel, usePhotoUpload, type Photo } from "@/features/photos/RecordPhotos";
import { errMsg, fmtDate } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useJob } from "./JobContext";

/** Job tab: every photo on the job, by day, with caption, date and sequence; upload here or from any record. */
export default function Photos() {
  const { projectId, can } = useJob();
  const editable = can("document.upload");
  const { today } = useRefData();
  const tasks = trpc.tasks.list.useQuery({ projectId });
  const seqs = useMemo(() => (tasks.data?.tasks ?? []).filter(t => t.kind === "sequence" && !t.isSummary), [tasks.data]);
  const seqOpts = seqs.map(s => ({ value: String(s.id), label: s.name }));
  const [seq, setSeq] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = trpc.photos.list.useQuery({ projectId, ...(seq ? { sequenceTaskId: Number(seq) } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { run, busy } = usePhotoUpload(projectId);
  const [meta, setMeta] = useState({ caption: "", takenOn: today, sequenceTaskId: null as string | null });
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<Photo | null>(null);
  const [edit, setEdit] = useState({ caption: "", takenOn: "", sequenceTaskId: null as string | null });
  const utils = trpc.useUtils();
  const update = trpc.photos.update.useMutation({
    onSuccess: async () => {
      await utils.photos.invalidate();
      setEditing(null);
    },
    onError: e => toast.error(errMsg(e)),
  });
  const groups = useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of q.data ?? []) m.set(p.day, [...(m.get(p.day) ?? []), p]);
    return [...m.entries()];
  }, [q.data]);
  const seqName = (id: number | null) => (id ? seqs.find(s => s.id === id)?.name ?? null : null);
  const attachedTo = (p: Photo) => {
    const all = [...(p.owner ? [p.owner] : []), ...p.links];
    const names: Record<string, string> = { dailyReport: "Daily report", logItem: "Log item", tmTicket: "T&M ticket", task: "Task", delivery: "Delivery" };
    return all.length ? all.map(e => names[e.entityType] ?? e.entityType).join(", ") : null;
  };
  return (
    <div className="space-y-4">
      {editable && (
        <Panel title="Add photos" bodyClassName="space-y-3 p-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Photos">
              <Input type="file" accept="image/*" multiple aria-label="Photo files" onChange={e => setFiles(Array.from(e.target.files ?? []))} />
            </Field>
            <Field label="Caption (applies to all)"><Input value={meta.caption} maxLength={500} onChange={e => setMeta({ ...meta, caption: e.target.value })} placeholder="e.g. Column splice C/4 L2" /></Field>
            <Field label="Taken on"><Input type="date" value={meta.takenOn} onChange={e => setMeta({ ...meta, takenOn: e.target.value })} /></Field>
            <Field label="Sequence"><SimpleSelect value={meta.sequenceTaskId} allowNone options={seqOpts} onChange={v => setMeta({ ...meta, sequenceTaskId: v })} /></Field>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!files.length || busy}
              onClick={async () => {
                await run(files, { caption: meta.caption, takenOn: meta.takenOn || null, sequenceTaskId: meta.sequenceTaskId ? Number(meta.sequenceTaskId) : null });
                setFiles([]);
                setMeta(m => ({ ...m, caption: "" }));
              }}
            >
              <Camera className="size-3.5" /> {busy ? "Uploading…" : `Upload ${files.length || ""}`}
            </Button>
            <span className="text-xs text-muted-foreground">Leave "Taken on" blank if you don't know it — the photo files under its upload day, marked "uploaded".</span>
          </div>
        </Panel>
      )}
      <Panel
        title="Photo log"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-52"><SimpleSelect value={seq} allowNone noneLabel="All sequences" options={seqOpts} onChange={setSeq} /></div>
            <Input type="date" aria-label="From" className="h-8 w-36" value={from} onChange={e => setFrom(e.target.value)} />
            <Input type="date" aria-label="To" className="h-8 w-36" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        }
        bodyClassName="p-3"
      >
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : !groups.length ? (
          <EmptyState title="No photos" body="Upload site photos here, or from a daily report, log item or T&M ticket. Each photo keeps its caption, date and sequence." />
        ) : (
          <div className="space-y-5">
            {groups.map(([day, photos]) => (
              <section key={day}>
                <h3 className="label-caps mb-2">{fmtDate(day, { year: true })}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {photos.map(p => (
                    <figure key={p.id} className="overflow-hidden border border-[var(--tp-rule)] bg-[var(--tp-paper)]">
                      <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || p.name} loading="lazy" className="h-36 w-full object-cover" /></a>
                      <figcaption className="space-y-0.5 p-2 text-xs">
                        <div className="truncate font-medium">{p.caption || p.name}</div>
                        <div className="text-muted-foreground">{photoDayLabel(p)}{seqName(p.sequenceTaskId) ? ` · ${seqName(p.sequenceTaskId)}` : ""}</div>
                        {attachedTo(p) && <div className="truncate text-muted-foreground">On: {attachedTo(p)}</div>}
                        {editable && (
                          <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => { setEditing(p); setEdit({ caption: p.caption ?? "", takenOn: p.takenOn ?? "", sequenceTaskId: p.sequenceTaskId ? String(p.sequenceTaskId) : null }); }}>
                            Edit
                          </Button>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
      <RecordDrawer
        open={editing != null}
        onOpenChange={o => !o && setEditing(null)}
        eyebrow="Photo"
        title={editing?.caption || editing?.name || "Photo"}
        width={520}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={update.isPending}
              onClick={() => editing && update.mutate({ id: editing.id, caption: edit.caption.trim() || null, takenOn: edit.takenOn || null, sequenceTaskId: edit.sequenceTaskId ? Number(edit.sequenceTaskId) : null })}
            >
              Save
            </Button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-4">
            <img src={editing.url} alt="" className="max-h-64 w-full border object-contain" />
            <Field label="Caption"><Input value={edit.caption} maxLength={500} onChange={e => setEdit({ ...edit, caption: e.target.value })} /></Field>
            <Field label="Taken on"><Input type="date" value={edit.takenOn} onChange={e => setEdit({ ...edit, takenOn: e.target.value })} /></Field>
            <Field label="Sequence"><SimpleSelect value={edit.sequenceTaskId} allowNone options={seqOpts} onChange={v => setEdit({ ...edit, sequenceTaskId: v })} /></Field>
          </div>
        )}
      </RecordDrawer>
    </div>
  );
}
