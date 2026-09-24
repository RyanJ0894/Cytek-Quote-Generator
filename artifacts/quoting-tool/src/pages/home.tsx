import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Database, ChevronRight, Loader2, PlusCircle, AlertTriangle, Settings2, BadgeCheck, RefreshCw, Trash2, FileText } from "lucide-react";
import { useListDataSources, type DataSourceSummary } from "@workspace/api-client-react";
import { AppHeader, PageShell } from "@/components/AppHeader";
import { SourceMenu } from "@/components/SourceMenu";
import { DefaultBadge, ProfileBadge } from "@/components/SourceStatus";
import { Dialog, DialogActions, dialogButton } from "@/components/ui/dialog";
import { useDataSourceActions } from "@/hooks/use-data-source-actions";
import { managePath, profilePath, quotePath } from "@/lib/api";

/**
 * Home: "Create a Quote" by picking the saved Data Source to quote from.
 * A fully configured source goes straight into Manual Quote. A source whose
 * Quote Profile is incomplete first asks to finish setting it up. Each card
 * also carries a compact management menu; uploading workbooks lives on the
 * Data Sources page only.
 */
export default function Home() {
  const { data, isLoading, error } = useListDataSources();
  const sources = data?.dataSources ?? [];
  const [, navigate] = useLocation();
  const actions = useDataSourceActions();
  const [setupPrompt, setSetupPrompt] = useState<DataSourceSummary | null>(null);

  const open = (ds: DataSourceSummary) => {
    if (ds.quoteProfile.complete) navigate(quotePath(ds.id));
    else setSetupPrompt(ds);
  };

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
            <div className="bg-card rounded-2xl border border-border shadow-card p-10">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-5">
                <Database className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-foreground font-display mb-2">No Data Sources Yet</h2>
              <p className="text-muted-foreground mb-6">Add your first Source of Truth to start creating quotes. Upload the workbook once; quotes never need it again.</p>
              <Link
                href="/data-sources"
                className="inline-flex items-center gap-2 py-3 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                <PlusCircle className="w-4 h-4" /> Add Data Source
              </Link>
            </div>
          </motion.div>
        )}

        {data && sources.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            {/* One primary instruction: the sentence is the heading, with the action carrying the emphasis. */}
            <h2 className="text-center text-xl sm:text-2xl font-medium tracking-tight text-foreground font-display mb-8 max-w-2xl mx-auto" data-testid="home-instruction">
              Select the Data Source you want to use and <span className="font-bold text-primary whitespace-nowrap">Create a Quote</span>.
            </h2>

            <ul className="grid grid-cols-1 gap-4 max-w-2xl mx-auto" data-testid="source-picker">
              {sources.map((ds) => (
                <li key={ds.id} className="relative">
                  {/* The card body starts a quote; the ⋯ menu manages the source without leaving the page. */}
                  <button
                    type="button"
                    onClick={() => open(ds)}
                    className="group w-full text-left flex items-center gap-4 bg-card rounded-2xl border border-border shadow-card-sm pl-6 pr-16 py-5 hover:border-primary/50 hover:shadow-card hover:-translate-y-0.5 transition-all"
                    data-testid={`pick-${ds.id}`}
                    title={ds.quoteProfile.complete ? `Create a quote from ${ds.name}` : `${ds.name} still needs its Quote Profile`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                      <Database className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold text-foreground">{ds.name}</span>
                        {ds.isDefault && <DefaultBadge />}
                        {!ds.quoteProfile.complete && <ProfileBadge ds={ds} short />}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {ds.quoteProfile.companyName ? `Quotes from ${ds.quoteProfile.companyName} · ` : ""}
                        {ds.assetCount.toLocaleString()} assets · {ds.productCount.toLocaleString()} products · updated {new Date(ds.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                  </button>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <SourceMenu
                      label={`Manage ${ds.name}`}
                      testId={`menu-${ds.id}`}
                      items={[
                        { label: "Create Quote", icon: <FileText className="w-4 h-4" />, href: quotePath(ds.id) },
                        { label: "Edit Data Source", icon: <Settings2 className="w-4 h-4" />, href: managePath(ds.id) },
                        { label: "Edit Quote Profile", icon: <BadgeCheck className="w-4 h-4" />, href: profilePath(ds.id) },
                        { label: "Update Source Workbook", icon: <RefreshCw className="w-4 h-4" />, onSelect: () => actions.replaceWorkbook(ds), disabled: actions.busy !== null },
                        { label: "Delete Data Source", icon: <Trash2 className="w-4 h-4" />, onSelect: () => actions.confirmDelete(ds), destructive: true, disabled: actions.busy !== null },
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <p className="text-center text-xs text-muted-foreground mt-8">
              Need to add or update a source? Use <Link href="/data-sources" className="underline underline-offset-2 hover:text-foreground">Data Sources</Link>.
            </p>
          </motion.div>
        )}
      </main>

      {actions.elements}

      {/* Incomplete source: make finishing the Quote Profile the obvious next step, without hard-blocking. */}
      <Dialog
        open={setupPrompt !== null}
        onClose={() => setSetupPrompt(null)}
        title={`Finish setting up ${setupPrompt?.name ?? ""}`}
        description={
          <>
            Complete the Quote Profile so generated quotes contain the correct company information and branding.
            {setupPrompt && setupPrompt.quoteProfile.missing.length > 0 && (
              <span className="block mt-2 text-xs">Still missing: {setupPrompt.quoteProfile.missing.join(", ")}.</span>
            )}
          </>
        }
        icon={<AlertTriangle className="w-5 h-5" />}
        testId="setup-prompt"
      >
        <DialogActions>
          <button type="button" className={dialogButton.secondary} onClick={() => setupPrompt && navigate(quotePath(setupPrompt.id))} data-testid="continue-anyway">
            Continue to Quote Anyway
          </button>
          <button type="button" className={dialogButton.primary} onClick={() => setupPrompt && navigate(profilePath(setupPrompt.id, true))} data-testid="complete-profile" data-autofocus>
            Complete Quote Profile
          </button>
        </DialogActions>
      </Dialog>
    </PageShell>
  );
}
