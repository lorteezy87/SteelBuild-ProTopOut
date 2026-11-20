import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, fmtAgo, initials } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Bell, BellOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export type CommentEntity = "project" | "task" | "logItem" | "dailyReport";

/** Threaded comments with @mentions (type @Name). Following is automatic on comment. */
export function CommentsPanel({ entityType, entityId, className }: { entityType: CommentEntity; entityId: number; className?: string }) {
  const utils = trpc.useUtils();
  const q = trpc.collab.comments.useQuery({ entityType, entityId });
  const add = trpc.collab.addComment.useMutation({
    onSuccess: () => {
      setBody("");
      utils.collab.comments.invalidate({ entityType, entityId });
      utils.collab.followState.invalidate({ entityType, entityId });
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.collab.removeComment.useMutation({
    onSuccess: () => utils.collab.comments.invalidate({ entityType, entityId }),
    onError: e => toast.error(errMsg(e)),
  });
  const [body, setBody] = useState("");
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {(q.data ?? []).length === 0 && !q.isLoading && <div className="text-[12.5px] text-muted-foreground">No comments yet.</div>}
      <ul className="flex flex-col gap-3">
        {(q.data ?? []).map(c => (
          <li key={c.id} className="group flex gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ks-graphite)] text-[10.5px] font-semibold text-white">
              {initials(c.userName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[12.5px] font-semibold">{c.userName ?? "User"}</span>
                <span className="text-[11.5px] text-muted-foreground">{fmtAgo(c.createdAt)}</span>
                {c.mine && (
                  <button
                    type="button"
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => remove.mutate({ id: c.id })}
                    aria-label="Delete comment"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-[var(--ks-red-strong)]" />
                  </button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{highlightMentions(c.body)}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a comment. Use @Name to notify someone."
          rows={2}
          className="bg-[var(--ks-paper)]"
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) add.mutate({ entityType, entityId, body });
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" disabled={!body.trim() || add.isPending} onClick={() => add.mutate({ entityType, entityId, body })}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function highlightMentions(text: string) {
  const parts = text.split(/(@[A-Za-z][\w.'-]*(?:\s[A-Z][\w.'-]*)?)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-medium text-[var(--ks-accent-ink)]">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function FollowButton({ entityType, entityId }: { entityType: CommentEntity; entityId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.collab.followState.useQuery({ entityType, entityId });
  const m = trpc.collab.setFollow.useMutation({
    onSuccess: () => utils.collab.followState.invalidate({ entityType, entityId }),
    onError: e => toast.error(errMsg(e)),
  });
  const following = q.data?.following ?? false;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => m.mutate({ entityType, entityId, follow: !following })}
      title={(q.data?.followers ?? []).map(f => f.name).join(", ")}
    >
      {following ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
      {following ? "Unfollow" : "Follow"}
      <span className="num text-[11px] text-muted-foreground">{q.data?.followers.length ?? 0}</span>
    </Button>
  );
}

/** Activity stream for one job (or all visible jobs when projectId is omitted). */
export function ActivityFeed({ projectId, limit = 40, className }: { projectId?: number; limit?: number; className?: string }) {
  const q = trpc.collab.activity.useQuery({ projectId, limit });
  if (q.isLoading) return <div className="px-4 py-6 text-[12.5px] text-muted-foreground">Loading activity…</div>;
  const rows = q.data ?? [];
  if (!rows.length) return <div className="px-4 py-6 text-[12.5px] text-muted-foreground">No activity yet.</div>;
  return (
    <ol className={cn("flex flex-col", className)}>
      {rows.map(a => (
        <li key={a.id} className="flex gap-3 border-b border-[var(--ks-rule-soft)] px-4 py-2 last:border-0">
          <div className="num w-16 shrink-0 pt-0.5 text-[11px] text-muted-foreground">{fmtAgo(a.createdAt)}</div>
          <div className="min-w-0 text-[13px]">
            <span className="font-semibold">{a.userName ?? "System"}</span> <span>{a.summary}</span>
            {!projectId && a.projectCode && <span className="num ml-1.5 text-[11.5px] text-muted-foreground">· {a.projectCode}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
