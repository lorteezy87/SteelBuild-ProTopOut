import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SimpleSelect } from "@/components/ks/Controls";
import { BALL_IN_COURT, type BulkSheetPatch } from "@shared/drawings";
import type { Register, Sheet } from "./model";

const KEEP = "keep";
const CLEAR = "clear";
const surface = "border-[var(--ks-rule)] bg-[var(--ks-paper)] text-[var(--ks-ink)]";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="label-caps">{label}</span>{children}</label>;
}

/** Mounted afresh for each operation: every field starts at leave unchanged. */
export function BulkEditDialog({ reg, count, busy, onClose, onSave }: {
  reg: Register;
  count: number;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: BulkSheetPatch) => void;
}) {
  const [set, setSet] = useState(KEEP);
  const [sequence, setSequence] = useState(KEEP);
  const [ball, setBall] = useState(KEEP);
  const [sentMode, setSentMode] = useState(KEEP);
  const [returnedMode, setReturnedMode] = useState(KEEP);
  const [sent, setSent] = useState("");
  const [returned, setReturned] = useState("");
  const patch: BulkSheetPatch = {
    ...(set !== KEEP ? { setId: set === CLEAR ? null : Number(set) } : {}),
    ...(sequence !== KEEP ? { sequenceTaskId: sequence === CLEAR ? null : Number(sequence) } : {}),
    ...(ball !== KEEP ? { ballInCourt: ball as BulkSheetPatch["ballInCourt"] } : {}),
    ...(sentMode !== KEEP ? { sentDate: sentMode === CLEAR ? null : sent } : {}),
    ...(returnedMode !== KEEP ? { returnedDate: returnedMode === CLEAR ? null : returned } : {}),
  };
  const dateError = (sentMode === "set" && (!sent || sent > reg.today)) || (returnedMode === "set" && (!returned || returned > reg.today));
  const unchanged = { value: KEEP, label: "Leave unchanged" };
  const dateModes = [unchanged, { value: "set", label: "Set date…" }, { value: CLEAR, label: "Clear date" }];
  return (
    <Dialog open onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className={`${surface} sm:max-w-[560px]`}>
        <DialogHeader>
          <DialogTitle>Edit fields · {count} sheets</DialogTitle>
          <DialogDescription>Only chosen fields change. Status changes through Review status. Sheets with incompatible review dates are skipped.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (!busy && !dateError && Object.keys(patch).length) onSave(patch); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Drawing set">
              <SimpleSelect value={set} onChange={v => setSet(v ?? KEEP)} options={[unchanged, { value: CLEAR, label: "Not in a set" }, ...reg.sets.map(s => ({ value: String(s.id), label: `${s.number} · ${s.name}` }))]} />
            </Field>
            <Field label="Erection sequence">
              <SimpleSelect value={sequence} onChange={v => setSequence(v ?? KEEP)} options={[unchanged, { value: CLEAR, label: "No sequence" }, ...reg.sequences.map(s => ({ value: String(s.id), label: s.name }))]} />
            </Field>
            <Field label="Ball in court">
              <SimpleSelect value={ball} onChange={v => setBall(v ?? KEEP)} options={[unchanged, ...BALL_IN_COURT.map(b => ({ value: b, label: b }))]} />
            </Field>
            <div />
            <Field label="Sent for review">
              <SimpleSelect value={sentMode} onChange={v => setSentMode(v ?? KEEP)} options={dateModes} />
              {sentMode === "set" && <Input aria-label="Sent date" type="date" value={sent} max={reg.today} onChange={e => setSent(e.target.value)} className={surface} required />}
            </Field>
            <Field label="Returned">
              <SimpleSelect value={returnedMode} onChange={v => setReturnedMode(v ?? KEEP)} options={dateModes} />
              {returnedMode === "set" && <Input aria-label="Returned date" type="date" value={returned} max={reg.today} onChange={e => setReturned(e.target.value)} className={surface} required />}
            </Field>
          </div>
          {!!dateError && <p className="mt-3 text-[12px] text-[var(--ks-red-strong)]">Choose a date on or before today.</p>}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !!dateError || !Object.keys(patch).length}>{busy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BulkHoldDialog({ reg, count, busy, onClose, onSave }: {
  reg: Register;
  count: number;
  busy: boolean;
  onClose: () => void;
  onSave: (reason: string | null, rfiId: number | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [rfi, setRfi] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className={`${surface} sm:max-w-[560px]`}>
        <DialogHeader>
          <DialogTitle>Place {count} sheets on hold</DialogTitle>
          <DialogDescription>Held sheets cannot go out for erection. Releasing returns each sheet to its previous status. Sheets already held are skipped.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (!busy) onSave(reason.trim() || null, rfi ? Number(rfi) : null); }}>
          <div className="space-y-3">
            <Field label="Held by RFI (optional)">
              <SimpleSelect value={rfi} onChange={setRfi} options={reg.openRfis.map(r => ({ value: String(r.id), label: `${r.label} · ${r.title}` }))} allowNone noneLabel="Placed by hand" />
              <p className="text-[12px] text-muted-foreground">{reg.openRfis.length ? "The hold cannot be released until this RFI is closed." : "No open RFIs on this job."}</p>
            </Field>
            <Field label="Reason">
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Embed plate conflict at grid C/4" className={surface} />
            </Field>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Place on hold"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BulkDeleteDialog({ sheets, canEdit, busy, onClose, onDelete }: {
  sheets: Sheet[];
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const hasIssued = sheets.some(s => s.revs.some(r => r.state === "issued" || r.state === "superseded" || !!r.issuedAt));
  const protectedCount = canEdit ? 0 : sheets.filter(s => s.inSetIssue).length;
  const deletable = sheets.length - protectedCount;
  return (
    <AlertDialog open onOpenChange={open => !open && !busy && onClose()}>
      <AlertDialogContent className={surface}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {sheets.length} sheets?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-[13px] text-muted-foreground">
              <p>This removes the selected sheets and all their revisions, markups, scales and model reads. It cannot be undone.</p>
              <p className="num text-[var(--ks-ink)]">{sheets.slice(0, 6).map(s => s.sheetNumber).join(", ")}{sheets.length > 6 ? `, +${sheets.length - 6} more` : ""}</p>
              {protectedCount > 0 && <p>{protectedCount} sheets sent on set issues require an editor and will be skipped. {deletable} can be deleted.</p>}
              {sheets.some(s => s.inSetIssue) && <p>Recorded set issues keep their sheet numbers as historical evidence.</p>}
              {hasIssued && <p>Issued revisions are included. Type DELETE to confirm.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {hasIssued && <Input autoFocus aria-label="Type DELETE to confirm" placeholder="DELETE" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" className={surface} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy || deletable === 0 || (hasIssued && confirm !== "DELETE")} onClick={e => { e.preventDefault(); onDelete(); }}>
            {busy ? "Deleting…" : `Delete ${deletable} sheets`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
