import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

export const trpcLinks = () => [
  httpBatchLink({
    url: "/api/trpc",
    transformer: superjson,
    fetch(input, init) {
      return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
    },
  }),
];

/** Plain client for the offline sync runner (outside React, and never paused by React Query's offline mode). */
export const vanillaTrpc = createTRPCClient<AppRouter>({ links: trpcLinks() });
