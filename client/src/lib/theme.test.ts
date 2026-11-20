import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyTheme, contrastRatio, isTheme, persistTheme, readableDataColor, readTheme, resolveTheme } from "./theme";

const root = path.resolve(import.meta.dirname, "../../..");
const css = readFileSync(path.join(root, "client/src/index.css"), "utf8");
const html = readFileSync(path.join(root, "client/index.html"), "utf8");
const tokens = (selector: string) => Object.fromEntries([...css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));
const light = tokens(":root");
const dark = tokens("\\.dark");
function value(palette: Record<string, string>, token: string): string {
  const raw = palette[token] ?? light[token];
  return raw.startsWith("var(") ? value(palette, raw.slice(4, -1)) : raw;
}

afterEach(() => vi.unstubAllGlobals());

describe("executive theme palette", () => {
  it("explicitly defines every existing SteelBuild token and semantic shadcn color in dark mode", () => {
    for (const token of Object.keys(light)) {
      if (token !== "--radius") expect(dark, token).toHaveProperty(token);
    }
  });

  for (const [name, palette] of Object.entries({ light, dark })) {
    it(`${name}: primary, secondary, muted, and link text pass on every work surface`, () => {
      const surfaces = ["--tp-bone", "--tp-paper", "--tp-raised", "--tp-surface", "--tp-gray-soft", "--tp-accent-soft", "--tp-green-soft", "--tp-amber-soft", "--tp-red-soft", "--tp-blue-soft", "--tp-orange-soft"];
      for (const fg of ["--tp-ink", "--tp-ink-2", "--tp-muted", "--tp-accent-ink"]) {
        for (const bg of surfaces) {
          expect(contrastRatio(value(palette, fg), value(palette, bg)), `${fg} / ${bg}`).toBeGreaterThanOrEqual(fg === "--tp-ink" ? 7 : 4.5);
        }
      }
    });

    it(`${name}: all status pills, primary actions, and always-dark chrome pass`, () => {
      const pairs = [
        ["--tp-green", "--tp-green-soft"], ["--tp-amber", "--tp-amber-soft"], ["--tp-red-strong", "--tp-red-soft"],
        ["--tp-blue", "--tp-blue-soft"], ["--tp-ink-2", "--tp-gray-soft"], ["--tp-accent-ink", "--tp-accent-soft"],
        ["--tp-orange", "--tp-orange-soft"], ["--tp-solid-ink", "--tp-solid"], ["--tp-solid-ink", "--tp-hold"],
        ["--tp-solid-ink", "--tp-red-fill"], ["--primary-foreground", "--primary"], ["--primary-foreground", "--tp-accent-deep"],
        ["--tp-sidebar-muted", "--tp-graphite-3"], ["--tp-sidebar-link", "--tp-graphite-3"],
        ["--tp-sidebar-amber", "--tp-graphite-3"], ["--tp-sidebar-orange", "--tp-graphite-3"],
        ["--tp-brand", "--tp-graphite"], ["--tp-graphite", "--tp-brand"],
      ];
      for (const [fg, bg] of pairs) expect(contrastRatio(value(palette, fg), value(palette, bg)), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(value(palette, "--tp-drawing-paper")).toBe("#ffffff");
    });
  }
});

describe("appearance preferences", () => {
  it("accepts only Light, Dark, and System and resolves System from the OS", () => {
    expect([isTheme("light"), isTheme("dark"), isTheme("system")]).toEqual([true, true, true]);
    expect(isTheme("sepia")).toBe(false);
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("persists and reads the existing storage key, rejecting invalid saved values", () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem: () => "system", setItem } });
    expect(readTheme()).toBe("system");
    persistTheme("dark");
    expect(setItem).toHaveBeenCalledWith("theme", "dark");
    vi.stubGlobal("window", { localStorage: { getItem: () => "invalid" } });
    expect(readTheme()).toBe("light");
  });

  it("continues working when storage is unavailable", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(readTheme()).toBe("light");
    expect(() => persistTheme("dark")).not.toThrow();
  });

  it("applies the HTML dark class, native color scheme, and browser theme-color together", () => {
    const toggle = vi.fn(), setAttribute = vi.fn(), style = { colorScheme: "" };
    vi.stubGlobal("document", { documentElement: { classList: { toggle }, style }, querySelector: () => ({ setAttribute }) });
    applyTheme("dark");
    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(style.colorScheme).toBe("dark");
    expect(setAttribute).toHaveBeenCalledWith("content", "#0d1117");
    applyTheme("light");
    expect(toggle).toHaveBeenLastCalledWith("dark", false);
    expect(setAttribute).toHaveBeenLastCalledWith("content", "#f5f6f8");
  });

  it("head bootstrap applies the identical palette before React and styles load", () => {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('rel="stylesheet"'));
    for (const [saved, osDark, expected] of [["dark", false, true], ["light", true, false], ["system", true, true], ["system", false, false], ["invalid", true, false]] as const) {
      const toggle = vi.fn(), meta = { content: "" }, style = { colorScheme: "" };
      const document = { documentElement: { classList: { toggle }, style }, querySelector: () => meta };
      new Function("localStorage", "matchMedia", "document", script)({ getItem: () => saved }, () => ({ matches: osDark }), document);
      expect(toggle).toHaveBeenCalledWith("dark", expected);
      expect(meta.content).toBe(expected ? "#0d1117" : "#f5f6f8");
    }
  });

  it("guards admin-configured text colors without modifying the underlying color", () => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => value(dark, name) }));
    expect(readableDataColor("#101828")).toBe("#eef2f6");
    expect(readableDataColor("#86d9a0")).toBe("#86d9a0");
    expect(readableDataColor("not-a-color")).toBe("#eef2f6");
  });
});
