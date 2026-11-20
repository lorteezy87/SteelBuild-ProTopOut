import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
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
  it("reads the exact mirrored cookie format used by main.tsx", async () => {
    getItem.mockReturnValue(`other=ignore;  ${COOKIE_NAME}=signed.token=ending; another=value`);
    await authFetch("/api/drawings/rev/1/pdf");
    expect(getItem).toHaveBeenCalledWith("manus-cookie");
    expect(sentHeaders().get("Authorization")).toBe("Bearer signed.token=ending");
    expect(request.mock.calls[0][1].credentials).toBe("include");
  });

  it("adds bearer authentication to absolute same-origin preview URLs too", async () => {
    getItem.mockReturnValue(`${COOKIE_NAME}=token`);
    await authFetch("https://app.example/api/drawings/rev/2/preview");
    expect(sentHeaders().get("Authorization")).toBe("Bearer token");
  });

  it.each([null, "other=token", `${COOKIE_NAME}=`, `wrong_${COOKIE_NAME}=token`])("falls back to cookies when the mirrored session is absent (%s)", async value => {
    getItem.mockReturnValue(value);
    await authFetch("/api/drawings/rev/1/pdf");
    expect(sentHeaders().has("Authorization")).toBe(false);
    expect(request.mock.calls[0][1].credentials).toBe("include");
  });

  it("handles blocked sessionStorage without failing the request", async () => {
    getItem.mockImplementation(() => { throw new Error("Storage blocked"); });
    await expect(authFetch("/api/drawings/rev/1/pdf")).resolves.toBeInstanceOf(Response);
    expect(sentHeaders().has("Authorization")).toBe(false);
  });

  it("preserves existing headers and request options without mutating init", async () => {
    getItem.mockReturnValue(`${COOKIE_NAME}=mirrored`);
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

  it.each(["https://storage.example/file", "//storage.example/file", "data:text/plain,hello"])("does not leak the bearer token to %s", async url => {
    getItem.mockReturnValue(`${COOKIE_NAME}=secret`);
    await authFetch(url);
    expect(sentHeaders().has("Authorization")).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("rereads the session for each fetch rather than caching a stale token", async () => {
    getItem.mockReturnValueOnce(`${COOKIE_NAME}=first`).mockReturnValueOnce(`${COOKIE_NAME}=replacement`);
    await authFetch("/api/drawings/rev/1/pdf");
    await authFetch("/api/drawings/rev/1/pdf");
    expect(request.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer first");
    expect(request.mock.calls[1][1].headers.get("Authorization")).toBe("Bearer replacement");
  });
});
