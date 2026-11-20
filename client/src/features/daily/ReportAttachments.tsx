import { useState } from "react";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ks/Layout";
import { errMsg, fileToBase64, fmtDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";

export function ReportAttachments({
  projectId,
  reportId,
  canUpload,
}: {
  projectId: number;
  reportId: number;
  canUpload: boolean;
}) {
  const input = { projectId, entityType: "dailyReport", entityId: reportId };
  const q = trpc.collab.documents.useQuery(input);
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const upload = trpc.collab.upload.useMutation();
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024)
          throw new Error("File is larger than 25 MB.");
        await upload.mutateAsync({
          ...input,
          entityType: "dailyReport",
          name: file.name,
          category: file.type.startsWith("image/") ? "photos" : "other",
          revision: "1",
          file: {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            base64: await fileToBase64(file),
          },
        });
      }
      await utils.collab.documents.invalidate(input);
      toast.success("Attachments uploaded.");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <p className="text-muted-foreground">No photos or attachments.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.map(doc => (
            <a
              key={doc.id}
              href={doc.latest?.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="overflow-hidden border border-[var(--ks-rule)] bg-[var(--ks-paper)]"
            >
              {doc.latest?.mimeType?.startsWith("image/") && (
                <img
                  src={doc.latest.url}
                  alt={doc.name}
                  loading="lazy"
                  className="h-32 w-full object-cover"
                />
              )}
              <div className="p-2">
                <div className="flex items-center gap-2 text-[var(--ks-accent-ink)]">
                  <Paperclip className="size-3.5" />
                  {doc.name}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Rev {doc.currentRevision} ·{" "}
                  {fmtDateTime(doc.latest?.uploadedAt)}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
      {canUpload && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild disabled={busy}>
            <label htmlFor={`report-files-${reportId}`}>
              {busy ? "Uploading…" : "Add photos / attachments"}
            </label>
          </Button>
          <Input
            id={`report-files-${reportId}`}
            type="file"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={e => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="text-xs text-muted-foreground">25 MB per file.</span>
        </div>
      )}
    </div>
  );
}
