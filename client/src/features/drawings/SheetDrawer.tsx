import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton, RecordDrawer } from "@/components/ks/Controls";
import { Field } from "@/components/ks/Layout";
import { Pill } from "@/components/ks/Status";
import { errMsg, fmtDate, fmtDateTime } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { REVISION_STATES, SHEET_ACTIONS, nextRevNo, pendingRev, issuedRev, reviewFacts, sheetActions, REVIEW_DAYS, type SheetAction } from "@shared/drawings";
import { HoldForm, RevisionForm, SheetForm } from "./Forms";
import { REV_TONE, STATUS_TONE, revLabel, revsOf, statusLabel, useDrawingsRefresh, type Register, type Sheet } from "./model";

const DONE: Record<SheetAction, string> = {
  submit: "submitted for review",
  approve: "approved and released",
  revise: "returned to revise & resubmit",
  hold: "placed on hold",
  release: "hold lifted",
};

export function SheetDrawer({
  reg,
  sheet,
  onClose,
  onOpenSet,
  onOpenViewer,
}: {
  reg: Register & { projectId: number };
  sheet: Sheet;
  onClose: () => void;
  onOpenSet: (id: number) => void;
  /** open the sheet viewer on a revision */
  onOpenViewer?: (rev?: number) => void;
}) {
  const { userName } = useRefData();
  const refresh = useDrawingsRefresh(reg.projectId);
  const [edit, setEdit] = useState(false);
  const [hold, setHold] = useState(false);
  const [revForm, setRevForm] = useState<{ mode: "start" | "attach"; id?: number; n: number } | null>(null);
  const history = trpc.drawings.history.useQuery({ kind: "drawingSheet", id: sheet.id });
  const ok = (msg: string) => () => {
    void refresh();
    toast.success(msg);
  };
  const fail = (e: { message: string }) => toast.error(errMsg(e));
  const action = trpc.drawings.action.useMutation({ onError: fail });
  const signOff = trpc.drawings.signOff.useMutation({ onError: fail });
  const undo = trpc.drawings.undoSignOff.useMutation({ onError: fail });
  const discard = trpc.drawings.discardDraft.useMutation({ onError: fail });
  const issue = trpc.drawings.issueRevision.useMutation({ onError: fail });
  const remove = trpc.drawings.removeSheet.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success(`Sheet ${sheet.sheetNumber} deleted.`);
      onClose();
    },
    onError: fail,
  });
  const busy = action.isPending || signOff.isPending || undo.isPending || discard.isPending || issue.isPending;

  const revs = revsOf(sheet);
  const pend = pendingRev(sheet.revs);
  const cur = issuedRev(sheet.revs);
  const acts = reg.canUpload ? sheetActions(sheet, revs) : [];
  const set = reg.sets.find(t => t.id === sheet.setId) ?? null;
  const seq = reg.sequences.find(s => s.id === sheet.sequenceTaskId) ?? null;
  const facts = reviewFacts(sheet, reg.today);
  const heldByOpen = sheet.status === "HOLD" && !!sheet.holdRfi?.open;
  const heldByMissing = sheet.status === "HOLD" && sheet.holdRfiId != null && !sheet.holdRfi;
  const releaseBlock = heldByMissing ? "Holding RFI is missing — PM resolution is required before release" : heldByOpen ? `Held by ${sheet.holdRfi!.label} — close the RFI to lift the hold` : undefined;
  const nextN = nextRevNo(revs);
  // The drawing shown: the pending revision's when it has one, else the issued one, else the newest with a drawing.
  const hasDrawing = (r: (typeof sheet.revs)[number]) => !!(r.url || r.previewUrl);
  const shown =
    (pend && hasDrawing(pend) ? pend : null) ??
    sheet.revs.find(r => r.state === "issued" && hasDrawing(r)) ??
    [...sheet.revs].filter(hasDrawing).sort((a, b) => b.number - a.number)[0] ??
    null;

  const runAction = (a: SheetAction) => {
    if (a === "hold") return setHold(true);
    action.mutate({ id: sheet.id, action: a, ...((a === "approve" || a === "revise") ? { expectedRevisionId: cur?.id } : {}) }, { onSuccess: ok(`${sheet.sheetNumber} ${DONE[a]}.`) });
  };

  const doIssue = (id: number, n: number) =>
    issue.mutate(
      { revisionId: id },
      { onSuccess: () => ok(`${sheet.sheetNumber} Rev ${n} issued${cur ? `, Rev ${cur.number} superseded` : ""}${sheet.status === "HOLD" ? " — goes to review when the hold is lifted" : " and sent for review"}.`)() }
    );

  const pendNote = pend
    ? pend.state === "draft"
      ? `Rev ${pend.number} is a draft. Sign it off, then it can be issued.`
      : `Rev ${pend.number} is signed off. ${cur ? `Issuing it supersedes Rev ${cur.number} and sends the sheet back for review.` : "Issuing it makes it the first issued revision of this sheet."}`
    : "";

  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      width={680}
      eyebrow={
        <span>
          {set ? (
            <button className="underline-offset-2 hover:underline" onClick={() => onOpenSet(set.id)}>
              {set.number}
            </button>
          ) : (
            "Not in a set"
          )}
          {" · "}
          {cur ? `Rev ${cur.number}` : "Not issued"}
          {seq ? ` · ${seq.name}` : ""}
        </span>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="num">{sheet.sheetNumber}</span>
          <span className="font-normal">{sheet.title}</span>
          <Pill tone={STATUS_TONE[sheet.status as keyof typeof STATUS_TONE] ?? "gray"} dot hazard={sheet.status === "HOLD"}>
            {statusLabel(sheet.status)}
          </Pill>
          {facts.late && <Pill tone="red">Review late · {facts.out} d</Pill>}
        </span>
      }
      actions={
        reg.canUpload && (
          <>
            {acts.map(a => (
              <Button
                key={a}
                size="sm"
                variant={a === "approve" || a === "submit" || a === "release" ? "default" : "outline"}
                disabled={busy || (a === "release" && !!releaseBlock)}
                title={a === "release" ? releaseBlock : undefined}
                onClick={() => runAction(a)}
              >
                {SHEET_ACTIONS[a]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
              Edit
            </Button>
            <ConfirmButton
              variant="ghost"
              destructive
              title={`Delete sheet ${sheet.sheetNumber}?`}
              body={
                <span>
                  This removes the sheet and its {sheet.revs.length} revision{sheet.revs.length === 1 ? "" : "s"} from the register.
                  {sheet.inSetIssue ? " It was sent on a set issue: the issue record keeps its number, and only an editor can delete it." : ""}
                </span>
              }
              confirmLabel="Delete sheet"
              disabled={sheet.inSetIssue && !reg.canEdit}
              onConfirm={() => remove.mutate({ id: sheet.id })}
            >
              Delete
            </ConfirmButton>
          </>
        )
      }
    >
      <div className="space-y-5">
        {sheet.status === "HOLD" && (
          <div className="hazard-amber border border-[var(--ks-rule)] px-3 py-2 text-[13px]">
            <div className="font-semibold">On hold{sheet.holdRfi ? ` · ${sheet.holdRfi.label}` : ""}</div>
            <div className="text-muted-foreground">
              {sheet.holdReason ? (/[.!?]$/.test(sheet.holdReason) ? sheet.holdReason : `${sheet.holdReason}.`) : "No reason recorded."}
              {sheet.holdRfi && (sheet.holdRfi.open ? ` Release is locked until ${sheet.holdRfi.label} is closed.` : ` ${sheet.holdRfi.label} is closed — the hold can be released.`)}
              {heldByMissing && " The holding RFI is missing. Release is locked pending PM resolution."}
              {" "}Releasing returns it to {statusLabel(sheet.holdFrom || "DET").toLowerCase()}.
            </div>
          </div>
        )}
        {sheet.status === "RR" && sheet.returnedDate && (
          <div className="border border-[var(--ks-rule)] bg-[var(--ks-amber-soft)] px-3 py-2 text-[13px]">
            <div className="font-semibold">Returned {fmtDate(sheet.returnedDate)} · revise &amp; resubmit</div>
            <div className="text-muted-foreground">
              {pend ? `Rev ${pend.number} is in progress. Sign it off and issue it to resubmit.` : `Clear the redlines, start Rev ${nextN}, get it signed off, then issue it to resubmit.`}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Current rev">
            <span className="num">{revLabel(sheet)}</span>
          </Field>
          <Field label="Ball in court">{sheet.ballInCourt}</Field>
          <Field label="Sequence">{seq?.name ?? "—"}</Field>
          <Field label="Sent for review">
            <span className="num">{fmtDate(sheet.sentDate)}</span>
          </Field>
          <Field label="Returned">
            <span className="num">{fmtDate(sheet.returnedDate)}</span>
          </Field>
          <Field label="Days out">
            <span className={facts.late ? "num font-semibold text-[var(--ks-red-strong)]" : "num"}>
              {sheet.sentDate ? `${facts.out} d${sheet.status === "REV" ? ` of ${REVIEW_DAYS}` : ""}` : "—"}
            </span>
          </Field>
        </div>
        {sheet.description && <p className="whitespace-pre-wrap text-[13px]">{sheet.description}</p>}
        {shown && (
          <button
            type="button"
            onClick={() => onOpenViewer?.(shown.number)}
            className="group relative block w-full overflow-hidden border border-[var(--ks-rule)] bg-[var(--ks-drawing-paper)]"
            title={onOpenViewer ? "Open in the viewer" : undefined}
          >
            {shown.previewUrl ? (
              <img src={shown.previewUrl} alt={`${sheet.sheetNumber} Rev ${shown.number}`} className="max-h-[260px] w-full object-contain" />
            ) : (
              <div className="flex h-[120px] items-center justify-center gap-2 text-[13px] text-muted-foreground">
                <FileText className="size-4" /> PDF only — open it in the viewer
              </div>
            )}
            <span className="absolute left-0 top-0 bg-[var(--ks-graphite)] px-1.5 py-0.5 text-[11px] font-medium text-white">
              Rev {shown.number}
              {shown.state === "issued" ? "" : ` · ${(REVISION_STATES[shown.state as keyof typeof REVISION_STATES] ?? shown.state).toLowerCase()}`}
            </span>
            {onOpenViewer && (
              <span className="absolute bottom-2 right-2 bg-primary px-2 py-1 text-[12px] font-medium text-white opacity-90 group-hover:opacity-100">Open in viewer</span>
            )}
          </button>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="label-caps text-[11px] text-[var(--ks-ink)]">Revisions</div>
            {reg.canUpload && !pend && (
              <Button size="sm" variant={sheet.status === "RR" || sheet.status === "REL" ? "default" : "outline"} onClick={() => setRevForm({ mode: "start", n: nextN })}>
                Start Rev {nextN}
              </Button>
            )}
          </div>
          {pendNote && <div className="mb-2 text-[12.5px] text-muted-foreground">{pendNote}</div>}
          <table className="ks-table">
            <thead>
              <tr>
                <th>Rev</th>
                <th>State</th>
                <th>Drawing</th>
                <th>Logged</th>
                <th>Sign-off</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sheet.revs.map(r => (
                <tr key={r.id}>
                  <td className="num">R{r.number}</td>
                  <td>
                    <Pill tone={REV_TONE[r.state] ?? "gray"}>{REVISION_STATES[r.state as keyof typeof REVISION_STATES] ?? r.state}</Pill>
                  </td>
                  <td>
                    {r.url || r.previewUrl ? (
                      <div className="flex flex-col items-start gap-0.5">
                        {onOpenViewer && (
                          <button type="button" className="inline-flex items-center gap-1 text-[var(--ks-accent-ink)] hover:underline" onClick={() => onOpenViewer(r.number)}>
                            <FileText className="size-3.5 shrink-0" /> Open
                          </button>
                        )}
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[160px] items-center gap-1 truncate text-[12px] text-muted-foreground hover:underline" title={r.fileName ?? undefined}>
                            <span className="truncate">{r.fileName ?? "PDF"}</span>
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Page image only</span>
                        )}
                        {!r.url && reg.canUpload && r.state !== "superseded" && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setRevForm({ mode: "attach", id: r.id, n: r.number })}>
                            <Paperclip className="size-3.5" /> Attach PDF
                          </Button>
                        )}
                      </div>
                    ) : reg.canUpload && r.state !== "superseded" ? (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setRevForm({ mode: "attach", id: r.id, n: r.number })}>
                        <Paperclip className="size-3.5" /> Attach
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-[12px]">
                    {fmtDateTime(r.createdAt)}
                    <div className="text-muted-foreground">{userName(r.createdBy)}</div>
                    {(r.description || r.revDate) && (
                      <div className="text-[var(--ks-ink)]">
                        {r.description}
                        {r.revDate ? <span className="text-muted-foreground"> · dated {fmtDate(r.revDate)}</span> : null}
                      </div>
                    )}
                    {r.notes && <div className="text-muted-foreground">{r.notes}</div>}
                    {r.source && (
                      <div className="text-[11px] text-muted-foreground">
                        {r.source}
                        {r.readVia === "ai" ? " · title block read by AI" : r.readVia === "pdf" ? " · read from the PDF text" : r.readVia === "hand" ? " · entered by hand" : ""}
                      </div>
                    )}
                  </td>
                  <td className="text-[12px]">
                    {r.checkedBy ? (
                      <>
                        {userName(r.checkedBy)}
                        <div className="text-muted-foreground">{fmtDateTime(r.checkedAt)}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not signed off</span>
                    )}
                    {r.issuedAt && <div className="text-muted-foreground">Issued {fmtDate(r.issuedAt)}</div>}
                  </td>
                  <td className="right whitespace-nowrap">
                    {reg.canUpload && r.state === "draft" && (
                      <>
                        <Button size="sm" className="h-7" disabled={busy} onClick={() => signOff.mutate({ revisionId: r.id }, { onSuccess: ok(`Rev ${r.number} signed off.`) })}>
                          Sign off
                        </Button>
                        {cur && (
                          <ConfirmButton
                            variant="ghost"
                            title={`Discard Rev ${r.number}?`}
                            body={`The draft revision and its drawing link are removed from ${sheet.sheetNumber}. Rev ${cur.number} stays current.`}
                            confirmLabel="Discard draft"
                            destructive
                            disabled={busy}
                            onConfirm={() => discard.mutate({ revisionId: r.id }, { onSuccess: ok(`Draft Rev ${r.number} discarded.`) })}
                          >
                            Discard
                          </ConfirmButton>
                        )}
                      </>
                    )}
                    {reg.canUpload && r.state === "checked" && (
                      <>
                        {r.url || r.previewUrl ? (
                          <Button size="sm" className="h-7" disabled={busy} onClick={() => doIssue(r.id, r.number)}>
                            Issue
                          </Button>
                        ) : (
                          <ConfirmButton
                            variant="default"
                            title={`Issue Rev ${r.number} with no drawing?`}
                            body={`Rev ${r.number} has no drawing attached. Once issued it is the current revision of ${sheet.sheetNumber}${cur?.url || cur?.previewUrl ? `, while the only drawing on file is the superseded Rev ${cur.number}` : ""}. You can still attach its drawing afterwards.`}
                            confirmLabel="Issue anyway"
                            disabled={busy}
                            onConfirm={() => doIssue(r.id, r.number)}
                          >
                            Issue
                          </ConfirmButton>
                        )}
                        <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => undo.mutate({ revisionId: r.id }, { onSuccess: ok(`Sign-off on Rev ${r.number} withdrawn.`) })}>
                          Undo sign-off
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <div className="label-caps mb-2 text-[11px] text-[var(--ks-ink)]">History</div>
          {history.data?.length ? (
            <ul className="space-y-1.5 text-[12.5px]">
              {history.data.map(h => (
                <li key={h.id} className="flex gap-2">
                  <span className="num w-[128px] shrink-0 text-muted-foreground">{fmtDateTime(h.createdAt)}</span>
                  <span>
                    <span className="font-medium">{h.userName ?? "System"}</span> {h.summary}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12.5px] text-muted-foreground">{history.isLoading ? "Loading…" : "No history yet."}</div>
          )}
        </section>
      </div>

      <SheetForm reg={reg} sheet={sheet} open={edit} onOpenChange={setEdit} />
      <HoldForm reg={reg} sheet={sheet} open={hold} onOpenChange={setHold} />
      {revForm && (
        <RevisionForm
          projectId={reg.projectId}
          sheet={sheet}
          mode={revForm.mode}
          revisionId={revForm.id}
          revNumber={revForm.n}
          open
          onOpenChange={o => !o && setRevForm(null)}
        />
      )}
    </RecordDrawer>
  );
}
