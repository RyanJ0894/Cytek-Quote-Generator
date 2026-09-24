import React from "react";
import { Link } from "wouter";
import { Database } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import logoLight from "@/assets/evans-logo-light.png";
import logoDark from "@/assets/evans-logo-dark.png";

/**
 * Application identity: the Evans Quote Generator logo, in the variant made
 * for the current theme (navy lettering on light, metallic lettering on dark).
 * Both images are the official assets cropped to the same box, so the header
 * keeps exactly the same size and alignment when the theme changes; the
 * theme's `dark` class simply picks which one is shown.
 */
export function AppIdentity() {
  return (
    <Link href="/" title="Home" className="flex items-center select-none rounded-md" data-testid="app-identity">
      <img
        src={logoLight}
        alt="Evans Quote Generator"
        width={720}
        height={195}
        decoding="async"
        className="block h-9 sm:h-10 w-auto dark:hidden"
        data-testid="logo-light"
      />
      <img
        src={logoDark}
        alt="Evans Quote Generator"
        width={720}
        height={195}
        decoding="async"
        className="hidden h-9 sm:h-10 w-auto dark:block"
        data-testid="logo-dark"
      />
    </Link>
  );
}

/** Shared sticky header: app identity (home), page-specific actions, theme toggle, Data Sources link. */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          <AppIdentity />
          <div className="flex items-center gap-1 sm:gap-2">
            {children}
            <Link
              href="/data-sources"
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              title="Manage the Sources of Truth (data + quote profile) used for quoting"
            >
              <Database className="w-4 h-4" /> <span className="hidden sm:inline">Data Sources</span>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}

/** Small header action link (back / navigation) styled the same on every page. */
export function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors whitespace-nowrap"
    >
      {children}
    </Link>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background">
      {children}
    </div>
  );
}
