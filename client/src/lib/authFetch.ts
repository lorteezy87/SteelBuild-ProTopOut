/** Same-origin app requests authenticated by the session cookie. Copies headers so the caller's init is not mutated. */
export function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(url, { ...init, headers: new Headers(init.headers), credentials: "include" });
}
