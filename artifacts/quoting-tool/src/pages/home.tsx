import React from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Database, ChevronRight, Star, Loader2, PlusCircle } from "lucide-react";
import { useListDataSources } from "@workspace/api-client-react";
import { AppHeader, PageShell } from "@/components/AppHeader";

/**
 * Home: "Create a Quote" by picking the saved Data Source to quote from.
 * Selecting one goes straight into Manual Quote for that source. Uploading
 * workbooks is a maintenance task that lives on the Data Sources page only.
 */
export default function Home() {
  const { data, isLoading, error } = useListDataSources();
  const sources = data?.dataSources ?? [];

  return (
    <PageShell>
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading data sources…
          </div>
        )}

        {error && (
          <div className="bg-destructive/5 border border-destructive/30 text-destructive rounded-2xl p-6 text-sm">
            Could not load data sources. Refresh the page or check the server.
          </div>
        )}

        {data && sources.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto text-center">
            <div className="bg-card rounded-2xl border border-border shadow-xl shadow-slate-200/50 p-10">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-5">
                <Database className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 font-display mb-2">No Data Sources Yet</h2>
              <p className="text-slate-500 mb-6">Add your first Source of Truth to start creating quotes. Upload the workbook once; quotes never need it again.</p>
              <Link
                href="/data-sources"
                className="inline-flex items-center gap-2 py-3 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-blue-500 text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                <PlusCircle className="w-4 h-4" /> Add Data Source
              </Link>
            </div>
          </motion.div>
        )}

        {data && sources.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-slate-900 font-display mb-2">Create a Quote</h2>
              <p className="text-slate-500">Select the Data Source you want to use.</p>
            </div>

            <ul className="grid grid-cols-1 gap-4 max-w-2xl mx-auto" data-testid="source-picker">
              {sources.map((ds) => (
                <li key={ds.id}>
                  <Link
                    href={`/quote/${encodeURIComponent(ds.id)}`}
                    className="group flex items-center gap-4 bg-card rounded-2xl border border-border shadow-lg shadow-slate-200/50 px-6 py-5 hover:border-primary/50 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    data-testid={`pick-${ds.id}`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                      <Database className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold text-slate-900">{ds.name}</span>
                        {ds.isDefault && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                            <Star className="w-3 h-3" /> Default
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {ds.assetCount.toLocaleString()} assets · {ds.productCount.toLocaleString()} products · updated {new Date(ds.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors flex-shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>

            <p className="text-center text-xs text-muted-foreground mt-8">
              Need to add or update a source? Use <Link href="/data-sources" className="underline underline-offset-2 hover:text-slate-700">Data Sources</Link>.
            </p>
          </motion.div>
        )}
      </main>
    </PageShell>
  );
}
