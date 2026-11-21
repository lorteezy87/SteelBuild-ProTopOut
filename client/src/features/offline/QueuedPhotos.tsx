import { Camera } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePhotoUpload } from "@/features/photos/RecordPhotos";
import { useSyncState } from "./sync";

/** Photos for a report that exists only on this device: kept here and attached to the report once it syncs. */
export function QueuedPhotos({ projectId, parentKey, canUpload }: { projectId: number; parentKey: string; canUpload: boolean }) {
  const { run, busy } = usePhotoUpload(projectId);
  const waiting = useSyncState().items.filter(i => i.kind === "photoUpload" && i.dependsOn === parentKey);
  return (
    <div className="space-y-2 text-sm">
      {canUpload && (
        <label className="flex items-center gap-2">
          <Camera className="size-4" />
          <Input type="file" accept="image/*" multiple aria-label="Add photos" disabled={busy} onChange={e => void run(e.target.files, { parentKey })} />
        </label>
      )}
      {waiting.length ? (
        <ul className="space-y-1 text-xs">
          {waiting.map(i => (
            <li key={i.id}>
              {i.label} — {i.status === "failed" ? `not uploaded: ${i.error}` : "on this device, uploads after the report syncs"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No photos yet. Photos added here wait on this device and attach to the report when it syncs.</p>
      )}
    </div>
  );
}
