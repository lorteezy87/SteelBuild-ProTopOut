/** IndexedDB on this device: the outbox, its clientKey → server id map, and the cached job data. */
import type { OutboxItem, OutboxStore } from "./outbox";

const DB = "topout-offline";
const VERSION = 1;
const OUTBOX = "outbox";
const KEYS = "keys";
const CACHE = "cache";

let opening: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "id" });
        if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    });
  }
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

const listeners = new Set<() => void>();
/** Fires after any outbox change on this page (the sync badge listens). */
export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach(f => f());

export function idbStore(): OutboxStore {
  return {
    all: async () => ((await run(OUTBOX, "readonly", s => s.getAll())) as OutboxItem[]).sort((a, b) => a.createdAt - b.createdAt),
    put: async item => {
      await run(OUTBOX, "readwrite", s => s.put(item));
      changed();
    },
    remove: async id => {
      await run(OUTBOX, "readwrite", s => s.delete(id));
      changed();
    },
    getMap: async k => (await run(KEYS, "readonly", s => s.get(k))) as number | undefined,
    setMap: async (k, id) => void (await run(KEYS, "readwrite", s => s.put(id, k))),
  };
}

export const cacheGet = <T>(key: string) => run(CACHE, "readonly", s => s.get(key)) as Promise<T | undefined>;
export const cacheSet = (key: string, value: unknown) => run(CACHE, "readwrite", s => s.put(value, key)).then(() => undefined);
export const cacheDel = (key: string) => run(CACHE, "readwrite", s => s.delete(key)).then(() => undefined);
