/**
 * Offline-aware saves for daily reports and photos, and the runner that sends the outbox when the network
 * is back. Online saves go straight to the server; a save with no answer (no signal, dropped connection)
 * is kept on the device and sent later. A two-device conflict is held for the PM.
 */
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { vanillaTrpc } from "@/lib/trpcClient";
import { idbStore, onOutboxChange } from "./idbStore";
import { classifyError, drain, enqueue, resolveConflict, retryItem, type OutboxItem } from "./outbox";

type Mutate<P extends (i: never) => unknown> = Parameters<P>[0];
export type DailySaveInput = Mutate<typeof vanillaTrpc.daily.save.mutate>;
export type UploadInput = Mutate<typeof vanillaTrpc.collab.upload.mutate>;

export const outboxStore = idbStore();
export const newClientKey = () => crypto.randomUUID();

let qc: QueryClient | null = null;
let running = false;
let needsSignIn = false;
const statusListeners = new Set<() => void>();
const notify = () => statusListeners.forEach(f => f());

/** No signal: the device says so, or the last request never got an answer (see trpcClient). */
const isOffline = () => (typeof navigator !== "undefined" && navigator.onLine === false) || !onlineManager.isOnline();

export type SaveResult = { id: number; rev: string; queued: false } | { queued: true; clientKey: string; conflict: boolean };

/**
 * Save a daily report. `base` is the stored report the form was opened from (null for a new one). Its save
 * revision goes with the save, so an edit made from an older copy is refused (CONFLICT) and held for the PM
 * instead of overwriting the newer one. Each save carries a fresh revision, so a resend whose first answer was
 * lost is recognized as already applied.
 */
export async function saveDaily(
  input: Omit<DailySaveInput, "clientKey" | "saveRev" | "baseRev" | "id">,
  opts: { base: { id: number; rev: string | null } | null; clientKey: string; label: string }
): Promise<SaveResult> {
  // A report first saved on this device and since synced is edited as the stored report, from the revision this device wrote.
  const mapped = opts.base ? null : await outboxStore.getMap(opts.clientKey);
  const base = opts.base ?? (mapped ? { id: mapped.id, rev: mapped.rev } : null);
  const saveRev = newClientKey();
  const full: DailySaveInput = { ...input, saveRev, ...(base ? { id: base.id, baseRev: base.rev } : { clientKey: opts.clientKey }) };
  const queue = async (conflict: string | null) => {
    const item = await enqueue(outboxStore, { id: `daily:${opts.clientKey}`, kind: "dailySave", clientKey: opts.clientKey, dependsOn: null, projectId: input.projectId, label: opts.label, input: full });
    if (conflict) await outboxStore.update(item.id, c => c && { ...c, status: "conflict", error: conflict });
    else void syncNow();
    return { queued: true as const, clientKey: opts.clientKey, conflict: !!conflict };
  };
  // A report already waiting on this device must stay behind (and merge with) its queued copy.
  if (isOffline() || (await queuedDaily(opts.clientKey))) return queue(null);
  try {
    const r = await vanillaTrpc.daily.save.mutate(full);
    await outboxStore.setMap(opts.clientKey, { id: r.id, rev: saveRev });
    return { id: r.id, rev: saveRev, queued: false };
  } catch (e) {
    const err = classifyError(e);
    if (err.kind === "network") return queue(null);
    if (err.kind === "conflict") return queue(err.message);
    throw e;
  }
}

/** The queued save for a report key, if one is waiting on this device. */
export async function queuedDaily(clientKey: string): Promise<OutboxItem | undefined> {
  return (await outboxStore.all()).find(i => i.id === `daily:${clientKey}`);
}

/**
 * Upload a photo, or keep it on the device when there's no signal. `parentKey` is the clientKey of a daily
 * report that hasn't synced yet: the photo waits for it and attaches to it once it has an id.
 */
export async function uploadPhoto(input: Omit<UploadInput, "clientKey">, opts: { parentKey?: string | null; label: string }): Promise<{ queued: boolean }> {
  const clientKey = newClientKey();
  const full: UploadInput = { ...input, clientKey };
  const queue = async () => {
    await enqueue(outboxStore, { id: `photo:${clientKey}`, kind: "photoUpload", clientKey, dependsOn: opts.parentKey ?? null, projectId: input.projectId, label: opts.label, input: full });
    void syncNow();
    return { queued: true };
  };
  if (opts.parentKey || isOffline()) return queue();
  try {
    await vanillaTrpc.collab.upload.mutate(full);
    return { queued: false };
  } catch (e) {
    if (classifyError(e).kind === "network") return queue();
    throw e;
  }
}

async function send(item: OutboxItem, parentId: number | undefined): Promise<{ id: number }> {
  if (item.kind === "dailySave") return vanillaTrpc.daily.save.mutate(item.input as DailySaveInput);
  const input = { ...(item.input as UploadInput) };
  if (item.dependsOn) {
    input.entityType = "dailyReport";
    input.entityId = parentId;
  }
  return vanillaTrpc.collab.upload.mutate(input);
}

/** Send what is waiting. Safe to call any time; one run at a time. */
export async function syncNow(): Promise<void> {
  if (running || isOffline()) return;
  running = true;
  notify();
  try {
    const res = await drain(outboxStore, send);
    needsSignIn = res.needsSignIn;
    if (res.sent && qc) {
      await Promise.all(["daily", "photos", "collab", "tasks", "today", "weather"].map(k => qc!.invalidateQueries({ queryKey: [[k]] })));
    }
  } finally {
    running = false;
    notify();
  }
}

/** Start the runner: on load, whenever the device comes back online, and every 30 seconds while items wait. */
export function startSync(client: QueryClient) {
  qc = client;
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => {
    onlineManager.setOnline(true);
    notify();
    void syncNow();
  });
  window.addEventListener("offline", () => {
    onlineManager.setOnline(false);
    notify();
  });
  // Back from a dead zone (health check answered, or the device reports online).
  onlineManager.subscribe(online => {
    notify();
    if (online) void syncNow();
  });
  onOutboxChange(notify);
  setInterval(() => void syncNow(), 30_000);
  setTimeout(() => void syncNow(), 1500);
}

export const keepMine = async (id: string) => {
  await resolveConflict(outboxStore, id, "keep");
  await syncNow();
};
export const discardMine = (id: string) => resolveConflict(outboxStore, id, "discard");
export const retry = async (id: string) => {
  await retryItem(outboxStore, id);
  await syncNow();
};

export type SyncState = { items: OutboxItem[]; online: boolean; syncing: boolean; needsSignIn: boolean };

/** Live view of the outbox for the sync badge, the Sync drawer and the daily report list. */
/** Last outbox read, so a component mounted mid-session starts from it instead of briefly showing "nothing waiting". */
let lastItems: OutboxItem[] = [];

export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>({ items: lastItems, online: !isOffline(), syncing: running, needsSignIn });
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void outboxStore
        .all()
        .then(items => {
          lastItems = items;
          if (alive) setState({ items, online: !isOffline(), syncing: running, needsSignIn });
        })
        .catch(() => alive && setState(s => ({ ...s, online: !isOffline(), syncing: running })));
    refresh();
    statusListeners.add(refresh);
    return () => {
      alive = false;
      statusListeners.delete(refresh);
    };
  }, []);
  return state;
}
