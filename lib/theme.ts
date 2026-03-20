import type { ThemeMode } from "../types";

export const THEME_STORAGE_KEY = "humor_admin_theme";

export function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === "light" || value === "dark") return value;
  if (value === "system") return value;
  return "light";
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean) {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}
