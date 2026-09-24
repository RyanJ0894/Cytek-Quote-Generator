import React, { useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Database, Star, Trash2, Upload, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { activeCompany } from "@workspace/config";
import { useListDataSources, getListDataSourcesQueryKey, type DataSourceSummary } from "@workspace/api-client-react";
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
 * Data Sources: the asset + pricing catalogs Manual Mode looks up against.
 * Upload a Cytek-format workbook once; it is normalized and saved so quotes
 * never need the spreadsheet again. Built-in sources ship with the app and
 * cannot be removed.
 */
export default function DataSourcesPage() {
  const { data, isLoading, error } = useListDataSources();
  const queryClient = useQueryClient();
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
    if (!name.trim()) return setFormError("Give the data source a name (e.g. \"Cytek Rev7\").");
    if (!file) return setFormError("Choose the workbook to import (.xlsx).");
    const body = new FormData();
    body.append("name", name.trim());
    body.append("file", file);
    await run("add", async () => {
      const summary = await api("/data-sources", { method: "POST", body });
      setName("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      toast({
        title: `Imported "${summary.name}"`,
        description: `${summary.assetCount.toLocaleString()} assets and ${summary.productCount.toLocaleString()} products (${summary.unpricedProductCount} without a list price).`,
      });
    }, "Data source added");
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
    if (!window.confirm(`Delete the data source "${ds.name}"? Quotes already generated are not affected.`)) return;
    return run(`delete-${ds.id}`, async () => {
      await api(`/data-sources/${encodeURIComponent(ds.id)}`, { method: "DELETE" });
    }, `"${ds.name}" deleted`);
  };

  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-slate-50 to-slate-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <img src={`/${activeCompany.logo.fileName}`} alt={`${activeCompany.shortName} Quote Generator`} className="h-10 w-auto object-contain" />
            <Link href="/" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to quoting
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 font-display mb-2">Data Sources</h2>
          <p className="text-slate-500 max-w-2xl">
            The asset and pricing catalogs Manual Mode looks up against. Upload a workbook once; it is normalized and saved so you never
            need the spreadsheet again when quoting. The default source is used automatically.
          </p>
        </div>

        {data && !data.persistent && (
          <div className="flex gap-3 items-start bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Persistent storage is not configured on this server.</p>
              <p>Data sources you add here will be lost when the server restarts. The built-in {activeCompany.shortName} data is always available. Ask your administrator to set <code>DATABASE_URL</code> to enable saving.</p>
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
          <ul className="divide-y divide-border/60">
            {data?.dataSources.map((ds) => (
              <li key={ds.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4" data-testid={`ds-${ds.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{ds.name}</span>
                    {ds.isDefault && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800"><Star className="w-3 h-3" /> Default</span>}
                    {ds.builtIn && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">Built-in</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ds.assetCount.toLocaleString()} assets · {ds.productCount.toLocaleString()} products
                    {ds.unpricedProductCount > 0 && ` (${ds.unpricedProductCount} without a list price)`} · imported {new Date(ds.importedAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">Source: {ds.sourceFiles.join(" + ")}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!ds.isDefault && (
                    <button type="button" onClick={() => setDefault(ds)} disabled={busy !== null}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {busy === `default-${ds.id}` ? "…" : "Set as default"}
                    </button>
                  )}
                  {!ds.builtIn && (
                    <button type="button" disabled={busy !== null}
                      onClick={() => { setReplaceTarget(ds); replaceInput.current?.click(); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <RefreshCw className="w-3.5 h-3.5" /> {busy === `replace-${ds.id}` ? "Updating…" : "Update file"}
                    </button>
                  )}
                  {!ds.builtIn && (
                    <button type="button" onClick={() => remove(ds)} disabled={busy !== null} title="Delete"
                      className="p-2 rounded-lg text-slate-400 hover:text-destructive hover:bg-destructive/10 disabled:opacity-50">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
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
              <p className="text-xs text-muted-foreground">A workbook with "Asset Data" and "Pricing Data" sheets in the Cytek Quoting Tool layout.</p>
            </div>
          </div>
          <form onSubmit={onAdd} className="p-6 grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Cytek Rev7"'
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
    </div>
  );
}
