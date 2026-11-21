/**
 * Offline outbox: daily-report saves and photo uploads made without signal wait here (IndexedDB on the
 * tablet) and are sent in order when the network is back. Nothing leaves the outbox unsent unless the PM
 * discards it; a refusal or a two-device conflict is kept for the PM to decide.
 */

export type OutboxStatus = "pending" | "syncing" | "conflict" | "failed";

export type OutboxItem = {
  id: string;
  kind: "dailySave" | "photoUpload";
  /** Idempotency key sent to the server (new reports and photos). Also links a photo to its unsynced report. */
  clientKey: string;
  /** clientKey of the report this item must wait for. */
  dependsOn: string | null;
  projectId: number;
  label: string;
  input: unknown;
  createdAt: number;
  status: OutboxStatus;
  error: string | null;
  attempts: number;
};

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
  getMap(clientKey: string): Promise<number | undefined>;
  setMap(clientKey: string, id: number): Promise<void>;
}

export function memoryStore(): OutboxStore {
  const items = new Map<string, OutboxItem>();
  const map = new Map<string, number>();
  return {
    all: async () => [...items.values()].sort((a, b) => a.createdAt - b.createdAt).map(i => structuredClone(i)),
    put: async i => void items.set(i.id, structuredClone(i)),
    remove: async id => void items.delete(id),
    getMap: async k => map.get(k),
    setMap: async (k, id) => void map.set(k, id),
  };
}

type NewItem = Omit<OutboxItem, "status" | "error" | "attempts" | "createdAt"> & { createdAt?: number };

/** Queue an item. A later save of the same report replaces the queued one (keeping its place and the version it was edited from). */
export async function enqueue(store: OutboxStore, item: NewItem): Promise<OutboxItem> {
  const existing = (await store.all()).find(i => i.id === item.id);
  let next: OutboxItem;
  if (existing) {
    const prevInput = (existing.input ?? {}) as Record<string, unknown>;
    const input = { ...(item.input as Record<string, unknown>) };
    if ("baseUpdatedAt" in prevInput) input.baseUpdatedAt = prevInput.baseUpdatedAt;
    else delete input.baseUpdatedAt;
    next = { ...existing, label: item.label, input, status: existing.status === "conflict" ? "conflict" : "pending", error: existing.status === "conflict" ? existing.error : null };
  } else {
    next = { ...item, createdAt: item.createdAt ?? Date.now(), status: "pending", error: null, attempts: 0 };
  }
  await store.put(next);
  return next;
}

export type SendError = { kind: "network" | "auth" | "conflict" | "error"; message: string };

/** What a failed send means. A tRPC error with a code got an answer; anything without one never reached the server. */
export function classifyError(e: unknown): SendError {
  const x = e as { data?: { code?: string } | null; message?: string } | null;
  const message = x?.message ?? String(e);
  const code = x?.data?.code;
  if (!code) return { kind: "network", message };
  if (code === "CONFLICT") return { kind: "conflict", message };
  if (code === "UNAUTHORIZED") return { kind: "auth", message };
  return { kind: "error", message };
}

const isSendError = (e: unknown): e is SendError =>
  !!e && typeof e === "object" && "kind" in e && ["network", "auth", "conflict", "error"].includes((e as SendError).kind);

/**
 * Send what can be sent, oldest first. `send` gets the item and, for an item that depends on a report, that
 * report's server id. Returns how many were sent and whether the run stopped (no network / signed out).
 */
export async function drain(
  store: OutboxStore,
  send: (item: OutboxItem, parentId: number | undefined) => Promise<{ id: number }>,
  classify: (e: unknown) => SendError = classifyError
): Promise<{ sent: number; stopped: boolean; needsSignIn: boolean }> {
  let sent = 0;
  const items = await store.all();
  for (const item of items) {
    if (item.status !== "pending" && item.status !== "syncing") continue;
    let parentId: number | undefined;
    if (item.dependsOn) {
      parentId = await store.getMap(item.dependsOn);
      if (parentId == null) {
        const parentQueued = (await store.all()).some(i => i.clientKey === item.dependsOn && i.kind === "dailySave");
        if (parentQueued) continue;
        await store.put({ ...item, status: "failed", error: "The report this photo belonged to was discarded before it synced." });
        continue;
      }
    }
    await store.put({ ...item, status: "syncing" });
    try {
      const res = await send(item, parentId);
      if (item.kind === "dailySave") await store.setMap(item.clientKey, res.id);
      await store.remove(item.id);
      sent++;
    } catch (e) {
      const err = isSendError(e) ? e : classify(e);
      if (err.kind === "network" || err.kind === "auth") {
        await store.put({ ...item, status: "pending", attempts: item.attempts + 1 });
        return { sent, stopped: true, needsSignIn: err.kind === "auth" };
      }
      await store.put({ ...item, status: err.kind === "conflict" ? "conflict" : "failed", error: err.message, attempts: item.attempts + 1 });
    }
  }
  return { sent, stopped: false, needsSignIn: false };
}

/** The PM's decision on a held item: keep mine (send it again, overwriting) or discard mine. */
export async function resolveConflict(store: OutboxStore, id: string, choice: "keep" | "discard"): Promise<void> {
  const item = (await store.all()).find(i => i.id === id);
  if (!item) return;
  if (choice === "discard") return store.remove(id);
  const input = { ...(item.input as Record<string, unknown>) };
  delete input.baseUpdatedAt;
  await store.put({ ...item, input, status: "pending", error: null });
}

/** Try a refused item again as it is (e.g. after the job's settings changed). */
export async function retryItem(store: OutboxStore, id: string): Promise<void> {
  const item = (await store.all()).find(i => i.id === id);
  if (item) await store.put({ ...item, status: "pending", error: null });
}
