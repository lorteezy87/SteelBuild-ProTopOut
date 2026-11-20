import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/brand/Controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FIELD_MAX, plural, type Kind, type ReadRec } from "./domain";
import { applyPieceBulk, bulkSummary, pieceDeleteFacts, type PieceBulkApi, type PieceBulkEdit, type PieceBulkOp, type PieceBulkResult } from "./bulk";

type Props = {
  api: PieceBulkApi;
  recs: ReadRec[];
  keys: string[];
  onDone: () => void;
  hiddenCount?: number;
  onBusyChange?: (busy: boolean) => void;
};
type Confirmation = { type: "edit" | "delete"; recs: ReadRec[]; keys: string[] };
const actionClass = "border-[var(--tp-rule)] bg-[var(--tp-paper)] text-[var(--tp-ink)] hover:bg-[var(--tp-accent-soft)]";

/** Shared by Pieces, Lift list and the 3D multi-selection contract. Never includes hidden keys. */
export function PieceBulkBar({ api, recs, keys, onDone, hiddenCount = 0, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [failures, setFailures] = useState<PieceBulkResult["failed"]>([]);
  const [deleteText, setDeleteText] = useState("");
  const [setMark, enableMark] = useState(false);
  const [setSize, enableSize] = useState(false);
  const [mark, editMark] = useState("");
  const [size, editSize] = useState("");
  const [kind, editKind] = useState<Kind | "">("");
  const uniqueKeys = [...new Set(keys)];
  const disabled = busy || !uniqueKeys.length || api.canEdit === false;
  const facts = pieceDeleteFacts(confirm?.recs ?? recs, confirm?.keys ?? uniqueKeys);
  const fields: PieceBulkEdit = { ...(setMark ? { mark } : {}), ...(setSize ? { size } : {}), ...(kind ? { kind } : {}) };

  const run = async (op: PieceBulkOp, snapshot?: Confirmation) => {
    if (running.current || api.canEdit === false) return;
    const selected = snapshot?.keys ?? uniqueKeys;
    if (!selected.length) return;
    running.current = true;
    setBusy(true); onBusyChange?.(true); setFailures([]);
    try {
      const result = await applyPieceBulk(api, snapshot?.recs ?? recs, selected, op);
      const summary = bulkSummary(op, result.done) + ".";
      const skipped = result.skipped ? " " + plural(result.skipped, "piece") + " unchanged or not applicable." : "";
      if (result.failed.length) {
        setFailures(result.failed);
        toast.error(summary + skipped + " " + plural(result.failed.length, "page") + " had a problem.", {
          description: result.failed.map(f => f.sheet + ": " + f.why).join("\n"), duration: 10000,
        });
        // Keep selection after partial failure. Repeating the same action skips completed pieces.
      } else {
        if (result.done) toast.success(summary + skipped);
        else toast.message("No pieces changed." + skipped);
        onDone();
      }
      setConfirm(null); setDeleteText("");
    } finally {
      running.current = false; setBusy(false); onBusyChange?.(false);
    }
  };
  const openConfirm = (type: Confirmation["type"]) => {
    // Hold read identities/versions at confirmation time; never silently adopt a newer version.
    setConfirm({ type, recs, keys: uniqueKeys }); setDeleteText("");
    enableMark(false); enableSize(false); editMark(""); editSize(""); editKind("");
  };
  if (api.canEdit === false || (!uniqueKeys.length && !hiddenCount && !failures.length)) return null;

  return (
    <>
      <div role="region" aria-label="Bulk piece actions" aria-busy={busy} className="sticky bottom-0 z-20 flex flex-col gap-2 rounded-md border border-[var(--tp-rule)] bg-[var(--tp-graphite)] px-3 py-2.5 text-white shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="mr-2 text-[12px] font-medium">
            {plural(uniqueKeys.length, "piece")} selected{hiddenCount ? " · " + hiddenCount + " hidden by filters, not included" : ""}
          </span>
          {busy && <span className="inline-flex items-center gap-1 text-[12px]"><Loader2 className="size-3.5 animate-spin" />Saving…</span>}
          <Button size="sm" variant="outline" className={actionClass} disabled={disabled} onClick={() => void run({ type: "accept" })}><Check />Accept</Button>
          <Button size="sm" variant="outline" className={actionClass} disabled={disabled} onClick={() => void run({ type: "review" })}><RotateCcw />Needs review</Button>
          <Button size="sm" variant="outline" className={actionClass} disabled={disabled} onClick={() => void run({ type: "reject" })}>Reject</Button>
          <Button size="sm" variant="outline" className={actionClass} disabled={disabled} onClick={() => openConfirm("edit")}><Pencil />Edit…</Button>
          <Button size="sm" variant="outline" className={actionClass + " text-[var(--tp-red-strong)]"} disabled={disabled} onClick={() => openConfirm("delete")}><Trash2 />Delete…</Button>
          <Button size="sm" variant="ghost" className="ml-auto text-white hover:bg-[var(--tp-graphite-2)] hover:text-white" disabled={busy} onClick={() => { setFailures([]); onDone(); }}><X />Clear selection</Button>
        </div>
        {failures.length > 0 && <div role="alert" className="max-h-36 overflow-auto text-[12px]">
          <p className="font-medium">Some pages were not changed. Selection kept; review the failed pages before trying again.</p>
          <ul className="list-inside list-disc">{failures.map((f, i) => <li key={f.sheet + i}>{f.sheet}: {f.why}</li>)}</ul>
        </div>}
      </div>
      <Dialog open={confirm?.type === "edit"} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}>
        <DialogContent className="bg-[var(--tp-paper)] text-[var(--tp-ink)]">
          <DialogHeader>
            <DialogTitle>Edit {plural(confirm?.keys.length ?? 0, "piece")}</DialogTitle>
            <DialogDescription>Leave fields unchanged unless selected below. Changed pieces count as fixed; added-by-hand pieces stay added. Geometry and length stay unchanged. Weights update from the new mark, size and kind.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={setMark} disabled={busy} onCheckedChange={v => enableMark(v === true)} />Set mark</label>
              <Input aria-label="Bulk piece mark" maxLength={FIELD_MAX.mark} disabled={busy || !setMark} placeholder={setMark ? "Blank clears the mark" : "Leave unchanged"} value={mark} onChange={e => editMark(e.target.value)} className="num bg-[var(--tp-paper)]" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={setSize} disabled={busy} onCheckedChange={v => enableSize(v === true)} />Set size</label>
              <Input aria-label="Bulk piece size" maxLength={FIELD_MAX.size} disabled={busy || !setSize} placeholder={setSize ? "Blank clears the size" : "Leave unchanged"} value={size} onChange={e => editSize(e.target.value)} className="num bg-[var(--tp-paper)]" />
            </div>
            <label className="flex flex-col gap-2 text-[13px]">Kind
              <SimpleSelect value={kind || "unchanged"} onChange={v => { if (!busy) editKind(v === "beam" || v === "joist" ? v : ""); }} options={[{ value: "unchanged", label: "Leave unchanged" }, { value: "beam", label: "Beam" }, { value: "joist", label: "Joist" }]} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={busy || (!setMark && !setSize && !kind)} onClick={() => { if (confirm) void run({ type: "edit", fields }, confirm); }}>{busy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm?.type === "delete"} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}>
        <AlertDialogContent className="bg-[var(--tp-paper)] text-[var(--tp-ink)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {plural(facts.count, "piece")}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the pieces from the model read, not just their review status. It cannot be undone here.
              {facts.accepted > 0 && " " + plural(facts.accepted, "piece") + " already accepted, fixed or added by hand will be removed."}
              {facts.suggested > 0 && " Reader-suggested pieces may return if this sheet is read again. Use Reject instead to keep a rejected suggestion in this read."}
              {facts.requiresDelete && " Type DELETE to confirm."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {facts.requiresDelete && <Input aria-label="Type DELETE to confirm piece deletion" autoComplete="off" placeholder="DELETE" value={deleteText} disabled={busy} onChange={e => setDeleteText(e.target.value)} className="num bg-[var(--tp-paper)]" />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy || !facts.count || (facts.requiresDelete && deleteText !== "DELETE")} onClick={e => { e.preventDefault(); if (confirm) void run({ type: "delete" }, confirm); }}>{busy ? "Deleting…" : "Delete pieces"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
