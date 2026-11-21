import { useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import type { PhotoEntity } from "@shared/photos";
import { RecordDrawer } from "@/components/brand/Controls";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { errMsg, fileToBase64, fmtDate } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { uploadPhoto } from "@/features/offline/sync";

export type Photo = RouterOutputs["photos"]["list"][number];

/** Day a photo belongs to; an undated one says it is the upload day, never that it was taken then. */
export const photoDayLabel = (p: Pick<Photo, "day" | "estimated">) => (p.estimated ? `uploaded ${fmtDate(p.day)}` : fmtDate(p.day));

/** Upload photos to the job's photo log, optionally owned by a record. */
export function usePhotoUpload(projectId: number) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const run = async (files: FileList | File[] | null, meta: { caption?: string | null; takenOn?: string | null; sequenceTaskId?: number | null; entityType?: PhotoEntity; entityId?: number; parentKey?: string | null }) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusy(true);
    let queued = 0;
    let sent = 0;
    try {
      for (const file of list) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`);
        const r = await uploadPhoto({
          projectId,
          name: file.name,
          category: "photos",
          revision: "1",
          caption: meta.caption?.trim() || null,
          takenOn: meta.takenOn || null,
          sequenceTaskId: meta.sequenceTaskId ?? null,
          ...(meta.entityType && meta.entityId ? { entityType: meta.entityType, entityId: meta.entityId } : {}),
          file: { fileName: file.name, mimeType: file.type || "application/octet-stream", base64: await fileToBase64(file) },
        }, { parentKey: meta.parentKey ?? null, label: file.name });
        if (r.queued) queued++;
        else sent++;
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      // Refresh even after a partial failure, so the photos that did upload show up.
      if (sent) await Promise.all([utils.photos.invalidate(), utils.collab.documents.invalidate()]);
      if (sent) toast.success(sent === 1 ? "Photo added" : `${sent} photos added`);
      if (queued) toast.warning(`${queued === 1 ? "Photo" : `${queued} photos`} saved on this device — will upload when you're back online.`);
      setBusy(false);
    }
  };
  return { run, busy };
}

export function PhotoTile({ p, onRemove }: { p: Photo; onRemove?: () => void }) {
  return (
    <figure className="relative overflow-hidden border border-[var(--tp-rule)] bg-[var(--tp-paper)]">
      <a href={p.url} target="_blank" rel="noreferrer">
        <img src={p.url} alt={p.caption || p.name} loading="lazy" className="h-32 w-full object-cover" />
      </a>
      <figcaption className="p-2 text-xs">
        <div className="truncate font-medium">{p.caption || p.name}</div>
        <div className="text-muted-foreground">{photoDayLabel(p)}</div>
      </figcaption>
      {onRemove && (
        <Button size="icon" variant="secondary" className="absolute right-1 top-1 size-7" aria-label="Detach photo" onClick={onRemove}>
          <X className="size-3.5" />
        </Button>
      )}
    </figure>
  );
}

/** Pick photos already in the job's photo log and attach them to a record. */
export function AttachPhotos({ projectId, entityType, entityId, onClose }: { projectId: number; entityType: PhotoEntity; entityId: number; onClose: () => void }) {
  const all = trpc.photos.list.useQuery({ projectId });
  const mine = trpc.photos.list.useQuery({ projectId, entityType, entityId });
  const utils = trpc.useUtils();
  const attach = trpc.photos.attach.useMutation({
    onSuccess: async () => {
      await utils.photos.invalidate();
      toast.success("Photos attached");
      onClose();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const [picked, setPicked] = useState<number[]>([]);
  const have = new Set((mine.data ?? []).map(p => p.id));
  const choices = (all.data ?? []).filter(p => !have.has(p.id));
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      eyebrow="Photo log"
      title="Add photos from the photo log"
      width={760}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked.length || attach.isPending} onClick={() => attach.mutate({ projectId, documentIds: picked, entityType, entityId })}>
            Attach {picked.length || ""}
          </Button>
        </div>
      }
    >
      {all.isLoading ? <Loading /> : all.error ? <ErrorState error={all.error} /> : !choices.length ? (
        <p className="text-sm text-muted-foreground">No other photos on this job yet. Upload them on the Photos tab.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {choices.map(p => (
            <label key={p.id} className="cursor-pointer">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <Checkbox checked={picked.includes(p.id)} onCheckedChange={v => setPicked(v === true ? [...picked, p.id] : picked.filter(x => x !== p.id))} />
                {photoDayLabel(p)}
              </div>
              <img src={p.url} alt={p.caption || p.name} loading="lazy" className="h-28 w-full border object-cover" />
              <div className="truncate text-xs">{p.caption || p.name}</div>
            </label>
          ))}
        </div>
      )}
    </RecordDrawer>
  );
}

/** Photos strip on a daily report, log item or T&M ticket: uploaded to it, or attached from the photo log. */
export function RecordPhotos({ projectId, entityType, entityId, canUpload }: { projectId: number; entityType: PhotoEntity; entityId: number; canUpload: boolean }) {
  const q = trpc.photos.list.useQuery({ projectId, entityType, entityId });
  const { run, busy } = usePhotoUpload(projectId);
  const utils = trpc.useUtils();
  const detach = trpc.photos.detach.useMutation({ onSuccess: () => utils.photos.invalidate(), onError: e => toast.error(errMsg(e)) });
  const [picking, setPicking] = useState(false);
  const id = `photos-${entityType}-${entityId}`;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = q.data ?? [];
  const isLinkOnly = (p: Photo) => !(p.owner?.entityType === entityType && p.owner?.entityId === entityId);
  return (
    <div className="space-y-3">
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">No photos.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rows.map(p => (
            <PhotoTile key={p.id} p={p} onRemove={canUpload && isLinkOnly(p) ? () => detach.mutate({ documentId: p.id, entityType, entityId }) : undefined} />
          ))}
        </div>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" asChild disabled={busy}>
            <label htmlFor={id}><Camera className="size-3.5" /> {busy ? "Uploading…" : "Upload photos"}</label>
          </Button>
          <Input
            id={id}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={e => {
              // No date field here, so the taken date stays unknown (shown as the upload day) rather than assumed.
              void run(e.target.files, { takenOn: null, entityType, entityId });
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}><ImagePlus className="size-3.5" /> Add from photo log</Button>
        </div>
      )}
      {picking && <AttachPhotos projectId={projectId} entityType={entityType} entityId={entityId} onClose={() => setPicking(false)} />}
    </div>
  );
}
