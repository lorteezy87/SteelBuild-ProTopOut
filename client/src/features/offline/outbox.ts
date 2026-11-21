/**
 * Offline outbox: daily-report saves and photo uploads made without signal wait here (IndexedDB on the
 * tablet) and are sent in order when the network is back. Nothing leaves the outbox unsent unless the PM
 * discards it; a refusal or a two-device conflict is kept for the PM to decide.
 *
 * Every change to an item is one atomic read-modify-write (`update`), and each item carries a revision that
 * a later save bumps. A send only removes the item if nothing newer was saved while it was in flight.
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
  /** Bumped by every save merged into this item. */
  rev: number;
};

/** What a synced report is known as on the server, and the save revision this device last wrote to it. */
export type MappedReport = { id: number; rev: string | null };

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  /** Atomic read-modify-write of one item. Return undefined to delete it. Resolves to the stored result. */
  update(id: string, fn: (cur: OutboxItem | undefined) => OutboxItem | undefined): Promise<OutboxItem | undefined>;
  getMap(clientKey: string): Promise<MappedReport | undefined>;
  setMap(clientKey: string, value: MappedReport): Promise<void>;
}

export function memoryStore(): OutboxStore {
  const items = new Map<string, OutboxItem>();
  const map = new Map<string, MappedReport>();
  return {
    all: async () => [...items.values()].sort((a, b) => a.createdAt - b.createdAt).map(i => structuredClone(i)),
    update: async (id, fn) => {
      const cur = items.get(id);
      const next = fn(cur ? structuredClone(cur) : undefined);
      if (next) items.set(id, structuredClone(next));
      else items.delete(id);
      return next ? structuredClone(next) : undefined;
    },
    getMap: async k => map.get(k),
    setMap: async (k, v) => void map.set(k, v),
  };
}

type NewItem = Omit<OutboxItem, "status" | "error" | "attempts" | "createdAt" | "rev"> & { createdAt?: number };
type Input = Record<string, unknown>;

/** Queue an item. A later save of the same report replaces the queued one (keeping its place and the version it was edited from). */
export async function enqueue(store: OutboxStore, item: NewItem): Promise<OutboxItem> {
  const stored = await store.update(item.id, existing => {
    if (!existing) return { ...item, createdAt: item.createdAt ?? Date.now(), status: "pending", error: null, attempts: 0, rev: 1 };
    const prev = (existing.input ?? {}) as Input;
    const input = { ...(item.input as Input) };
    // The queued copy was edited from `prev`'s base; a merged edit builds on the same one.
    for (const k of ["baseRev", "id"]) {
      if (k in prev) input[k] = prev[k];
      else if (k === "baseRev") delete input[k];
    }
    if ("id" in prev) delete input.clientKey;
    const held = existing.status === "conflict";
    return { ...existing, label: item.label, input, rev: existing.rev + 1, status: held ? "conflict" : "pending", error: held ? existing.error : null };
  });
  return stored!;
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
  for (const { id } of await store.all()) {
    const cur = (await store.all()).find(i => i.id === id);
    if (!cur || (cur.status !== "pending" && cur.status !== "syncing")) continue;
    let parentId: number | undefined;
    if (cur.dependsOn) {
      parentId = (await store.getMap(cur.dependsOn))?.id;
      if (parentId == null) {
        const parentQueued = (await store.all()).some(i => i.clientKey === cur.dependsOn && i.kind === "dailySave");
        if (parentQueued) continue;
        await store.update(id, c => c && { ...c, status: "failed", error: "The report this photo belonged to was discarded before it synced." });
        continue;
      }
    }
    const item = await store.update(id, c => c && { ...c, status: "syncing" });
    if (!item) continue;
    try {
      const res = await send(item, parentId);
      const input = (item.input ?? {}) as Input;
      const saveRev = typeof input.saveRev === "string" ? input.saveRev : null;
      if (item.kind === "dailySave") await store.setMap(item.clientKey, { id: res.id, rev: saveRev });
      await store.update(id, c => {
        if (!c || c.rev === item.rev) return undefined; // sent as stored: done
        // A newer save arrived while this one was in flight: keep it, as an edit of what was just stored.
        const next: Input = { ...(c.input as Input), id: res.id, ...(saveRev ? { baseRev: saveRev } : {}) };
        delete next.clientKey;
        return { ...c, input: next, status: c.status === "syncing" ? "pending" : c.status };
      });
      sent++;
    } catch (e) {
      const err = isSendError(e) ? e : classify(e);
      if (err.kind === "network" || err.kind === "auth") {
        await store.update(id, c => c && { ...c, status: c.status === "syncing" ? "pending" : c.status, attempts: c.attempts + 1 });
        return { sent, stopped: true, needsSignIn: err.kind === "auth" };
      }
      await store.update(id, c => c && { ...c, status: err.kind === "conflict" ? "conflict" : "failed", error: err.message, attempts: c.attempts + 1 });
    }
  }
  return { sent, stopped: false, needsSignIn: false };
}

/** The PM's decision on a held item: keep mine (send it again, overwriting) or discard mine. */
export async function resolveConflict(store: OutboxStore, id: string, choice: "keep" | "discard"): Promise<void> {
  await store.update(id, c => {
    if (!c || choice === "discard") return undefined;
    const input = { ...(c.input as Input) };
    delete input.baseRev;
    return { ...c, input, status: "pending", error: null };
  });
}

/** Try a refused item again as it is (e.g. after the job's settings changed). */
export async function retryItem(store: OutboxStore, id: string): Promise<void> {
  await store.update(id, c => c && { ...c, status: "pending", error: null });
}
