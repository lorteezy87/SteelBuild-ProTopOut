import { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { readCssToken } from "@/lib/theme";

/** Pass a stable module-level token-name array; concrete colors refresh on resolved theme changes. */
export function useThemeTokens<const T extends readonly `--${string}`[]>(names: T): Record<T[number], string> {
  const { resolvedTheme } = useTheme();
  return useMemo(() => Object.fromEntries(names.map(name => [name, readCssToken(name)])) as Record<T[number], string>, [names, resolvedTheme]);
}
