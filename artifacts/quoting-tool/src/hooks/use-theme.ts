import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/**
 * Where the choice is saved. The inline script in index.html reads the same
 * key before first paint so a returning Dark Mode user never sees a flash of
 * Light Mode. Keep the two in sync.
 */
export const THEME_STORAGE_KEY = "eqg-theme";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readSaved(): Theme | null {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Apply a theme to the document (the `dark` class drives every token in index.css). */
function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The application theme.
 *
 * Resolution order: the user's saved choice (localStorage), else the
 * operating-system / browser `prefers-color-scheme`. Once the user picks a
 * theme it is saved and respected on every later visit; until then the app
 * follows the OS setting, live.
 *
 * This is the application chrome only. Generated quote PDFs are branded by
 * each Data Source's Quote Profile and never see this setting.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);

  const setTheme = useCallback((next: Theme) => {
    apply(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode / storage blocked: the choice still applies for this page */
    }
    notify();
  }, []);

  const toggle = useCallback(() => setTheme(current() === "dark" ? "light" : "dark"), [setTheme]);

  return { theme, setTheme, toggle };
}

/**
 * Keeps the document in step with the OS while no preference is saved, and
 * with other tabs when one is. Mount once, at the app root.
 */
export function useThemeSync() {
  useEffect(() => {
    // The inline script already applied the right theme; this is a safety net
    // for environments where it did not run (e.g. tests rendering the app alone).
    if (!document.documentElement.classList.contains("dark") && readSaved() === null && systemTheme() === "dark") {
      apply("dark");
      notify();
    }

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readSaved() === null) {
        apply(systemTheme());
        notify();
      }
    };
    media?.addEventListener?.("change", onSystemChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      apply(readSaved() ?? systemTheme());
      notify();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      media?.removeEventListener?.("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}
