import React, { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Database, Trash2, Upload, RefreshCw, Loader2, AlertTriangle, FileText, Building2, Settings2 } from "lucide-react";
import { useListDataSources, type DataSourceSummary } from "@workspace/api-client-react";
import { AppHeader, HeaderLink, PageShell } from "@/components/AppHeader";
import { DefaultBadge, ProfileBadge } from "@/components/SourceStatus";
import { useDataSourceActions } from "@/hooks/use-data-source-actions";
import { useToast } from "@/hooks/use-toast";
import { api, logoUrl, managePath, profilePath, quotePath } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Data Sources: the full management center. Each source is a persistent,
 * isolated Source of Truth (asset + pricing catalog) plus its Quote Profile.
 * Workbooks are uploaded here, once, and never on the quoting path. Adding a
 * source continues straight into completing its Quote Profile.
 */
export default function DataSourcesPage() {
  const { data, isLoading, error } = useListDataSources();
  const listError = error as { data?: { error?: string; storage?: { candidateVars?: string[]; selectedVar?: string | null } }; message?: string } | null;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const actions = useDataSourceActions();
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!name.trim()) return setFormError("Give the data source a name (e.g. \"Evans Medical\").");
    if (!file) return setFormError("Choose the workbook to import (.xlsx).");
    const body = new FormData();
    body.append("name", name.trim());
    body.append("file", file);
    setImporting(true);
    try {
      const imported: DataSourceSummary = await api("/data-sources", { method: "POST", body });
      setName("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await actions.refresh();
      toast({
        title: `Imported "${imported.name}"`,
        description: `${imported.assetCount.toLocaleString()} assets and ${imported.productCount.toLocaleString()} products (${imported.unpricedProductCount} without a list price). Next: complete its Quote Profile.`,
      });
      // Import Successful → Complete Quote Profile: the profile is part of creating a source.
      navigate(profilePath(imported.id, true));
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Import failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
    }
  };

  const busy = actions.busy !== null || importing;

  return (
    <PageShell>
      <AppHeader>
        <HeaderLink href="/"><ArrowLeft className="w-4 h-4" /> Create a quote</HeaderLink>
      </AppHeader>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-foreground font-display mb-2">Data Sources</h2>
          <p className="text-muted-foreground max-w-2xl">
            Each Data Source is a Source of Truth: one company's or dataset's assets, products and prices, plus the Quote Profile that brands its documents. Upload its workbook once here;
            it is normalized and saved, and quotes are created from it indefinitely without the spreadsheet. Come back to add, update or remove a source.
          </p>
        </div>

        {listError && (
          <div className="flex gap-3 items-start bg-destructive/10 border border-destructive/40 text-foreground rounded-xl p-4 text-sm" data-testid="storage-error">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-destructive" />
            <div>
              <p className="font-semibold">Could not load data sources.</p>
              <p className="text-muted-foreground">{listError.data?.error || listError.message}</p>
              {listError.data?.storage?.selectedVar && (
                <p className="text-muted-foreground mt-1">The server is trying to use the database from <code>{listError.data.storage.selectedVar}</code>. Check that variable's value in Vercel → Settings → Environment Variables, then redeploy.</p>
              )}
            </div>
          </div>
        )}

        {data && !data.persistent && (
          <div className="flex gap-3 items-start bg-warning/10 border border-warning/30 text-warning-foreground rounded-xl p-4 text-sm">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Persistent storage is not configured on this server.</p>
              <p>
                Data sources you add or change here live only in the memory of the server process that received them: they are lost when it restarts, and on serverless hosting
                other instances will not see them at all (lookups can fail with "Unknown data source" a moment after an import). The shipped Cytek — Current source is re-created each time.
                Connect a Postgres database and set <code>DATABASE_URL</code> (see the README) to enable saving.
              </p>
              <p className="mt-2 text-xs" data-testid="storage-diagnostics">
                {data.storage.candidateVars.length === 0 ? (
                  <>
                    This deployment's environment contains <strong>no database variables at all</strong> (looked for {data.storage.lookedFor.join(", ")}, prefixed variants and PGHOST/PGUSER/PGPASSWORD/PGDATABASE).
                    If a database is already connected in Vercel → Storage, its variables only reach deployments created afterwards: open Deployments and <strong>Redeploy</strong> the latest one, and check that the database is connected to the <strong>Production</strong> environment.
                  </>
                ) : (
                  <>
                    Database-related variables present but none holds a <code>postgres://</code> connection string: {data.storage.candidateVars.join(", ")}. Add <code>DATABASE_URL</code> with the database's connection string, then redeploy.
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        <section className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Database className="w-5 h-5" /></div>
            <h3 className="text-lg font-bold text-foreground">Configured sources</h3>
            {data?.persistent && (
              <span className="ml-auto text-xs text-muted-foreground" data-testid="storage-kind" title="Where Data Sources and Quote Profiles are saved">
                Saved in {data.storeKind === "postgres" ? "Postgres" : data.storeKind === "file" ? "server files" : data.storeKind} · survives restarts and redeploys
              </span>
            )}
          </div>
          {isLoading && <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {error && <div className="p-6 text-sm text-destructive">Could not load data sources.</div>}
          {data && data.dataSources.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No data sources yet. Add your first one below.</div>
          )}
          <ul className="divide-y divide-border/60">
            {data?.dataSources.map((ds) => (
              <li key={ds.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-start gap-4" data-testid={`ds-${ds.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={managePath(ds.id)} className="font-semibold text-foreground hover:text-primary hover:underline underline-offset-2" title="Edit Data Source">{ds.name}</Link>
                    {ds.isDefault && <DefaultBadge />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ds.assetCount.toLocaleString()} assets · {ds.productCount.toLocaleString()} products
                    {ds.unpricedProductCount > 0 && ` (${ds.unpricedProductCount} without a list price)`} · last updated {new Date(ds.updatedAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">Source: {ds.sourceFiles.join(" + ")}</p>

                  <div className="mt-3 flex items-start gap-3 rounded-lg border border-border/60 bg-surface p-3" data-testid={`profile-${ds.id}`}>
                    {ds.quoteProfile.hasLogo ? (
                      <img src={logoUrl(ds.id)} alt="" className="h-8 max-w-[120px] object-contain flex-shrink-0 rounded bg-white p-0.5" title="Document logo (shown as it prints)" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0"><Building2 className="w-4 h-4" /></div>
                    )}
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-secondary-foreground">Quote Profile</span>
                        <ProfileBadge ds={ds} />
                      </div>
                      {ds.quoteProfile.companyName ? (
                        <p className="text-secondary-foreground mt-1">
                          <span className="font-medium">{ds.quoteProfile.companyName}</span>
                          {ds.quoteProfile.addressLine && ` · ${ds.quoteProfile.addressLine}`}
                          {ds.quoteProfile.phone && ` · ${ds.quoteProfile.phone}`}
                          {ds.quoteProfile.email && ` · ${ds.quoteProfile.email}`}
                          {ds.quoteProfile.website && ` · ${ds.quoteProfile.website}`}
                        </p>
                      ) : (
                        <p className="text-muted-foreground mt-1">No seller identity yet: quotes from this source cannot be generated until the profile is filled in.</p>
                      )}
                    </div>
                    <Link href={profilePath(ds.id)} className={cn("flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border text-secondary-foreground hover:bg-card", ds.quoteProfile.complete ? "border-border" : "border-warning/50")}>
                      {ds.quoteProfile.complete ? "Edit Quote Profile" : "Complete Quote Profile"}
                    </Link>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <Link href={quotePath(ds.id)} title="Create a quote from this source"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20">
                    <FileText className="w-3.5 h-3.5" /> Quote
                  </Link>
                  <Link href={managePath(ds.id)} title="Edit Data Source" data-testid={`manage-${ds.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-secondary-foreground hover:bg-muted/60">
                    <Settings2 className="w-3.5 h-3.5" /> Manage
                  </Link>
                  {!ds.isDefault && (
                    <button type="button" onClick={() => actions.setDefault(ds)} disabled={busy}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-secondary-foreground hover:bg-muted/60 disabled:opacity-50">
                      {actions.busy === `default-${ds.id}` ? "…" : "Set as default"}
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => actions.replaceWorkbook(ds)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-secondary-foreground hover:bg-muted/60 disabled:opacity-50">
                    <RefreshCw className="w-3.5 h-3.5" /> {actions.busy === `replace-${ds.id}` ? "Updating…" : "Update workbook"}
                  </button>
                  <button type="button" onClick={() => actions.confirmDelete(ds)} disabled={busy} title="Delete" data-testid={`delete-${ds.id}`}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-card rounded-2xl border border-border shadow-card overflow-hidden" data-testid="add-source">
          <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Upload className="w-5 h-5" /></div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Add a data source</h3>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-secondary-foreground">Step 1 of 2.</span> Name it and upload a workbook with "Asset Data" and "Pricing Data" sheets (the Cytek Quoting Tool layout is the format supported today). This is the only time the file is needed.
                After the import you will complete the source's Quote Profile (company, logo, address, contact) so its documents carry the right seller identity.
              </p>
            </div>
          </div>
          <form onSubmit={onAdd} className="p-6 grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-secondary-foreground mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Evans Medical"' data-testid="add-name"
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-surface focus:bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-secondary-foreground mb-1.5">Workbook (.xlsx)</label>
              <input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="add-file"
                className="w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-muted file:text-secondary-foreground file:font-semibold hover:file:bg-muted/70" />
            </div>
            <button type="submit" disabled={busy} data-testid="add-submit"
              className={cn("sm:col-span-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl transition-all disabled:opacity-70")}>
              {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : "Import"}
            </button>
            {formError && <p className="sm:col-span-5 text-sm text-destructive">{formError}</p>}
          </form>
        </section>
      </main>
      {actions.elements}
    </PageShell>
  );
}
