import React from "react";
import { Link } from "wouter";
import { Database, Sparkles } from "lucide-react";
import { activeCompany } from "@workspace/config";

/** Shared sticky header: logo (home), page-specific actions, Data Sources link. */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" title="Home">
            <img
              src={`/${activeCompany.logo.fileName}`}
              alt={`${activeCompany.shortName} Quote Generator`}
              className="h-10 w-auto object-contain"
            />
          </Link>

          <div className="flex items-center gap-3">
            {children}
            <Link
              href="/data-sources"
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title="Manage the Sources of Truth (asset and pricing data) used for quoting"
            >
              <Database className="w-4 h-4" /> Data Sources
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
              <Sparkles className="w-4 h-4 text-amber-500" />
              FSE Portal
            </div>
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
