import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { JOB_TAB_LABEL_MAX, type ResolvedJobTab } from "@shared/jobTabs";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Draft = { key: string; label: string; defaultLabel: string; hidden: boolean; locked: boolean };

const toDraft = (tabs: ResolvedJobTab[]): Draft[] =>
  tabs.map(t => ({ key: t.key, label: t.label === t.defaultLabel ? "" : t.label, defaultLabel: t.defaultLabel, hidden: t.hidden, locked: t.locked }));

/**
 * Reorder, rename and hide a job's tabs. The layout belongs to the job, not the user:
 * everyone who opens the job sees the same tabs. A hidden tab's data is untouched and the
 * tab still opens from a link; it is only left off the tab bar.
 */
export function JobTabsDialog({
  projectId,
  tabs,
  customized,
  open,
  onOpenChange,
}: {
  projectId: number;
  /** Every tab in the job's layout, in its current order (not filtered by what this user can open, so a save never drops one). */
  tabs: ResolvedJobTab[];
  customized: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(tabs));
  // Start from the saved layout every time the dialog opens.
  useEffect(() => {
    if (open) setDraft(toDraft(tabs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = (r: { tabs: ResolvedJobTab[]; customized: boolean }, message: string) => {
    utils.jobTabs.list.setData({ projectId }, r);
    void utils.jobTabs.list.invalidate({ projectId });
    toast.success(message);
    onOpenChange(false);
  };
  const save = trpc.jobTabs.save.useMutation({ onSuccess: r => done(r, "Tab layout saved."), onError: e => toast.error(errMsg(e)) });
  const reset = trpc.jobTabs.reset.useMutation({ onSuccess: r => done(r, "Tabs reset to the defaults."), onError: e => toast.error(errMsg(e)) });
  const busy = save.isPending || reset.isPending;

  const move = (i: number, by: -1 | 1) =>
    setDraft(d => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const patch = (i: number, p: Partial<Draft>) => setDraft(d => d.map((t, n) => (n === i ? { ...t, ...p } : t)));
  const shown = draft.filter(t => !t.hidden).length;

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Job tabs</DialogTitle>
          <DialogDescription>
            Set the order, rename tabs for this job, and hide the ones this job does not use. Hiding a tab keeps its data.
          </DialogDescription>
        </DialogHeader>
        <ol className="max-h-[52vh] divide-y divide-[var(--tp-rule)] overflow-y-auto rounded-md border border-[var(--tp-rule)]">
          {draft.map((t, i) => (
            <li key={t.key} className={cn("flex items-center gap-2 px-2.5 py-1.5", t.hidden && "bg-[var(--tp-surface)]")}>
              <div className="flex shrink-0">
                <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === 0 || busy} aria-label={`Move ${t.defaultLabel} up`} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === draft.length - 1 || busy} aria-label={`Move ${t.defaultLabel} down`} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
              </div>
              <Input
                aria-label={`Name for ${t.defaultLabel}`}
                value={t.label}
                placeholder={t.defaultLabel}
                maxLength={JOB_TAB_LABEL_MAX}
                disabled={busy}
                onChange={e => patch(i, { label: e.target.value })}
                className={cn("h-8 min-w-0 flex-1 text-[13.5px]", t.hidden && "text-[var(--tp-muted)]")}
              />
              {t.locked ? (
                <span className="flex w-[92px] shrink-0 items-center justify-end gap-1 text-[12px] text-[var(--tp-muted)]" title="Overview is always shown">
                  <Lock className="size-3.5" /> Always on
                </span>
              ) : (
                <label className="flex w-[92px] shrink-0 cursor-pointer items-center justify-end gap-2 text-[12px] text-[var(--tp-muted)]">
                  {t.hidden ? "Hidden" : "Shown"}
                  <Switch checked={!t.hidden} disabled={busy} aria-label={`Show ${t.defaultLabel}`} onCheckedChange={v => patch(i, { hidden: !v })} />
                </label>
              )}
            </li>
          ))}
        </ol>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="sm" disabled={busy || !customized} onClick={() => reset.mutate({ projectId })}>
              Reset to defaults
            </Button>
            <span className="num text-[12px] text-[var(--tp-muted)]">
              {shown} of {draft.length} shown
            </span>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => save.mutate({ projectId, tabs: draft.map(t => ({ key: t.key, label: t.label.trim() || null, hidden: t.hidden })) })}
            >
              {save.isPending ? "Saving…" : "Save layout"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
