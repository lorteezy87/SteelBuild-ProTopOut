import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "./authFetch";

let request: ReturnType<typeof vi.fn>;
let getItem: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn().mockResolvedValue(new Response("ok"));
  getItem = vi.fn();
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("location", { href: "https://app.example/jobs/1", origin: "https://app.example" });
  vi.stubGlobal("sessionStorage", { getItem });
});
afterEach(() => vi.unstubAllGlobals());

const sentHeaders = () => request.mock.calls[0][1].headers as Headers;

describe("drawing authFetch", () => {
  it("authenticates with the session cookie only", async () => {
    await authFetch("/api/drawings/rev/1/pdf");
    expect(request.mock.calls[0][1].credentials).toBe("include");
    expect(sentHeaders().has("Authorization")).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("preserves existing headers and request options without mutating init", async () => {
    const headers = new Headers({ Authorization: "Bearer explicit", "If-None-Match": '"tag"' });
    const controller = new AbortController();
    const init: RequestInit = { headers, method: "GET", signal: controller.signal, credentials: "omit" };
    await authFetch("/api/drawings/rev/1/pdf", init);
    expect(sentHeaders().get("Authorization")).toBe("Bearer explicit");
    expect(sentHeaders().get("If-None-Match")).toBe('"tag"');
    expect(sentHeaders()).not.toBe(headers);
    expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", signal: controller.signal, credentials: "include" });
    expect(init.credentials).toBe("omit");
  });
});
