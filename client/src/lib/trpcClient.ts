import { onlineManager } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
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

export const trpcLinks = () => [
  httpBatchLink({
    url: "/api/trpc",
    transformer: superjson,
    async fetch(input, init) {
      try {
        return await globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      } catch (e) {
        if (!(init?.signal as AbortSignal | undefined)?.aborted) markUnreachable();
        throw e;
      }
    },
  }),
];

/** Plain client for the offline sync runner (outside React, and never paused by React Query's offline mode). */
export const vanillaTrpc = createTRPCClient<AppRouter>({ links: trpcLinks() });
