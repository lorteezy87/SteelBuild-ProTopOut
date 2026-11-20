import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { SHEET_ACTIONS, issuedRev, pendingRev, sheetActions, type BulkSheetResult, type SheetAction } from "@shared/drawings";
import { BulkDeleteDialog, BulkEditDialog, BulkHoldDialog } from "./BulkDialogs";
import { useDrawingsRefresh, type Register, type Sheet } from "./model";

const DONE: Record<SheetAction, string> = {
  submit: "submitted for review", approve: "approved", revise: "returned revise & resubmit", hold: "placed on hold", release: "holds released",
};

export function BulkBar({ reg, sheets, hiddenCount, onClear }: {
  reg: Register & { projectId: number };
  sheets: Sheet[];
  hiddenCount: number;
  onClear: () => void;
}) {
  const refresh = useDrawingsRefresh(reg.projectId);
  // Keep the selection that was shown when the dialog opened; don't silently add newly visible sheets later.
  const [dialog, setDialog] = useState<{ kind: "edit" | "hold" | "delete"; sheets: Sheet[] } | null>(null);
  const complete = (r: BulkSheetResult, what: string) => {
    void refresh();
    const details = r.skipped.slice(0, 3).map(s => `${s.sheet} ${s.why}`).join(", ");
    const message = `${r.done} ${what}${r.skipped.length ? ` · ${r.skipped.length} skipped: ${details}${r.skipped.length > 3 ? ", …" : ""}` : "."}`;
    if (r.skipped.length) toast.warning(message, { duration: 7000 });
    else toast.success(message);
    setDialog(null);
    onClear();
  };
  const fail = (e: { message: string }) => toast.error(errMsg(e));
  const action = trpc.drawings.bulkAction.useMutation({ onSuccess: (r, v) => complete(r, DONE[v.action]), onError: fail });
  const edit = trpc.drawings.bulkEdit.useMutation({ onSuccess: r => complete(r, "updated"), onError: fail });
  const remove = trpc.drawings.bulkRemove.useMutation({ onSuccess: r => complete(r, "deleted"), onError: fail });
  const revisions = trpc.drawings.bulk.useMutation({
    onSuccess: (r, v) => {
      void refresh();
      const what = v.step === "signoff" ? "signed off" : "issued";
      const message = `${r.done} revisions ${what}${r.skipped.length ? ` · ${r.skipped.length} skipped: ${r.skipped.slice(0, 3).join(", ")}` : "."}`;
      if (r.skipped.length) toast.warning(message, { duration: 7000 });
      else toast.success(message);
      onClear();
    },
    onError: fail,
  });
  const busy = action.isPending || edit.isPending || remove.isPending || revisions.isPending;
  const overLimit = sheets.length > 500;
  const unavailable = busy || !sheets.length || overLimit;
  const observedItems = (state: "draft" | "checked") => sheets.flatMap(s => {
    const rev = pendingRev(s.revs);
    return rev?.state === state ? [{ sheetId: s.id, revisionId: rev.id }] : [];
  });
  const drafts = observedItems("draft");
  const checked = observedItems("checked");
  const countFor = (a: SheetAction) => sheets.filter(s => sheetActions(s, s.revs).includes(a)).length;
  const runAction = (a: SheetAction, targets = sheets, holdReason?: string | null, holdRfiId?: number | null) => action.mutate({
    projectId: reg.projectId,
    action: a,
    items: targets.map(s => ({ sheetId: s.id, ...((a === "approve" || a === "revise") ? { expectedRevisionId: issuedRev(s.revs)?.id } : {}) })),
    holdReason,
    holdRfiId,
  });
  const canDelete = sheets.some(s => reg.canEdit || !s.inSetIssue);
  if (!reg.canUpload) return null;

  return (
    <>
      <div role="toolbar" aria-label="Bulk drawing actions" aria-busy={busy} className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md bg-[var(--tp-graphite)] px-3 py-2 text-white">
        <div className="mr-auto text-[13px]">
          <span className="font-semibold">{sheets.length} selected</span>
          {hiddenCount > 0 && <span className="ml-2 text-white/70">{hiddenCount} hidden by filters or collapsed sets, not included</span>}
          {overLimit && <div className="text-[12px] text-white/70">Select up to 500 sheets per batch.</div>}
        </div>
        <Button size="sm" disabled={unavailable || !drafts.length} onClick={() => revisions.mutate({ projectId: reg.projectId, items: drafts, step: "signoff" })}>Sign off {drafts.length} revisions</Button>
        <Button size="sm" disabled={unavailable || !checked.length} onClick={() => revisions.mutate({ projectId: reg.projectId, items: checked, step: "issue" })}>Issue {checked.length} revisions</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" disabled={unavailable}>Review status <ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[250px] border-[var(--tp-rule)] bg-[var(--tp-paper)] text-[var(--tp-ink)]">
            {(Object.keys(SHEET_ACTIONS) as SheetAction[]).map(a => (
              <DropdownMenuItem key={a} disabled={!countFor(a)} onSelect={() => a === "hold" ? setDialog({ kind: "hold", sheets: [...sheets] }) : runAction(a)}>
                <span>{SHEET_ACTIONS[a]}</span><span className="num ml-auto pl-4 text-muted-foreground">{countFor(a)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" disabled={unavailable} onClick={() => setDialog({ kind: "edit", sheets: [...sheets] })}>Edit fields…</Button>
        <Button size="sm" disabled={unavailable || !canDelete} onClick={() => setDialog({ kind: "delete", sheets: [...sheets] })}>Delete…</Button>
        <Button size="sm" variant="outline" disabled={busy} className="border-white/30 bg-transparent text-white hover:bg-[var(--tp-graphite-2)] hover:text-white" onClick={onClear}>Clear</Button>
      </div>
      {dialog?.kind === "edit" && <BulkEditDialog reg={reg} count={dialog.sheets.length} busy={busy} onClose={() => setDialog(null)} onSave={patch => edit.mutate({ projectId: reg.projectId, sheetIds: dialog.sheets.map(s => s.id), patch })} />}
      {dialog?.kind === "hold" && <BulkHoldDialog reg={reg} count={dialog.sheets.filter(s => sheetActions(s, s.revs).includes("hold")).length} busy={busy} onClose={() => setDialog(null)} onSave={(reason, rfi) => runAction("hold", dialog.sheets, reason, rfi)} />}
      {dialog?.kind === "delete" && <BulkDeleteDialog sheets={dialog.sheets} canEdit={reg.canEdit} busy={busy} onClose={() => setDialog(null)} onDelete={() => remove.mutate({ projectId: reg.projectId, sheetIds: dialog.sheets.map(s => s.id), confirm: "DELETE" })} />}
    </>
  );
}
