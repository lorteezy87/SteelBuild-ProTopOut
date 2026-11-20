import { useEffect, useState } from "react";
import {
  Upload,
  FileText,
  ExternalLink,
  Download,
  Trash2,
  History,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { errMsg, fileToBase64, fmtDateTime, fmtNum } from "@/lib/format";
import { DOCUMENT_CATEGORIES } from "@shared/domain";
import { useJob, useSearchParam } from "./JobContext";
import {
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/brand/Layout";
import {
  RecordDrawer,
  SimpleSelect,
  ConfirmButton,
} from "@/components/brand/Controls";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const MAX_BYTES = 25 * 1024 * 1024;
const categoryLabel = (key: string) =>
  DOCUMENT_CATEGORIES[key as keyof typeof DOCUMENT_CATEGORIES] ?? key;
const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${fmtNum(bytes / (1024 * 1024), 1)} MB`
    : `${fmtNum(bytes / 1024, 1)} KB`;
export default function Documents() {
  const { projectId, can } = useJob();
  const utils = trpc.useUtils();
  const documentParam = useSearchParam("document");
  const docParam = useSearchParam("doc");
  const deepLink = docParam ?? documentParam;
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"detail" | "new" | "revision" | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [sheet, setSheet] = useState("");
  const [revision, setRevision] = useState("0");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  useEffect(() => {
    const id = deepLink ? Number(deepLink) : null;
    const validId = id != null && Number.isSafeInteger(id) && id > 0 ? id : null;
    setSelected(validId);
    setMode(validId ? "detail" : null);
    setEditingMeta(false);
    setFile(null);
  }, [deepLink, projectId]);
  const q = trpc.collab.documents.useQuery({ projectId });
  const doc = q.data?.find(d => d.id === selected);
  const allowed = can("document.upload");
  const invalidate = async () => {
    await Promise.all([
      utils.collab.documents.invalidate({ projectId }),
      utils.collab.activity.invalidate({ projectId }),
      utils.projects.get.invalidate({ id: projectId }),
    ]);
  };
  const upload = trpc.collab.upload.useMutation({
    onSuccess: async r => {
      await invalidate();
      setSelected(r.id);
      setMode("detail");
      setFile(null);
      setEditingMeta(false);
      toast.success("Document uploaded");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const update = trpc.collab.updateDocument.useMutation({
    onSuccess: async () => {
      await invalidate();
      setEditingMeta(false);
      toast.success("Document updated");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.collab.removeDocument.useMutation({
    onSuccess: async () => {
      await invalidate();
      setMode(null);
      setSelected(null);
      toast.success("Document removed");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const openNew = () => {
    setSelected(null);
    setName("");
    setCategory(categoryFilter ?? "other");
    setSheet("");
    setRevision("0");
    setNotes("");
    setFile(null);
    setMode("new");
    setEditingMeta(false);
  };
  const openDocument = (id: number) => {
    setSelected(id);
    setMode("detail");
    setEditingMeta(false);
  };
  const startRevision = () => {
    if (!doc) return;
    setName(doc.name);
    setCategory(doc.category);
    setSheet(doc.sheetNumber ?? "");
    setRevision("");
    setNotes("");
    setFile(null);
    setMode("revision");
  };
  const submitUpload = async () => {
    if (!file || !revision.trim() || (mode === "new" && !name.trim())) return;
    if (file.size > MAX_BYTES) {
      toast.error("File is larger than 25 MB");
      return;
    }
    if (
      mode === "revision" &&
      doc?.versions.some(v => v.revision === revision.trim())
    ) {
      toast.error("This revision already exists. Use the next revision.");
      return;
    }
    let base64: string;
    setReading(true);
    try {
      base64 = await fileToBase64(file);
    } catch (e) {
      toast.error(errMsg(e));
      setReading(false);
      return;
    }
    try {
      await upload.mutateAsync({
        projectId,
        documentId: mode === "revision" ? (selected ?? undefined) : undefined,
        name: name.trim(),
        category,
        sheetNumber: sheet.trim() || null,
        revision: revision.trim(),
        notes: notes.trim() || null,
        file: {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
        },
      });
    } catch {
      // The mutation onError already reports server failures.
    } finally {
      setReading(false);
    }
  };
  const rows = (q.data ?? []).filter(
    d =>
      (!categoryFilter || d.category === categoryFilter) &&
      `${d.name} ${d.sheetNumber ?? ""} ${d.latest?.fileName ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const categories = [...new Set(rows.map(d => d.category))];
  const busy = reading || upload.isPending;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Job documents</h2>
          <p className="text-xs text-muted-foreground">
            Current revisions on top. Older files are retained.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Name or sheet #…"
            aria-label="Search documents"
            className="w-52 bg-[var(--tp-paper)]"
          />
          <div className="w-48">
            <SimpleSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              allowNone
              noneLabel="All categories"
              options={DOCUMENT_CATEGORIES}
            />
          </div>
          {allowed && (
            <Button size="sm" onClick={openNew}>
              <Upload className="size-3.5" />
              Upload document
            </Button>
          )}
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !rows.length ? (
        <Panel>
          <EmptyState
            icon={<FileText className="size-6" />}
            title="No documents in this view"
            body={
              allowed
                ? "Upload drawings, delivery tickets, photos or correspondence. Maximum 25 MB per file."
                : "Try another category or ask the job team to upload documents."
            }
            action={
              allowed && (
                <Button size="sm" onClick={openNew}>
                  Upload document
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        categories.map(cat => (
          <Panel
            key={cat}
            title={`${categoryLabel(cat)} / ${rows.filter(d => d.category === cat).length}`}
          >
            <div className="overflow-auto">
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Name / sheet #</th>
                    <th>Revision</th>
                    <th>Uploaded by</th>
                    <th>Uploaded at</th>
                    <th className="text-right">Size</th>
                    <th className="text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter(d => d.category === cat)
                    .map(d => (
                      <tr
                        key={d.id}
                        className="cursor-pointer"
                        onClick={() => openDocument(d.id)}
                      >
                        <td>
                          <button
                            onClick={() => openDocument(d.id)}
                            className="text-left font-medium hover:underline"
                          >
                            {d.name}
                          </button>
                          <div className="num text-xs text-muted-foreground">
                            {d.sheetNumber || "No sheet #"}
                          </div>
                        </td>
                        <td>
                          <Pill>Rev {d.currentRevision || "—"}</Pill>
                          <span className="num ml-2 text-xs text-muted-foreground">
                            {d.versions.length} versions
                          </span>
                        </td>
                        <td>{d.latest?.uploaderName ?? "—"}</td>
                        <td className="num text-xs">
                          {fmtDateTime(d.latest?.uploadedAt)}
                        </td>
                        <td className="right num">
                          {d.latest ? sizeLabel(d.latest.size) : "—"}
                        </td>
                        <td className="right">
                          {d.latest && (
                            <a
                              href={d.latest.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              aria-label={`Open ${d.name}`}
                              className="inline-flex p-1 hover:text-[var(--tp-accent-ink)]"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}
      <RecordDrawer
        width={760}
        open={!!mode}
        onOpenChange={open => {
          if (!open && !busy) {
            setMode(null);
            setFile(null);
          }
        }}
        eyebrow={
          mode === "detail"
            ? `${categoryLabel(doc?.category ?? "other")} / document`
            : "Document / upload"
        }
        title={
          mode === "new"
            ? "Upload document"
            : mode === "revision"
              ? `New revision / ${doc?.name ?? "document"}`
              : (doc?.name ?? "Document")
        }
        actions={
          mode === "detail" &&
          doc && (
            <>
              {doc.latest && (
                <a
                  href={doc.latest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" variant="outline">
                    <ExternalLink className="size-3.5" />
                    Open current
                  </Button>
                </a>
              )}
              {allowed && (
                <>
                  <Button size="sm" variant="outline" onClick={startRevision}>
                    <History className="size-3.5" />
                    New revision
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setName(doc.name);
                      setCategory(doc.category);
                      setSheet(doc.sheetNumber ?? "");
                      setEditingMeta(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Edit metadata
                  </Button>
                  <ConfirmButton
                    title={`Remove ${doc.name}?`}
                    body="The document and its revision history will be removed from the job document list."
                    destructive
                    confirmLabel="Remove"
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate({ id: doc.id })}
                  >
                    <Trash2 className="size-3.5" />
                  </ConfirmButton>
                </>
              )}
            </>
          )
        }
        footer={
          mode === "new" || mode === "revision" ? (
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                Maximum 25 MB · revisions are retained
              </span>
              <Button
                size="sm"
                disabled={
                  !file || !revision.trim() || !name.trim() || busy || !allowed
                }
                onClick={() => void submitUpload()}
              >
                <Upload className="size-3.5" />
                {busy ? "Uploading…" : "Upload"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {mode === "detail" ? (
          doc ? (
            <div className="space-y-5">
              {editingMeta && allowed && (
                <Panel title="Metadata" bodyClassName="space-y-3 p-3">
                  <Field label="Name">
                    <Input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      maxLength={255}
                      className="bg-[var(--tp-paper)]"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Category">
                      <SimpleSelect
                        value={category}
                        onChange={v => setCategory(v ?? "other")}
                        options={DOCUMENT_CATEGORIES}
                      />
                    </Field>
                    <Field label="Sheet #">
                      <Input
                        value={sheet}
                        onChange={e => setSheet(e.target.value)}
                        maxLength={64}
                        className="bg-[var(--tp-paper)]"
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingMeta(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!name.trim() || update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: doc.id,
                          name: name.trim(),
                          category,
                          sheetNumber: sheet.trim() || null,
                        })
                      }
                    >
                      Save metadata
                    </Button>
                  </div>
                </Panel>
              )}
              <div className="grid grid-cols-3 gap-4">
                <Field label="Sheet #">
                  <span className="num">{doc.sheetNumber || "—"}</span>
                </Field>
                <Field label="Current revision">
                  <span className="num">{doc.currentRevision ?? "—"}</span>
                </Field>
                <Field label="Versions">
                  <span className="num">{doc.versions.length}</span>
                </Field>
              </div>
              <Panel title="Revision history">
                <div className="overflow-auto">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>Revision / file</th>
                        <th>Uploaded</th>
                        <th className="text-right">Size</th>
                        <th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.versions.map((v, i) => (
                        <tr key={v.id}>
                          <td>
                            <div className="flex items-center gap-2">
                              <strong className="num">{v.revision}</strong>
                              {i === 0 && <Pill>Current</Pill>}
                            </div>
                            <div className="text-xs">{v.fileName}</div>
                            {v.notes && (
                              <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                                {v.notes}
                              </div>
                            )}
                          </td>
                          <td>
                            {v.uploaderName ?? "—"}
                            <div className="num text-xs text-muted-foreground">
                              {fmtDateTime(v.uploadedAt)}
                            </div>
                          </td>
                          <td className="right num whitespace-nowrap">
                            {sizeLabel(v.size)}
                          </td>
                          <td>
                            <a
                              href={v.url}
                              download={v.fileName}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Download revision ${v.revision}`}
                              className="inline-flex p-1 hover:text-[var(--tp-accent-ink)]"
                            >
                              <Download className="size-4" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          ) : (
            <EmptyState
              title="Document not available"
              body="It may have been removed from this job."
            />
          )
        ) : (
          <div className="space-y-4">
            <Field label="Document name">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={mode === "revision"}
                maxLength={255}
                autoFocus
                className="bg-[var(--tp-paper)]"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <SimpleSelect
                  value={category}
                  onChange={v => setCategory(v ?? "other")}
                  options={DOCUMENT_CATEGORIES}
                />
              </Field>
              <Field label="Sheet #">
                <Input
                  value={sheet}
                  onChange={e => setSheet(e.target.value)}
                  maxLength={64}
                  className="bg-[var(--tp-paper)]"
                />
              </Field>
              <Field label="Revision">
                <Input
                  value={revision}
                  onChange={e => setRevision(e.target.value)}
                  maxLength={16}
                  placeholder="e.g. 0, A, B"
                  className="num bg-[var(--tp-paper)]"
                />
              </Field>
            </div>
            <Field label="File / max 25 MB">
              <Input
                type="file"
                disabled={busy}
                onChange={e => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > MAX_BYTES) {
                    toast.error("File is larger than 25 MB");
                    e.target.value = "";
                    setFile(null);
                    return;
                  }
                  setFile(f);
                  if (f && mode === "new" && !name)
                    setName(f.name.replace(/\.[^.]+$/, ""));
                }}
                className="bg-[var(--tp-paper)]"
              />
              {file && (
                <div className="num mt-1 text-xs text-muted-foreground">
                  {sizeLabel(file.size)}
                </div>
              )}
            </Field>
            <Field label="Revision notes">
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
                className="bg-[var(--tp-paper)]"
              />
            </Field>
            {mode === "revision" && (
              <p className="text-xs text-muted-foreground">
                Existing revisions:{" "}
                {doc?.versions.map(v => v.revision).join(", ") || "none"}. Use a
                new revision label; previous files stay available.
              </p>
            )}
          </div>
        )}
      </RecordDrawer>
    </div>
  );
}
