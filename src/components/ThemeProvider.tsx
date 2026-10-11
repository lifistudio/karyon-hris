"use client";

import React, { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { runThemeTransition } from "@/lib/theme-transition";

export type Theme = "light" | "dark";

const STORAGE_KEY = "hris-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

/**
 * Inline script injected before paint so the correct theme class is on <html>
 * from the very first frame — this is what removes the white/dark flash that
 * per-page `useEffect` theme toggles always produce.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY
)});if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}document.documentElement.style.colorScheme=t;}catch(e){}})();`;

const listeners = new Set<() => void>();

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(next: Theme) {
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.style.colorScheme = next;
}

function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const syncExternalPreference = () => {
    let stored: Theme | null = null;
    try {
      const preference = localStorage.getItem(STORAGE_KEY);
      stored = preference === "light" || preference === "dark" ? preference : null;
    } catch {
      // Storage can be unavailable in hardened/private browser modes.
    }
    const next = stored ?? (media.matches ? "dark" : "light");
    applyTheme(next);
    listener();
  };
  window.addEventListener("storage", syncExternalPreference);
  media.addEventListener("change", syncExternalPreference);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", syncExternalPreference);
    media.removeEventListener("change", syncExternalPreference);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, currentTheme, () => "light");

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — the in-memory theme still applies */
    }
    const update = () => { applyTheme(next); listeners.forEach((listener) => listener()); };
    runThemeTransition(update);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
