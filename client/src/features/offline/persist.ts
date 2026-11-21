/** Keeps the job data a daily report needs on this device, so the editor opens with no signal. */
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { cacheDel, cacheGet, cacheSet } from "./idbStore";

/** tRPC procedures whose last answer is kept on the device. Money screens stay online-only. */
const KEEP = new Set(["auth.me", "ref.all", "projects.get", "projects.list", "tasks.list", "daily.list", "daily.get", "daily.production", "photos.list", "collab.documents", "weather.day", "today.summary"]);

export function shouldPersistQuery(queryKey: readonly unknown[], status: string): boolean {
  if (status !== "success") return false;
  const path = queryKey[0];
  return Array.isArray(path) && KEEP.has(path.join("."));
}

const KEY = "react-query";
export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const idbPersister: Persister = {
  persistClient: (client: PersistedClient) => cacheSet(KEY, client),
  restoreClient: () => cacheGet<PersistedClient>(KEY),
  removeClient: () => cacheDel(KEY),
};
