import React from "react";
import { Link } from "wouter";
import { Database } from "lucide-react";

/** Neutral application identity: this is the quoting app, not any one seller. */
export function AppIdentity() {
  return (
    <Link href="/" title="Home" className="flex flex-col leading-none select-none">
      <span className="text-xl font-extrabold tracking-[0.18em] text-slate-900 font-display">EVANS</span>
      <span className="text-[10px] font-semibold tracking-[0.22em] text-primary uppercase">Quote Generator</span>
    </Link>
  );
}

/** Shared sticky header: app identity (home), page-specific actions, Data Sources link. */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <AppIdentity />
          <div className="flex items-center gap-3">
            {children}
            <Link
              href="/data-sources"
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title="Manage the Sources of Truth (data + quote profile) used for quoting"
            >
              <Database className="w-4 h-4" /> Data Sources
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-slate-50 to-slate-50">
      {children}
    </div>
  );
}
