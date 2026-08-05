"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Theme = "light" | "dark" | "dusk";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "henri-theme";

/* Apply both `data-theme` (Tailwind v4 token resolution) AND
 * `style.colorScheme` (browser UA-chrome adoption: form-controls,
 * native scrollbars on Chromium/Safari, autofill highlights). Without
 * `colorScheme`, native `<select>` open panels render with the OS
 * light theme even when our tokens are dark — causes white-on-white
 * dropdown text in dusk/dark mode. Added 2026-04-26 alongside the
 * global themed scrollbar in globals.css. */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme =
    theme === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // Sync from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored && ["light", "dark", "dusk"].includes(stored)) {
        // Mount-once hydration from localStorage; cannot derive at render (SSR mismatch)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeState(stored);
        applyTheme(stored);
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setThemeState("dark");
        applyTheme("dark");
      } else {
        applyTheme("light");
      }
    } catch {
      // localStorage / matchMedia can throw (Safari private mode, sandboxed
      // iframes). Theme is cosmetic, so we intentionally swallow and let the
      // SSR default (light) stand rather than crash the provider.
      applyTheme("light");
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) applyTheme(theme);
  }, [theme, mounted]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
