import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Optional icon tile shown beside the title. */
  icon?: React.ReactNode;
  testId?: string;
}

/**
 * Minimal accessible modal: backdrop, Escape and backdrop click close it,
 * focus moves inside on open and returns on close. Themed by the app tokens.
 */
export function Dialog({ open, onClose, title, description, children, icon, testId }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4" data-testid={testId}>
      <div className="absolute inset-0 bg-summary/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={testId ? `${testId}-title` : undefined}
        tabIndex={-1}
        className="relative w-full max-w-md bg-card text-card-foreground rounded-2xl border border-border shadow-card p-6 outline-none animate-in fade-in zoom-in-95 duration-150"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-4 pr-6">
          {icon && <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h3 id={testId ? `${testId}-title` : undefined} className="text-lg font-bold text-foreground leading-snug">{title}</h3>
            {description && <div className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</div>}
          </div>
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}

/** Button row used inside dialogs: secondary actions first, the primary action last. */
export function DialogActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end gap-2", className)}>{children}</div>;
}

export const dialogButton = {
  primary: "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed",
  secondary: "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-border text-secondary-foreground hover:bg-muted transition-colors disabled:opacity-50",
  destructive: "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-70 disabled:cursor-not-allowed",
};
