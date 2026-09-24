import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

export interface SourceMenuItem {
  label: string;
  icon?: React.ReactNode;
  /** Navigate here when chosen. */
  href?: string;
  /** Or run this when chosen. */
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * Compact "⋯" management menu for a Data Source card. Keyboard: Enter/Space
 * opens, arrows move, Escape closes. Clicks inside never bubble to the card,
 * so opening the menu never starts a quote.
 */
export function SourceMenu({ items, label, testId }: { items: SourceMenuItem[]; label: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? els[(i + 1) % els.length] : els[(i - 1 + els.length) % els.length];
        next?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const first = root.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={root} className="relative" onClick={stop} data-testid={testId}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
          open && "bg-muted text-foreground",
        )}
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full mt-1 z-50 min-w-[13rem] bg-card border border-border rounded-xl shadow-popover p-1 animate-in fade-in zoom-in-95 duration-100"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                if (item.href) navigate(item.href);
                item.onSelect?.();
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg text-left transition-colors focus:outline-none focus-visible:bg-muted disabled:opacity-50",
                item.destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted",
              )}
            >
              {item.icon && <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-80">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
