import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton, RecordDrawer } from "@/components/ks/Controls";
import { Pill } from "@/components/ks/Status";
import { errMsg, fmtDate, fmtDateTime } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { SET_KINDS, pendingRev, setIssueState } from "@shared/drawings";
import { IssueForm, SetForm, SheetForm } from "./Forms";
import { STATUS_TONE, revLabel, revsOf, statusLabel, useDrawingsRefresh, type DSet, type Register } from "./model";

export function SetDrawer({ reg, set, onClose, onOpenSheet }: { reg: Register & { projectId: number }; set: DSet; onClose: () => void; onOpenSheet: (id: number) => void }) {
  const { userName } = useRefData();
  const refresh = useDrawingsRefresh(reg.projectId);
  const [edit, setEdit] = useState(false);
  const [issue, setIssue] = useState(false);
  const [addSheet, setAddSheet] = useState(false);
  const history = trpc.drawings.history.useQuery({ kind: "drawingSet", id: set.id });
  const remove = trpc.drawings.removeSet.useMutation({
    onSuccess: r => {
      void refresh();
      toast.success(`Set ${set.number} deleted${r.moved ? ` — ${r.moved} sheet${r.moved === 1 ? "" : "s"} kept, not in a set` : ""}.`);
      onClose();
    },
    onError: e => toast.error(errMsg(e)),
  });

  const kids = reg.sheets.filter(x => x.setId === set.id);
  const issues = reg.issues.filter(q => q.setId === set.id).sort((a, b) => b.number - a.number);
  const si = setIssueState(issues, kids.map(x => ({ ...x, revs: revsOf(x) })));
  const last = issues[0];
  // Sheets whose issued revision differs from what the last set issue sent (or that it didn't send).
  const changed = last
    ? kids.filter(x => {
        if (x.currentRev == null) return false;
        const was = last.sheets.find(s => s.sheetId === x.id);
        return !was || was.rev !== x.currentRev;
      })
    : [];
  const pendK = kids.filter(x => pendingRev(x.revs));
  const allIss = si.issued > 0 && si.issued === si.total;
  const stLabel = last ? `Issue ${last.number}` : allIss ? "Issued" : si.issued ? "Part issued" : "Not issued";
  const stTone = last || (allIss && si.rel) ? "green" : si.issued ? "blue" : "gray";
  const counts = (["REL", "REV", "RR", "HOLD", "DET"] as const).map(k => [k, kids.filter(x => x.status === k).length] as const).filter(([, n]) => n);

  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      width={680}
      eyebrow={`${SET_KINDS[set.kind as keyof typeof SET_KINDS] ?? set.kind} set`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="num">{set.number}</span>
          <span className="font-normal">{set.name}</span>
          <Pill tone={stTone}>{stLabel}</Pill>
        </span>
      }
      actions={
        <>
          {reg.canEdit && (
            <Button size="sm" onClick={() => setIssue(true)} disabled={!kids.length}>
              Record issue
            </Button>
          )}
          {reg.canUpload && (
            <Button size="sm" variant="outline" onClick={() => setAddSheet(true)}>
              Add sheet
            </Button>
          )}
          {reg.canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
                Edit
              </Button>
              <ConfirmButton
                variant="ghost"
                destructive
                title={`Delete set ${set.number}?`}
                body={`The set and its ${issues.length} recorded issue${issues.length === 1 ? "" : "s"} are deleted. Its ${kids.length} sheet${kids.length === 1 ? "" : "s"} stay in the register, not in a set.`}
                confirmLabel="Delete set"
                onConfirm={() => remove.mutate({ id: set.id })}
              >
                Delete
              </ConfirmButton>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="text-[13px]">
          {kids.length} sheet{kids.length === 1 ? "" : "s"}
          {last
            ? ` · last issued ${fmtDate(last.issueDate)} ${last.purpose.toLowerCase()}`
            : si.issued
              ? ` · ${allIss ? "every sheet" : `${si.issued} of ${si.total} sheets`} has an issued revision${si.at ? ` (latest ${fmtDate(si.at)})` : ""}; no set issue recorded`
              : " · not issued yet"}
          .{set.description ? ` ${set.description}` : ""}
          {counts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {counts.map(([k, n]) => (
                <Pill key={k} tone={STATUS_TONE[k]}>
                  {n} {statusLabel(k).toLowerCase()}
                </Pill>
              ))}
            </div>
          )}
        </div>
        {changed.length > 0 && (
          <div className="border border-[var(--ks-rule)] bg-[var(--ks-amber-soft)] px-3 py-2 text-[12.5px]">
            {changed.length} sheet{changed.length === 1 ? "" : "s"} changed since issue {last!.number}: {changed.slice(0, 8).map(x => `${x.sheetNumber} R${x.currentRev}`).join(", ")}
            {changed.length > 8 ? "…" : ""}.
          </div>
        )}
        {pendK.length > 0 && (
          <div className="text-[12.5px] text-muted-foreground">
            {pendK.length} sheet{pendK.length === 1 ? "" : "s"} with a revision not yet issued: {pendK.slice(0, 8).map(x => x.sheetNumber).join(", ")}
            {pendK.length > 8 ? "…" : ""}.
          </div>
        )}

        <section>
          <div className="label-caps mb-2 text-[11px] text-[var(--ks-ink)]">Sheets</div>
          {kids.length ? (
            <table className="ks-table">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Title</th>
                  <th>Rev</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {kids.map(x => {
                  const p = pendingRev(x.revs);
                  return (
                    <tr key={x.id} className="cursor-pointer" onClick={() => onOpenSheet(x.id)}>
                      <td className="num font-medium">{x.sheetNumber}</td>
                      <td className="max-w-[260px] truncate">{x.title}</td>
                      <td className="num">
                        {revLabel(x)}
                        {p && <span className="ml-1 text-[var(--ks-accent-ink)]">→{p.number}</span>}
                      </td>
                      <td>
                        <Pill tone={STATUS_TONE[x.status as keyof typeof STATUS_TONE] ?? "gray"} dot>
                          {statusLabel(x.status)}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-[12.5px] text-muted-foreground">No sheets in this set yet.</div>
          )}
        </section>

        <section>
          <div className="label-caps mb-2 text-[11px] text-[var(--ks-ink)]">Issues</div>
          {issues.length ? (
            <div className="space-y-2">
              {issues.map(q => (
                <details key={q.id} className="border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-3 py-2 text-[12.5px]">
                  <summary className="cursor-pointer">
                    <span className="font-semibold">Issue {q.number}</span> · {fmtDate(q.issueDate)} · {q.purpose} · {q.sheets.length} sheet{q.sheets.length === 1 ? "" : "s"}
                    {q.issuedBy ? ` · ${userName(q.issuedBy)}` : ""}
                  </summary>
                  {q.note && <div className="mt-1 text-muted-foreground">{q.note}</div>}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {q.sheets.map(s => (
                      <span key={s.sheetId} className="num">
                        {s.fileUrl ? (
                          <a href={s.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[var(--ks-accent-ink)] hover:underline">
                            {s.sheet} R{s.rev} <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          `${s.sheet} R${s.rev}`
                        )}
                      </span>
                    ))}
                  </div>
                  {q.skipped.length > 0 && (
                    <div className="mt-1 text-muted-foreground">
                      Left out: {q.skipped.slice(0, 6).map(s => `${s.sheet} (${s.why})`).join(", ")}
                      {q.skipped.length > 6 ? ` and ${q.skipped.length - 6} more` : ""}
                    </div>
                  )}
                </details>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted-foreground">No set issue recorded yet.</div>
          )}
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
      <SetForm projectId={reg.projectId} set={set} sets={reg.sets} open={edit} onOpenChange={setEdit} />
      <IssueForm reg={reg} set={set} kids={kids} open={issue} onOpenChange={setIssue} />
      <SheetForm reg={reg} sheet={null} defaultSetId={set.id} open={addSheet} onOpenChange={setAddSheet} onSaved={onOpenSheet} />
    </RecordDrawer>
  );
}
