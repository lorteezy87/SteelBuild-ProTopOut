import { COOKIE_NAME } from "@shared/const";

/** Same sessionStorage key and cookie-pair format as main.tsx's tRPC headers. */
function previewBearerToken(): string | undefined {
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (raw) {
      const prefix = `${COOKIE_NAME}=`;
      const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
      return pair?.trim().slice(prefix.length) || undefined;
    }
  } catch {
    // Storage may be blocked; regular cookie authentication still works.
  }
  return undefined;
}

/** Authenticated app-origin requests; never forward the Preview token to another origin. */
export function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const sameOrigin = typeof location !== "undefined" && new URL(url, location.href).origin === location.origin;
  if (sameOrigin && !headers.has("Authorization")) {
    const token = previewBearerToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return globalThis.fetch(url, { ...init, headers, credentials: "include" });
}
