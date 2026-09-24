import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/**
 * Where the choice is saved. The inline script in index.html reads the same
 * key before first paint so a returning user never sees a flash of the wrong
 * theme. Keep the two in sync.
 */
export const THEME_STORAGE_KEY = "eqg-theme";

/** Dark Mode is the default experience; only an explicit choice changes it. */
export const DEFAULT_THEME: Theme = "dark";

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
 * Resolution: the user's saved choice (localStorage), else Dark Mode. The
 * operating-system preference is deliberately not consulted. Once the user
 * picks Light or Dark it is saved and respected on every later visit.
 *
 * This is the application chrome only. Generated quote PDFs are branded by
 * each Data Source's Quote Profile and never see this setting.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => DEFAULT_THEME);

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
 * Keeps the document in step with the saved choice: applies it if the inline
 * script did not run (e.g. tests rendering the app alone) and follows changes
 * made in other tabs. Mount once, at the app root.
 */
export function useThemeSync() {
  useEffect(() => {
    const wanted = readSaved() ?? DEFAULT_THEME;
    if (current() !== wanted) {
      apply(wanted);
      notify();
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      apply(readSaved() ?? DEFAULT_THEME);
      notify();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
