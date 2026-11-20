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
export function ActivityFeed({ projectId, limit = 40, className }: { projectId?: number; limit?: number; className?: string }) {
  const q = trpc.collab.activity.useQuery({ projectId, limit });
  if (q.isLoading) return <div className="px-4 py-6 text-[12.5px] text-muted-foreground">Loading activity…</div>;
  const rows = q.data ?? [];
  if (!rows.length) return <div className="px-4 py-6 text-[12.5px] text-muted-foreground">No activity yet.</div>;
  return (
    <ol className={cn("flex flex-col", className)}>
      {rows.map(a => (
        <li key={a.id} className="flex gap-3 border-b border-[var(--tp-rule-soft)] px-4 py-2 last:border-0">
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
