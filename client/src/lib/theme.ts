export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

// Keep the existing preference key; the inline index.html bootstrap uses it too.
export const THEME_STORAGE_KEY = "theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
export const THEME_COLORS = { light: "#f5f6f8", dark: "#0d1117" } as const;

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function readTheme(defaultTheme: Theme = "light"): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : defaultTheme;
  } catch {
    return defaultTheme;
  }
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private/locked-down browsers still support an in-memory preference.
  }
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  root.style.backgroundColor = THEME_COLORS[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

/** Read on render/redraw, not at module scope. Returns a concrete color for canvas/SVG libraries. */
export function readCssToken(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace(/^#/, "");
    const full = value.length === 3 ? [...value].map(c => c + c).join("") : value;
    const channels = [0, 2, 4].map(i => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Preserve an admin-selected text hue only when it remains readable on every work surface. */
export function readableDataColor(color: string): string {
  const fallback = readCssToken("--tp-ink");
  if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color)) return fallback;
  const surfaces = ["--tp-paper", "--tp-bone", "--tp-raised", "--tp-gray-soft", "--tp-accent-soft"] as const;
  return surfaces.every(name => contrastRatio(color, readCssToken(name)) >= 4.5) ? color : fallback;
}
