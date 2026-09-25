import React from "react";
import { Link, useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { useListDataSources } from "@workspace/api-client-react";
import { AppHeader, HeaderLink, PageShell } from "@/components/AppHeader";
import { QuoteForm } from "@/components/QuoteForm";
import { profilePath } from "@/lib/api";

/** Manual Quote for one Data Source (the id is in the URL, so every lookup is scoped to it). */
export default function QuotePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  const [, navigate] = useLocation();
  const { data, isLoading } = useListDataSources();
  const source = data?.dataSources.find((d) => d.id === id);

  return (
    <PageShell>
      <AppHeader>
        <HeaderLink href="/"><ArrowLeft className="w-4 h-4" /> New quote</HeaderLink>
      </AppHeader>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        )}

        {data && !source && (
          <div className="max-w-xl mx-auto bg-card rounded-2xl border border-border shadow-card p-8 text-center">
            <h2 className="text-xl font-bold text-foreground mb-2">Data source not found</h2>
            <p className="text-sm text-muted-foreground mb-4">It may have been deleted. Pick another source to create a quote.</p>
            <Link href="/" className="text-primary font-semibold underline underline-offset-2">Back to Create a Quote</Link>
          </div>
        )}

        {data && source && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-foreground font-display mb-2">Create New Quote</h2>
              <p className="text-muted-foreground">Select a serial number, part number or service and the details fill in from the selected Data Source. Everything stays editable.</p>
            </div>
            {!source.quoteProfile.complete && (
              <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3" role="status" data-testid="profile-incomplete-top">
                <AlertTriangle className="w-5 h-5 text-warning-foreground flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-foreground">Quote Profile incomplete</p>
                  <p className="text-muted-foreground">
                    {source.name} is missing company information and/or branding required for a finished quote
                    <span className="hidden sm:inline"> ({source.quoteProfile.missing.join(", ")})</span>. Quotes cannot be generated until it is complete.
                  </p>
                </div>
                <Link href={profilePath(source.id)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl transition-all whitespace-nowrap" data-testid="complete-profile-top">
                  Complete Quote Profile
                </Link>
              </div>
            )}
            <QuoteForm
              key={source.id}
              dataSourceId={source.id}
              sources={data.dataSources}
              onSwitch={(next) => navigate(`/quote/${encodeURIComponent(next)}`)}
            />
          </motion.div>
        )}
      </main>
    </PageShell>
  );
}
