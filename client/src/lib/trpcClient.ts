import { onlineManager } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

let probing: ReturnType<typeof setInterval> | null = null;

/**
 * A request that never got an answer (dead zone, dropped signal) marks the app offline even when the device
 * claims a connection, so cached screens pause and keep their data and saves go to the outbox. A light health
 * check brings it back online.
 */
function markUnreachable() {
  onlineManager.setOnline(false);
  if (probing) return;
  probing = setInterval(async () => {
    try {
      const r = await globalThis.fetch("/api/health", { cache: "no-store" });
      if (r.ok) {
        clearInterval(probing!);
        probing = null;
        onlineManager.setOnline(true);
      }
    } catch {
      /* still unreachable */
    }
  }, 10_000);
}

async function fetchOrMarkOffline(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
  } catch (e) {
    if (!(init?.signal as AbortSignal | undefined)?.aborted) markUnreachable();
    throw e;
  }
}

/**
 * Weather calls wait on the National Weather Service, so they go on their own requests: a batch answers only
 * when every call in it is done, and a slow NWS must not hold up the report's sequences or the report list.
 */
export const trpcLinks = () => [
  splitLink({
    condition: op => op.path.startsWith("weather."),
    true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: fetchOrMarkOffline }),
    false: httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: fetchOrMarkOffline }),
  }),
];

/** Plain client for the offline sync runner (outside React, and never paused by React Query's offline mode). */
export const vanillaTrpc = createTRPCClient<AppRouter>({ links: trpcLinks() });
