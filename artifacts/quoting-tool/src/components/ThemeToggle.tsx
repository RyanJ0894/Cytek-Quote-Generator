import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

/** Compact sun/moon switch for the application theme (Light / Dark). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-theme={theme}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      <Sun className={`absolute w-[18px] h-[18px] transition-all duration-200 ${isDark ? "scale-0 -rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"}`} aria-hidden="true" />
      <Moon className={`absolute w-[18px] h-[18px] transition-all duration-200 ${isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 rotate-90 opacity-0"}`} aria-hidden="true" />
    </button>
  );
}
