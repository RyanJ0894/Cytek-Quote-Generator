import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2, Building2, RefreshCw, Trash2, FileText, Star, Database, Pencil, Check, X, BadgeCheck } from "lucide-react";
import { useListDataSources } from "@workspace/api-client-react";
import { AppHeader, HeaderLink, PageShell } from "@/components/AppHeader";
import { DefaultBadge, ProfileBadge } from "@/components/SourceStatus";
import { useDataSourceActions } from "@/hooks/use-data-source-actions";
import { logoUrl, profilePath, quotePath } from "@/lib/api";

const input = "w-full px-3 py-2 rounded-xl border border-input bg-surface focus:bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const btn = "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border text-secondary-foreground hover:bg-muted disabled:opacity-50 transition-colors";

/**
 * Edit Data Source: manage the persistent Source of Truth itself (name,
 * workbook, counts, Quote Profile, deletion) without creating a quote.
 * Quote-level edits never touch anything shown here.
 */
export default function DataSourceManagePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  const [, navigate] = useLocation();
  const { data, isLoading } = useListDataSources();
  const ds = data?.dataSources.find((d) => d.id === id);
  const actions = useDataSourceActions({ onDeleted: () => navigate("/") });

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    if (ds && !editingName) setName(ds.name);
  }, [ds, editingName]);

  const saveName = async () => {
    if (!ds) return;
    const trimmed = name.trim();
    if (trimmed && trimmed !== ds.name) await actions.rename(ds, trimmed);
    setEditingName(false);
  };

  return (
    <PageShell>
      <AppHeader>
        <HeaderLink href="/"><ArrowLeft className="w-4 h-4" /> Create a quote</HeaderLink>
      </AppHeader>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

        {data && !ds && (
          <div className="bg-card rounded-2xl border border-border shadow-card p-8 text-center">
            <h2 className="text-xl font-bold text-foreground mb-2">Data source not found</h2>
            <p className="text-sm text-muted-foreground mb-4">It may have been deleted.</p>
            <Link href="/data-sources" className="text-primary font-semibold underline underline-offset-2">Go to Data Sources</Link>
          </div>
        )}

        {ds && (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Edit Data Source</p>
              <div className="flex items-center gap-3 flex-wrap">
                {editingName ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void saveName(); }}
                    className="flex items-center gap-2 flex-1 min-w-[16rem]"
                  >
                    <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} text-lg font-bold`} autoFocus aria-label="Data source name" data-testid="rename-input" />
                    <button type="submit" className={btn} disabled={actions.busy !== null} data-testid="rename-save"><Check className="w-4 h-4" /> Save</button>
                    <button type="button" className={btn} onClick={() => { setEditingName(false); setName(ds.name); }}><X className="w-4 h-4" /></button>
                  </form>
                ) : (
                  <>
                    <h2 className="text-3xl font-bold text-foreground font-display" data-testid="manage-name">{ds.name}</h2>
                    <button type="button" onClick={() => setEditingName(true)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted" title="Rename data source" aria-label="Rename data source" data-testid="rename-start">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {ds.isDefault && <DefaultBadge />}
                    <ProfileBadge ds={ds} short />
                  </>
                )}
              </div>
              <p className="text-muted-foreground mt-2">
                This is the persistent Source of Truth. Changes here affect every future quote from it; edits made while building a quote never change it.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href={quotePath(ds.id)} className="inline-flex items-center gap-2 py-2.5 px-5 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl transition-all" data-testid="manage-create-quote">
                <FileText className="w-4 h-4" /> Create Quote
              </Link>
              {!ds.isDefault && (
                <button type="button" className={btn} onClick={() => actions.setDefault(ds)} disabled={actions.busy !== null}>
                  <Star className="w-4 h-4" /> Set as default
                </button>
              )}
            </div>

            {/* Data */}
            <section className="bg-card rounded-2xl border border-border shadow-card overflow-hidden" data-testid="manage-data">
              <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Database className="w-5 h-5" /></div>
                <h3 className="text-lg font-bold text-foreground">Data</h3>
              </div>
              <dl className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source workbook</dt><dd className="text-foreground mt-0.5 break-words">{ds.sourceFiles.join(" + ")}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Imported</dt><dd className="text-foreground mt-0.5">{new Date(ds.importedAt).toLocaleString()}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assets</dt><dd className="text-foreground mt-0.5" data-testid="manage-assets">{ds.assetCount.toLocaleString()}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Products</dt><dd className="text-foreground mt-0.5" data-testid="manage-products">{ds.productCount.toLocaleString()}{ds.unpricedProductCount > 0 && <span className="text-muted-foreground"> ({ds.unpricedProductCount} without a list price)</span>}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last updated</dt><dd className="text-foreground mt-0.5">{new Date(ds.updatedAt).toLocaleString()}</dd></div>
              </dl>
              <div className="px-6 pb-5">
                <button type="button" className={btn} onClick={() => actions.replaceWorkbook(ds)} disabled={actions.busy !== null} data-testid="manage-replace">
                  <RefreshCw className="w-4 h-4" /> {actions.busy === `replace-${ds.id}` ? "Updating…" : "Update / replace workbook"}
                </button>
                <p className="text-xs text-muted-foreground mt-2">Re-imports the catalog and assets from a newer workbook. The name, id and Quote Profile are kept.</p>
              </div>
            </section>

            {/* Quote Profile */}
            <section className="bg-card rounded-2xl border border-border shadow-card overflow-hidden" data-testid="manage-profile">
              <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><BadgeCheck className="w-5 h-5" /></div>
                <h3 className="text-lg font-bold text-foreground">Quote Profile</h3>
                <div className="ml-auto"><ProfileBadge ds={ds} /></div>
              </div>
              <div className="px-6 py-5 flex items-start gap-4">
                {ds.quoteProfile.hasLogo ? (
                  <img src={logoUrl(ds.id)} alt="" className="h-12 max-w-[160px] object-contain flex-shrink-0 rounded bg-white p-1" title="Company logo (shown as it prints)" data-testid="manage-logo" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0" title="No company logo yet"><Building2 className="w-5 h-5" /></div>
                )}
                <div className="flex-1 min-w-0 text-sm">
                  {ds.quoteProfile.companyName ? (
                    <p className="text-foreground">
                      <span className="font-semibold">{ds.quoteProfile.companyName}</span>
                      {ds.quoteProfile.addressLine && <><br />{ds.quoteProfile.addressLine}</>}
                      {(ds.quoteProfile.phone || ds.quoteProfile.email || ds.quoteProfile.website) && (
                        <><br />{[ds.quoteProfile.phone, ds.quoteProfile.email, ds.quoteProfile.website].filter(Boolean).join(" · ")}</>
                      )}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">No seller identity yet. Quotes from this source cannot be generated until the profile is filled in.</p>
                  )}
                  {!ds.quoteProfile.hasLogo && ds.quoteProfile.companyName && <p className="text-muted-foreground mt-1">No company logo: the short name is printed instead.</p>}
                </div>
                <Link href={profilePath(ds.id)} className={btn} data-testid="manage-edit-profile">Edit Quote Profile</Link>
              </div>
            </section>

            {/* Danger zone */}
            <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <h3 className="font-bold text-foreground">Delete Data Source</h3>
                <p className="text-sm text-muted-foreground">Removes this source, its imported catalog/assets and its Quote Profile. You will be asked to confirm.</p>
              </div>
              <button type="button" onClick={() => actions.confirmDelete(ds)} disabled={actions.busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors" data-testid="manage-delete">
                <Trash2 className="w-4 h-4" /> Delete Data Source
              </button>
            </section>
          </>
        )}
      </main>
      {actions.elements}
    </PageShell>
  );
}
