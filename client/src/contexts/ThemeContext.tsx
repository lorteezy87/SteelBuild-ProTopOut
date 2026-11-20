import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import { applyTheme, isTheme, persistTheme, readTheme, resolveTheme, THEME_MEDIA_QUERY, THEME_STORAGE_KEY, type ResolvedTheme, type Theme } from "@/lib/theme";

export type { Theme, ResolvedTheme } from "@/lib/theme";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({ children, defaultTheme = "light", switchable = true }: ThemeProviderProps) {
  const [theme, updateTheme] = useState<Theme>(() => switchable ? readTheme(defaultTheme) : defaultTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(THEME_MEDIA_QUERY).matches);
  const resolvedTheme = resolveTheme(theme, systemDark);

  // The head bootstrap and synchronous setters prevent a palette flash.
  useLayoutEffect(() => { applyTheme(resolvedTheme); }, [resolvedTheme]);

  useEffect(() => {
    const media = window.matchMedia(THEME_MEDIA_QUERY);
    const change = (event: MediaQueryListEvent) => {
      if (theme === "system") applyTheme(resolveTheme(theme, event.matches));
      setSystemDark(event.matches);
    };
    setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [theme]);

  useEffect(() => {
    if (!switchable) return;
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        const next = isTheme(event.newValue) ? event.newValue : defaultTheme;
        applyTheme(resolveTheme(next, window.matchMedia(THEME_MEDIA_QUERY).matches));
        updateTheme(next);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [defaultTheme, switchable]);

  const setTheme = (next: Theme) => {
    if (!switchable) return;
    persistTheme(next);
    // Apply synchronously so concrete SVG colors are read from the new palette on render.
    applyTheme(resolveTheme(next, window.matchMedia(THEME_MEDIA_QUERY).matches));
    updateTheme(next);
  };
  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
