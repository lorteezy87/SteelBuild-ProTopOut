import { useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { ConfirmButton, RecordDrawer } from "@/components/brand/Controls";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { discardMine, keepMine, retry, syncNow, useSyncState } from "./sync";
import type { OutboxItem } from "./outbox";

const STATUS: Record<OutboxItem["status"], string> = {
  pending: "Waiting to sync",
  syncing: "Syncing…",
  conflict: "Changed on another device",
  failed: "Refused by the server",
};

/** Top-bar status for work saved on this device. Hidden when online with nothing waiting. */
export function SyncBadge() {
  const s = useSyncState();
  const [open, setOpen] = useState(false);
  const attention = s.items.filter(i => i.status === "conflict" || i.status === "failed").length;
  const waiting = s.items.length - attention;
  if (s.online && !s.items.length) return null;
  const label = !s.online
    ? `Offline${s.items.length ? ` · ${s.items.length} on this device` : ""}`
    : s.needsSignIn
      ? "Sign in to sync"
      : attention
        ? `${attention} need${attention === 1 ? "s" : ""} attention`
        : s.syncing
          ? `Syncing ${waiting}`
          : `${waiting} waiting to sync`;
  const Icon = !s.online ? CloudOff : attention || s.needsSignIn ? TriangleAlert : RefreshCw;
  return (
    <>
      <Button size="sm" variant={attention ? "destructive" : "outline"} className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)} aria-label={`Sync: ${label}`}>
        <Icon className={`size-3.5 ${s.syncing ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">{label}</span>
      </Button>
      <RecordDrawer
        open={open}
        onOpenChange={setOpen}
        eyebrow="This device"
        title="Saved on this device"
        width={560}
        footer={
          <div className="flex justify-between gap-2">
            <span className="text-xs text-muted-foreground">{s.online ? "Online" : "No connection — items sync automatically when it's back."}</span>
            <Button size="sm" disabled={!s.online || s.syncing || !s.items.length} onClick={() => void syncNow()}>
              Sync now
            </Button>
          </div>
        }
      >
        {!s.items.length ? (
          <p className="text-sm text-muted-foreground">Nothing waiting. Everything saved on this device has synced.</p>
        ) : (
          <ul className="space-y-3">
            {s.items.map(i => (
              <li key={i.id} className="space-y-2 border border-[var(--tp-rule)] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.label}</span>
                  <Pill tone={i.status === "conflict" || i.status === "failed" ? "red" : "amber"}>{STATUS[i.status]}</Pill>
                  <span className="num ml-auto text-xs text-muted-foreground">saved {fmtDateTime(new Date(i.createdAt))}</span>
                </div>
                {i.error && <p className="text-xs">{i.error}</p>}
                {i.status === "conflict" && (
                  <div className="flex flex-wrap gap-2">
                    <ConfirmButton title="Keep the copy on this device?" body="It replaces the version saved from the other device. Their changes to this report are lost." confirmLabel="Keep mine" onConfirm={() => void keepMine(i.id)}>
                      Keep mine
                    </ConfirmButton>
                    <ConfirmButton destructive title="Discard the copy on this device?" body="The other device's version stays. What you entered here is deleted from this device." confirmLabel="Discard mine" onConfirm={() => void discardMine(i.id)}>
                      Discard mine
                    </ConfirmButton>
                  </div>
                )}
                {i.status === "failed" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!s.online} onClick={() => void retry(i.id)}>
                      Try again
                    </Button>
                    <ConfirmButton destructive title="Discard this from the device?" body="It never reached the server. Copy anything you need first." confirmLabel="Discard" onConfirm={() => void discardMine(i.id)}>
                      Discard
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </RecordDrawer>
    </>
  );
}
