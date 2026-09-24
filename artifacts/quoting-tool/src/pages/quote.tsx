import React from "react";
import { Link, useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useListDataSources } from "@workspace/api-client-react";
import { AppHeader, PageShell } from "@/components/AppHeader";
import { QuoteForm } from "@/components/QuoteForm";

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
        <Link
          href="/"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> New quote
        </Link>
      </AppHeader>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        )}

        {data && !source && (
          <div className="max-w-xl mx-auto bg-card rounded-2xl border border-border shadow-xl p-8 text-center">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Data source not found</h2>
            <p className="text-sm text-muted-foreground mb-4">It may have been deleted. Pick another source to create a quote.</p>
            <Link href="/" className="text-primary font-semibold underline underline-offset-2">Back to Create a Quote</Link>
          </div>
        )}

        {data && source && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-slate-900 font-display mb-2">Create New Quote</h2>
              <p className="text-slate-500">Type a serial number, part number or service and the details fill in from the selected Data Source. Everything stays editable.</p>
            </div>
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
