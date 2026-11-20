import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput, NumberInput, SimpleSelect } from "@/components/brand/Controls";
import { errMsg, fileToBase64, fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  BALL_IN_COURT,
  ISSUE_PURPOSES,
  SET_KINDS,
  isWorkPurpose,
  issueSnapshot,
  sheetNumberProblem,
} from "@shared/drawings";
import { revsOf, useDrawingsRefresh, type DSet, type Register, type Sheet } from "./model";

const MAX_BYTES = 25 * 1024 * 1024;

export async function fileInput(file: File) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB`);
  return { fileName: file.name, mimeType: file.type || "application/pdf", base64: await fileToBase64(file) };
}

function FormRow({ label, error, hint, children, span }: { label: string; error?: string; hint?: string; children: ReactNode; span?: boolean }) {
  return (
    <label className={span ? "col-span-2 block" : "block"}>
      <div className="label-caps mb-1">{label}</div>
      {children}
      {error ? <div className="mt-1 text-[12px] text-[var(--tp-red-strong)]">{error}</div> : hint ? <div className="mt-1 text-[12px] text-muted-foreground">{hint}</div> : null}
    </label>
  );
}

function Shell({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitLabel,
  onSubmit,
  pending,
  disabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  submitLabel: string;
  onSubmit: () => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--tp-paper)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription asChild><div>{description}</div></DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (!pending && !disabled) onSubmit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">{children}</div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || disabled}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Drawing set                                                         */
/* ------------------------------------------------------------------ */

export function SetForm({
  projectId,
  set,
  sets,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: number;
  set: DSet | null;
  sets: DSet[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (id: number) => void;
}) {
  const refresh = useDrawingsRefresh(projectId);
  const [v, setV] = useState({ number: "", name: "", kind: "erection", description: "" });
  useEffect(() => {
    if (open) setV(set ? { number: set.number, name: set.name, kind: set.kind, description: set.description ?? "" } : { number: "", name: "", kind: "erection", description: "" });
  }, [open, set]);
  const dup = sets.find(t => t.id !== set?.id && t.number.trim().toLowerCase() === v.number.trim().toLowerCase() && v.number.trim());
  const save = trpc.drawings.saveSet.useMutation({
    onSuccess: r => {
      void refresh();
      toast.success(set ? `Set ${v.number} saved.` : `Set ${v.number} created.`);
      onOpenChange(false);
      onSaved?.(r.id);
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={set ? `Edit set ${set.number}` : "New drawing set"}
      submitLabel={set ? "Save changes" : "Create set"}
      pending={save.isPending}
      disabled={!v.number.trim() || !v.name.trim() || !!dup}
      onSubmit={() => save.mutate({ projectId, id: set?.id, number: v.number, name: v.name, kind: v.kind, description: v.description || null })}
    >
      <FormRow label="Set no." error={dup ? `Set ${dup.number} already exists on this job` : undefined}>
        <Input value={v.number} onChange={e => setV({ ...v, number: e.target.value })} placeholder="E-SET-01" className="bg-[var(--tp-paper)]" autoFocus />
      </FormRow>
      <FormRow label="Kind">
        <SimpleSelect value={v.kind} onChange={k => setV({ ...v, kind: k ?? "erection" })} options={SET_KINDS} />
      </FormRow>
      <FormRow label="Name" span>
        <Input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} placeholder="Erection drawings — Seq 1–3" className="bg-[var(--tp-paper)]" />
      </FormRow>
      <FormRow label="Description" span>
        <Textarea value={v.description} onChange={e => setV({ ...v, description: e.target.value })} rows={2} className="bg-[var(--tp-paper)]" />
      </FormRow>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

export function SheetForm({
  reg,
  sheet,
  defaultSetId,
  open,
  onOpenChange,
  onSaved,
}: {
  reg: Register & { projectId: number };
  sheet: Sheet | null;
  defaultSetId?: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (id: number) => void;
}) {
  const refresh = useDrawingsRefresh(reg.projectId);
  const blank = { sheetNumber: "", title: "", description: "", setId: null as number | null, sequenceTaskId: null as number | null, ballInCourt: "Detailer", sentDate: null as string | null, returnedDate: null as string | null, startRev: 0 as number | null };
  const [v, setV] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setV(
      sheet
        ? {
            sheetNumber: sheet.sheetNumber,
            title: sheet.title,
            description: sheet.description ?? "",
            setId: sheet.setId,
            sequenceTaskId: reg.sequences.some(s => s.id === sheet.sequenceTaskId) ? sheet.sequenceTaskId : null,
            ballInCourt: sheet.ballInCourt,
            sentDate: sheet.sentDate,
            returnedDate: sheet.returnedDate,
            startRev: null,
          }
        : { ...blank, setId: defaultSetId ?? null }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheet, defaultSetId]);

  const numberErr = v.sheetNumber.trim() ? sheetNumberProblem(reg.sheets, v.sheetNumber, sheet?.id ?? null) : "";
  const status = sheet?.status ?? "DET";
  const errs = {
    sentDate:
      sheet && (status === "REV" || status === "RR" || status === "REL") && !v.sentDate
        ? "Required while the sheet has been sent"
        : v.sentDate && v.sentDate > reg.today
          ? "Cannot be in the future"
          : "",
    returnedDate:
      sheet && (status === "RR" || status === "REL") && !v.returnedDate
        ? "Required once the sheet has been returned"
        : sheet && status === "REV" && v.returnedDate
          ? "A sheet in review has not been returned"
          : v.returnedDate && v.sentDate && v.returnedDate < v.sentDate
            ? "Cannot be before the sent date"
            : v.returnedDate && v.returnedDate > reg.today
              ? "Cannot be in the future"
              : "",
    startRev: !sheet && (v.startRev == null || !Number.isInteger(v.startRev) || v.startRev < 0) ? "Whole number, 0 or more" : "",
  };
  const invalid = !v.sheetNumber.trim() || !v.title.trim() || !!numberErr || Object.values(errs).some(Boolean);
  const save = trpc.drawings.saveSheet.useMutation();

  const submit = async () => {
    setBusy(true);
    try {
      const r = await save.mutateAsync({
        projectId: reg.projectId,
        id: sheet?.id,
        sheetNumber: v.sheetNumber,
        title: v.title,
        description: v.description || null,
        setId: v.setId,
        sequenceTaskId: v.sequenceTaskId,
        ballInCourt: v.ballInCourt,
        ...(sheet ? { sentDate: v.sentDate, returnedDate: v.returnedDate } : { startRev: v.startRev ?? 0, file: file ? await fileInput(file) : undefined }),
      });
      await refresh();
      toast.success(sheet ? `Sheet ${v.sheetNumber.trim()} saved.` : `Sheet ${v.sheetNumber.trim()} added with Rev ${v.startRev ?? 0} as a draft.`);
      onOpenChange(false);
      onSaved?.(r.id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={sheet ? `Edit sheet ${sheet.sheetNumber}` : "New sheet"}
      description={sheet ? "Status changes through the sheet's actions (submit, approve, hold…)." : "The sheet starts in detailing with its first revision as a draft that needs sign-off."}
      submitLabel={sheet ? "Save changes" : "Add sheet"}
      pending={busy}
      disabled={invalid}
      onSubmit={() => void submit()}
    >
      <FormRow label="Sheet no." error={numberErr}>
        <Input value={v.sheetNumber} onChange={e => setV({ ...v, sheetNumber: e.target.value })} placeholder="E-204" className="num bg-[var(--tp-paper)]" autoFocus />
      </FormRow>
      <FormRow label="Drawing set">
        <SimpleSelect
          value={v.setId == null ? null : String(v.setId)}
          onChange={x => setV({ ...v, setId: x ? Number(x) : null })}
          options={reg.sets.map(t => ({ value: String(t.id), label: `${t.number} · ${t.name}` }))}
          allowNone
          noneLabel="— Not in a set —"
        />
      </FormRow>
      <FormRow label="Title" span>
        <Input value={v.title} onChange={e => setV({ ...v, title: e.target.value })} placeholder="Seq 3 roof framing plan" className="bg-[var(--tp-paper)]" />
      </FormRow>
      <FormRow label="Erection sequence" hint={reg.sequences.length ? undefined : "No erection sequences on this job yet"}>
        <SimpleSelect
          value={v.sequenceTaskId == null ? null : String(v.sequenceTaskId)}
          onChange={x => setV({ ...v, sequenceTaskId: x ? Number(x) : null })}
          options={reg.sequences.map(s => ({ value: String(s.id), label: s.name }))}
          allowNone
        />
      </FormRow>
      <FormRow label="Ball in court">
        <SimpleSelect value={v.ballInCourt} onChange={x => setV({ ...v, ballInCourt: x ?? "Detailer" })} options={BALL_IN_COURT.map(b => ({ value: b, label: b }))} />
      </FormRow>
      {sheet ? (
        <>
          <FormRow label="Sent for review" error={errs.sentDate}>
            <DateInput value={v.sentDate} onChange={x => setV({ ...v, sentDate: x })} />
          </FormRow>
          <FormRow label="Returned" error={errs.returnedDate}>
            <DateInput value={v.returnedDate} onChange={x => setV({ ...v, returnedDate: x })} />
          </FormRow>
        </>
      ) : (
        <>
          <FormRow label="Starting revision" error={errs.startRev} hint="Logged as a draft that needs sign-off">
            <NumberInput value={v.startRev} onChange={x => setV({ ...v, startRev: x })} min={0} step={1} />
          </FormRow>
          <FormRow label="Drawing (optional)" hint="PDF or image, up to 25 MB">
            <Input type="file" accept=".pdf,image/*" className="bg-[var(--tp-paper)]" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </FormRow>
        </>
      )}
      <FormRow label="Description" span>
        <Textarea value={v.description} onChange={e => setV({ ...v, description: e.target.value })} rows={2} className="bg-[var(--tp-paper)]" />
      </FormRow>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Hold                                                                */
/* ------------------------------------------------------------------ */

export function HoldForm({ reg, sheet, open, onOpenChange }: { reg: Register & { projectId: number }; sheet: Sheet; open: boolean; onOpenChange: (v: boolean) => void }) {
  const refresh = useDrawingsRefresh(reg.projectId);
  const [reason, setReason] = useState("");
  const [rfi, setRfi] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason("");
      setRfi(null);
    }
  }, [open]);
  const act = trpc.drawings.action.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success(`${sheet.sheetNumber} placed on hold.`);
      onOpenChange(false);
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={`Place ${sheet.sheetNumber} on hold`}
      description="Held sheets can't go out for erection. Releasing the hold returns the sheet to where it is now."
      submitLabel="Place on hold"
      pending={act.isPending}
      onSubmit={() => act.mutate({ id: sheet.id, action: "hold", holdReason: reason || null, holdRfiId: rfi ? Number(rfi) : null })}
    >
      <FormRow label="Held by RFI" span hint={reg.openRfis.length ? "The hold can't be released until this RFI is closed" : "No open RFIs on this job"}>
        <SimpleSelect value={rfi} onChange={setRfi} options={reg.openRfis.map(r => ({ value: String(r.id), label: `${r.label} · ${r.title}` }))} allowNone noneLabel="— Placed by hand —" />
      </FormRow>
      <FormRow label="Reason" span>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Embed plate conflict at grid C/4" className="bg-[var(--tp-paper)]" maxLength={500} />
      </FormRow>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* New revision / attach drawing                                       */
/* ------------------------------------------------------------------ */

export function RevisionForm({
  projectId,
  sheet,
  mode,
  revisionId,
  revNumber,
  open,
  onOpenChange,
}: {
  projectId: number;
  sheet: Sheet;
  mode: "start" | "attach";
  revisionId?: number;
  revNumber: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const refresh = useDrawingsRefresh(projectId);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setNotes("");
      setFile(null);
    }
  }, [open]);
  const start = trpc.drawings.startRevision.useMutation();
  const attach = trpc.drawings.attachFile.useMutation();
  const submit = async () => {
    setBusy(true);
    try {
      const f = file ? await fileInput(file) : undefined;
      if (mode === "start") await start.mutateAsync({ sheetId: sheet.id, notes: notes || null, file: f });
      else await attach.mutateAsync({ revisionId: revisionId!, file: f! });
      await refresh();
      toast.success(mode === "start" ? `Rev ${revNumber} of ${sheet.sheetNumber} started as a draft.` : `Drawing attached to Rev ${revNumber}.`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "start" ? `Start Rev ${revNumber} of ${sheet.sheetNumber}` : `Attach drawing to Rev ${revNumber}`}
      description={mode === "start" ? "The new revision is a draft until it is signed off and issued; the current issued revision stays current." : undefined}
      submitLabel={mode === "start" ? `Start Rev ${revNumber}` : "Attach drawing"}
      pending={busy}
      disabled={mode === "attach" && !file}
      onSubmit={() => void submit()}
    >
      <FormRow label={mode === "start" ? "Drawing (optional)" : "Drawing"} span hint="PDF or image, up to 25 MB">
        <Input type="file" accept=".pdf,image/*" className="bg-[var(--tp-paper)]" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </FormRow>
      {mode === "start" && (
        <FormRow label="What changed" span>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="Clouded revisions per RFI-014 response" className="bg-[var(--tp-paper)]" />
        </FormRow>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Record set issue                                                    */
/* ------------------------------------------------------------------ */

export function IssueForm({
  reg,
  set,
  kids,
  open,
  onOpenChange,
}: {
  reg: Register & { projectId: number };
  set: DSet;
  kids: Sheet[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const refresh = useDrawingsRefresh(reg.projectId);
  const [v, setV] = useState({ purpose: "For erection" as string, issueDate: reg.today as string | null, note: "" });
  useEffect(() => {
    if (open) setV({ purpose: "For erection", issueDate: reg.today, note: "" });
  }, [open, reg.today]);
  const next = Math.max(0, ...reg.issues.filter(q => q.setId === set.id).map(q => q.number)) + 1;
  const snap = useMemo(() => issueSnapshot(kids.map(x => ({ ...x, revs: revsOf(x) })), v.purpose), [kids, v.purpose]);
  const whyN = snap.skipped.reduce<Record<string, number>>((m, s) => ({ ...m, [s.why]: (m[s.why] ?? 0) + 1 }), {});
  const dateErr = !v.issueDate ? "Required" : v.issueDate > reg.today ? "Cannot be in the future" : "";
  const nothing = !kids.length ? "Add sheets to this set before issuing it" : !snap.sheets.length ? (isWorkPurpose(v.purpose) ? "No sheet in this set is released with an issued revision" : "No sheet in this set has an issued revision yet") : "";
  const rec = trpc.drawings.recordIssue.useMutation({
    onSuccess: r => {
      void refresh();
      toast.success(`${set.number} issue ${r.number} recorded — ${r.recorded} sheet${r.recorded === 1 ? "" : "s"}${r.skipped.length ? `; ${r.skipped.length} left out` : ""}.`);
      onOpenChange(false);
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={`Record issue ${next} · ${set.number}`}
      description={
        <span>
          {snap.sheets.length} of {kids.length} sheet{kids.length === 1 ? "" : "s"} will be recorded
          {snap.skipped.length ? `; left out: ${Object.entries(whyN).map(([w, k]) => `${k} ${w}`).join(", ")}` : ""}.
        </span>
      }
      submitLabel="Record issue"
      pending={rec.isPending}
      disabled={!!dateErr || !!nothing}
      onSubmit={() => rec.mutate({ setId: set.id, purpose: v.purpose, issueDate: v.issueDate!, note: v.note || null })}
    >
      <FormRow label="Issued" error={nothing}>
        <SimpleSelect value={v.purpose} onChange={x => setV({ ...v, purpose: x ?? "For erection" })} options={ISSUE_PURPOSES.map(p => ({ value: p, label: p }))} />
      </FormRow>
      <FormRow label="Date" error={dateErr}>
        <DateInput value={v.issueDate} onChange={x => setV({ ...v, issueDate: x })} />
      </FormRow>
      <FormRow
        label="Note"
        span
        hint={isWorkPurpose(v.purpose) ? "Only released sheets with an issued revision are recorded; held and unreleased sheets are left out." : "Records the issued revision of every sheet in the set; drafts are left out."}
      >
        <Textarea value={v.note} onChange={e => setV({ ...v, note: e.target.value })} rows={2} maxLength={1000} placeholder="Who it went to, what changed" className="bg-[var(--tp-paper)]" />
      </FormRow>
      {snap.skipped.length > 0 && (
        <div className="col-span-2 max-h-28 overflow-y-auto border border-[var(--tp-rule)] bg-[var(--tp-paper)] px-2 py-1.5 text-[12px] text-muted-foreground">
          {snap.skipped.map(s => (
            <div key={s.sheet}>
              <span className="num text-[var(--tp-ink)]">{s.sheet}</span> — {s.why}
            </div>
          ))}
        </div>
      )}
      <div className="col-span-2 text-[11.5px] text-muted-foreground">Recorded as issued on {fmtDate(v.issueDate)}.</div>
    </Shell>
  );
}
