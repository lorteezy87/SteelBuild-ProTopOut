import { useRef, useState } from "react";
import { Paperclip, Printer } from "lucide-react";
import { toast } from "sonner";
import { CERT_STATUS_LABEL, CERT_TYPE_LABELS, certTypeLabel, type CertStatus } from "@shared/certs";
import { ErrorState, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nullableText, text, type Draft } from "@/features/admin/Editor";
import { RecordList } from "@/features/records/RecordList";
import { errMsg, fmtDate } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";

type Cert = RouterOutputs["certs"]["list"][number];
export const CERT_TONE: Record<CertStatus | "missing", "green" | "amber" | "red" | "gray"> = { current: "green", no_expiry: "green", expiring: "amber", unknown: "amber", expired: "red", missing: "red" };
export const certStatusText = (s: CertStatus | "missing", date: string | null) =>
  s === "missing" ? "Missing" : CERT_STATUS_LABEL[s].replace("{date}", fmtDate(date));

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

function CardUpload({ cert }: { cert: Cert }) {
  const input = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const up = trpc.certs.upload.useMutation({ onSuccess: () => { toast.success("Card attached"); void utils.certs.invalidate(); }, onError: e => toast.error(errMsg(e)) });
  return (
    <div className="flex items-center gap-2 text-sm">
      {cert.fileUrl && <a className="text-[var(--tp-accent-ink)] underline" href={cert.fileUrl} target="_blank" rel="noreferrer">{cert.fileName ?? "View card"}</a>}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0];
          if (!f) return;
          up.mutate({ id: cert.id, file: { fileName: f.name, mimeType: f.type || "application/octet-stream", base64: await toBase64(f) } });
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" disabled={up.isPending} onClick={() => input.current?.click()}>
        <Paperclip className="size-3.5" /> {cert.fileUrl ? "Replace card" : "Attach card"}
      </Button>
    </div>
  );
}

/** Settings: crew certifications — the matrix for a glance, the list to edit and attach cards. */
export default function Certifications() {
  const list = trpc.certs.list.useQuery();
  const matrix = trpc.certs.matrix.useQuery();
  const { ref } = useRefData();
  const utils = trpc.useUtils();
  const [who, setWho] = useState<string | null>(null);
  const opts = { onSuccess: () => utils.certs.invalidate() };
  const create = trpc.certs.create.useMutation(opts);
  const update = trpc.certs.update.useMutation(opts);
  const remove = trpc.certs.remove.useMutation(opts);
  if (list.isLoading || matrix.isLoading) return <Loading label="Loading certifications…" />;
  if (list.error || matrix.error) return <ErrorState error={(list.error || matrix.error)!} />;
  const crew = (ref?.users ?? []).filter(u => u.isActive).map(u => ({ value: String(u.id), label: u.name ?? `#${u.id}` }));
  const m = matrix.data!;
  const usedTypes = m.types.filter(t => m.users.some(u => m.cells[`${u.id}:${t}`]));
  const input = (d: Draft) => ({
    certType: text(d, "certType") as never,
    certNumber: nullableText(d, "certNumber"),
    issuer: nullableText(d, "issuer"),
    issuedOn: nullableText(d, "issuedOn"),
    expiresOn: nullableText(d, "expiresOn"),
    notes: nullableText(d, "notes"),
  });
  const rows = (list.data ?? []).filter(c => !who || String(c.userId) === who);
  return (
    <Panel
      title="Certifications"
      actions={
        <Button size="sm" variant="outline" asChild>
          <a href="/print/certs" target="_blank" rel="noreferrer"><Printer className="size-3.5" /> Print matrix</a>
        </Button>
      }
      bodyClassName="p-0"
    >
      <Tabs defaultValue="matrix">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="list">All cards ({(list.data ?? []).length})</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix">
          {!usedTypes.length ? (
            <p className="p-4 text-sm text-muted-foreground">No certifications entered yet. Add cards under All cards, and set required certifications on each classification.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tp-table">
                <thead><tr><th>Crew member</th><th>Classification</th>{usedTypes.map(t => <th key={t}>{certTypeLabel(t)}</th>)}</tr></thead>
                <tbody>
                  {m.users.map(u => (
                    <tr key={u.id}>
                      <td className="font-medium">{u.name}</td>
                      <td>{u.classification ?? "—"}</td>
                      {usedTypes.map(t => {
                        const c = m.cells[`${u.id}:${t}`];
                        return <td key={t}>{c ? <Pill tone={CERT_TONE[c.status]}>{certStatusText(c.status, c.expiresOn)}</Pill> : <span className="text-muted-foreground">—</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="list">
          <RecordList<Cert>
            rows={rows}
            noun="Certification"
            minWidth={900}
            toolbar={
              <select aria-label="Crew member filter" className="h-8 border border-[var(--tp-rule)] bg-white px-2 text-sm" value={who ?? ""} onChange={e => setWho(e.target.value || null)}>
                <option value="">All crew</option>
                {crew.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            }
            empty={{ title: "No certifications", body: "Enter each crew member's cards — NCCCO operator, rigger and signal person, fall protection, CPR/First Aid, OSHA 10/30 — with the expiry date from the card." }}
            columns={[
              { label: "Crew member", cell: c => c.userName ?? "—" },
              { label: "Certification", cell: c => certTypeLabel(c.certType) },
              { label: "Card #", cell: c => c.certNumber || "—" },
              { label: "Issuer", cell: c => c.issuer || "—" },
              { label: "Expires", cell: c => <Pill tone={CERT_TONE[c.status]}>{certStatusText(c.status, c.expiresOn)}</Pill> },
              { label: "Card", cell: c => (c.fileUrl ? "Attached" : "—") },
            ]}
            fields={d => [
              ...(d.id == null ? [{ key: "userId", label: "Crew member", type: "select" as const, options: crew, required: true }] : []),
              { key: "certType", label: "Certification", type: "select" as const, options: CERT_TYPE_LABELS },
              { key: "certNumber", label: "Card / certificate #" },
              { key: "issuer", label: "Issued by" },
              { key: "issuedOn", label: "Issued", type: "date" as const },
              { key: "expiresOn", label: "Expires", type: "date" as const, help: "Leave blank only if you don't have the card — it will show as Expiry unknown." },
              { key: "notes", label: "Notes", type: "textarea" as const },
            ]}
            blank={{ userId: who, certType: "nccco_operator" }}
            toDraft={c => ({ id: c.id, userId: String(c.userId), certType: c.certType, certNumber: c.certNumber, issuer: c.issuer, issuedOn: c.issuedOn, expiresOn: c.expiresOn, notes: c.notes })}
            validate={d => (d.id == null && !d.userId ? "Pick the crew member" : null)}
            onSave={(d, row) => (row ? update.mutateAsync({ id: row.id, ...input(d) }) : create.mutateAsync({ userId: Number(d.userId), ...input(d) }))}
            onDelete={c => remove.mutateAsync({ id: c.id })}
            drawerExtra={c => <CardUpload cert={c} />}
          />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
