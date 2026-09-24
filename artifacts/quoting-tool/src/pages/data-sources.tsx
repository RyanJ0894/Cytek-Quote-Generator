import React, { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Database, Star, Trash2, Upload, RefreshCw, Loader2, AlertTriangle, FileText, BadgeCheck, Building2 } from "lucide-react";
import { useListDataSources, getListDataSourcesQueryKey, type DataSourceSummary } from "@workspace/api-client-react";
import { AppHeader, PageShell } from "@/components/AppHeader";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}/api${path}`, init);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/**
 * Data Sources: each one is a persistent, isolated Source of Truth (asset +
 * pricing catalog) that quotes are created from. Workbooks are uploaded
 * here, once, and never on the quoting path.
 */
export default function DataSourcesPage() {
  const { data, isLoading, error } = useListDataSources();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<DataSourceSummary | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListDataSourcesQueryKey() });

  const run = async (key: string, fn: () => Promise<void>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast({ title: success });
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Something went wrong", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!name.trim()) return setFormError("Give the data source a name (e.g. \"Evans Medical\").");
    if (!file) return setFormError("Choose the workbook to import (.xlsx).");
    const body = new FormData();
    body.append("name", name.trim());
    body.append("file", file);
    let imported: DataSourceSummary | null = null;
    await run("add", async () => {
      imported = await api("/data-sources", { method: "POST", body });
      setName("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    }, "Data source added");
    if (imported) {
      const s = imported as DataSourceSummary;
      toast({
        title: `Imported "${s.name}"`,
        description: `${s.assetCount.toLocaleString()} assets and ${s.productCount.toLocaleString()} products (${s.unpricedProductCount} without a list price). It is ready for quoting.`,
      });
      // Back to Create a Quote with the new source available.
      navigate("/");
    }
  };

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const target = replaceTarget;
    if (!f || !target) return;
    const body = new FormData();
    body.append("file", f);
    await run(`replace-${target.id}`, async () => {
      await api(`/data-sources/${encodeURIComponent(target.id)}/replace`, { method: "POST", body });
    }, `"${target.name}" updated from ${f.name}`);
    setReplaceTarget(null);
    if (replaceInput.current) replaceInput.current.value = "";
  };

  const setDefault = (ds: DataSourceSummary) =>
    run(`default-${ds.id}`, async () => {
      await api(`/data-sources/${encodeURIComponent(ds.id)}/default`, { method: "POST" });
    }, `"${ds.name}" is now the default`);

  const remove = (ds: DataSourceSummary) => {
    if (!window.confirm(`Delete the data source "${ds.name}"? Its imported data is removed; quotes already generated are not affected.`)) return;
    return run(`delete-${ds.id}`, async () => {
      await api(`/data-sources/${encodeURIComponent(ds.id)}`, { method: "DELETE" });
    }, `"${ds.name}" deleted`);
  };

  return (
    <PageShell>
      <AppHeader>
        <Link href="/" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" /> Create a quote
        </Link>
      </AppHeader>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 font-display mb-2">Data Sources</h2>
          <p className="text-slate-500 max-w-2xl">
            Each Data Source is a Source of Truth: one company's or dataset's assets, products and prices. Upload its workbook once here;
            it is normalized and saved, and quotes are created from it indefinitely without the spreadsheet. Come back only to add, update or remove a source.
          </p>
        </div>

        {data && !data.persistent && (
          <div className="flex gap-3 items-start bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Persistent storage is not configured on this server.</p>
              <p>Data sources you add or change here will be lost when the server restarts (the shipped Cytek — Current source is re-created). Ask your administrator to set <code>DATABASE_URL</code> to enable saving.</p>
            </div>
          </div>
        )}

        <section className="bg-card rounded-2xl border border-border shadow-xl shadow-slate-200/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Database className="w-5 h-5" /></div>
            <h3 className="text-lg font-bold text-slate-900">Configured sources</h3>
          </div>
          {isLoading && <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {error && <div className="p-6 text-sm text-destructive">Could not load data sources.</div>}
          {data && data.dataSources.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No data sources yet. Add your first one below.</div>
          )}
          <ul className="divide-y divide-border/60">
            {data?.dataSources.map((ds) => (
              <li key={ds.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4" data-testid={`ds-${ds.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{ds.name}</span>
                    {ds.isDefault && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800"><Star className="w-3 h-3" /> Default</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ds.assetCount.toLocaleString()} assets · {ds.productCount.toLocaleString()} products
                    {ds.unpricedProductCount > 0 && ` (${ds.unpricedProductCount} without a list price)`} · last updated {new Date(ds.updatedAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">Source: {ds.sourceFiles.join(" + ")}</p>

                  <div className="mt-3 flex items-start gap-3 rounded-lg border border-border/60 bg-slate-50/60 p-3" data-testid={`profile-${ds.id}`}>
                    {ds.quoteProfile.hasLogo ? (
                      <img src={`${BASE_URL}/api/data-sources/${encodeURIComponent(ds.id)}/logo`} alt="" className="h-8 max-w-[120px] object-contain flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0"><Building2 className="w-4 h-4" /></div>
                    )}
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-700">Quote Profile</span>
                        {ds.quoteProfile.complete ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800"><BadgeCheck className="w-3 h-3" /> Complete</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800"><AlertTriangle className="w-3 h-3" /> Incomplete: {ds.quoteProfile.missing.join(", ")}</span>
                        )}
                      </div>
                      {ds.quoteProfile.companyName ? (
                        <p className="text-slate-700 mt-1">
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
                    <Link href={`/data-sources/${encodeURIComponent(ds.id)}/profile`} className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-slate-700 hover:bg-white">
                      Edit Quote Profile
                    </Link>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link href={`/quote/${encodeURIComponent(ds.id)}`} title="Create a quote from this source"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20">
                    <FileText className="w-3.5 h-3.5" /> Quote
                  </Link>
                  {!ds.isDefault && (
                    <button type="button" onClick={() => setDefault(ds)} disabled={busy !== null}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {busy === `default-${ds.id}` ? "…" : "Set as default"}
                    </button>
                  )}
                  <button type="button" disabled={busy !== null}
                    onClick={() => { setReplaceTarget(ds); replaceInput.current?.click(); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw className="w-3.5 h-3.5" /> {busy === `replace-${ds.id}` ? "Updating…" : "Update workbook"}
                  </button>
                  <button type="button" onClick={() => remove(ds)} disabled={busy !== null} title="Delete"
                    className="p-2 rounded-lg text-slate-400 hover:text-destructive hover:bg-destructive/10 disabled:opacity-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <input ref={replaceInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={onReplaceFile} />
        </section>

        <section className="bg-card rounded-2xl border border-border shadow-xl shadow-slate-200/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Upload className="w-5 h-5" /></div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Add a data source</h3>
              <p className="text-xs text-muted-foreground">Name it and upload a workbook with "Asset Data" and "Pricing Data" sheets (the Cytek Quoting Tool layout is the format supported today). This is the only time the file is needed. Afterwards, fill in the source's Quote Profile so its documents carry the right seller identity.</p>
            </div>
          </div>
          <form onSubmit={onAdd} className="p-6 grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Evans Medical"'
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-slate-50/50 focus:bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Workbook (.xlsx)</label>
              <input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold hover:file:bg-slate-200" />
            </div>
            <button type="submit" disabled={busy !== null}
              className={cn("sm:col-span-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-blue-500 text-white shadow-lg shadow-primary/25 hover:shadow-xl transition-all disabled:opacity-70")}>
              {busy === "add" ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : "Import"}
            </button>
            {formError && <p className="sm:col-span-5 text-sm text-destructive">{formError}</p>}
          </form>
        </section>
      </main>
    </PageShell>
  );
}
