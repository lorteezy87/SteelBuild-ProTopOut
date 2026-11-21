import { trpc } from "@/lib/trpc";
import { trpcLinks } from "@/lib/trpcClient";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import App from "./App";
import { idbPersister, PERSIST_MAX_AGE, shouldPersistQuery } from "./features/offline/persist";
import { startSync } from "./features/offline/sync";
import "./index.css";

// React Query assumes "online" until an event says otherwise; a page reloaded with no signal must start offline,
// so cached queries pause and keep their data instead of failing with "Failed to fetch".
onlineManager.setOnline(navigator.onLine);

// Kept as long as the on-device copy, so data cached for offline use isn't dropped from memory first.
const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: PERSIST_MAX_AGE } } });

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Session expired: refetching auth.me returns null and the app shows the sign-in screen.
  void queryClient.invalidateQueries({ queryKey: [["auth", "me"]] });
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({ links: trpcLinks() });

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(e => console.warn("[offline] service worker", e)));
}
startSync(queryClient);

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: PERSIST_MAX_AGE,
        buster: __BUILD_ID__,
        dehydrateOptions: { shouldDehydrateQuery: q => shouldPersistQuery(q.queryKey, q.state.status) },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </trpc.Provider>
);
