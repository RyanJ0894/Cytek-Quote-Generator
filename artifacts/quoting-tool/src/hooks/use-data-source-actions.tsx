import React, { useCallback, useRef, useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListDataSourcesQueryKey, type DataSourceSummary } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { Dialog, DialogActions, dialogButton } from "@/components/ui/dialog";

/**
 * Management actions on a Data Source, shared by the homepage cards, the
 * Data Sources page and the Edit Data Source page so every surface changes
 * the same persistent record. Render `{elements}` once in the page: it holds
 * the delete confirmation dialog and the hidden workbook file input.
 */
export function useDataSourceActions(opts: { onDeleted?: (ds: DataSourceSummary) => void } = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DataSourceSummary | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<DataSourceSummary | null>(null);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: getListDataSourcesQueryKey() }), [queryClient]);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>, success: string): Promise<boolean> => {
      setBusy(key);
      try {
        await fn();
        await refresh();
        toast({ title: success });
        return true;
      } catch (err: unknown) {
        toast({ variant: "destructive", title: "Something went wrong", description: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  /** Opens the confirmation; nothing is deleted until the user confirms. */
  const confirmDelete = useCallback((ds: DataSourceSummary) => setPendingDelete(ds), []);

  const performDelete = useCallback(async () => {
    const ds = pendingDelete;
    if (!ds) return;
    const ok = await run(`delete-${ds.id}`, async () => {
      await api(`/data-sources/${encodeURIComponent(ds.id)}`, { method: "DELETE" });
    }, `"${ds.name}" deleted`);
    // On failure the dialog closes but the source stays exactly as it was.
    setPendingDelete(null);
    if (ok) opts.onDeleted?.(ds);
  }, [pendingDelete, run, opts]);

  /** Opens the file picker; the chosen workbook replaces the source's data (name, id and Quote Profile are kept). */
  const replaceWorkbook = useCallback((ds: DataSourceSummary) => {
    replaceTarget.current = ds;
    replaceInput.current?.click();
  }, []);

  const onReplaceFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      const target = replaceTarget.current;
      if (replaceInput.current) replaceInput.current.value = "";
      if (!f || !target) return;
      const body = new FormData();
      body.append("file", f);
      await run(`replace-${target.id}`, async () => {
        await api(`/data-sources/${encodeURIComponent(target.id)}/replace`, { method: "POST", body });
      }, `"${target.name}" updated from ${f.name}`);
      replaceTarget.current = null;
    },
    [run],
  );

  const setDefault = useCallback(
    (ds: DataSourceSummary) =>
      run(`default-${ds.id}`, async () => {
        await api(`/data-sources/${encodeURIComponent(ds.id)}/default`, { method: "POST" });
      }, `"${ds.name}" is now the default`),
    [run],
  );

  const rename = useCallback(
    (ds: DataSourceSummary, name: string) =>
      run(`rename-${ds.id}`, async () => {
        await api(`/data-sources/${encodeURIComponent(ds.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
      }, `Renamed to "${name}"`),
    [run],
  );

  const deleting = pendingDelete ? busy === `delete-${pendingDelete.id}` : false;
  const elements = (
    <>
      <input ref={replaceInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={onReplaceFile} data-testid="replace-workbook-input" />
      <Dialog
        open={pendingDelete !== null}
        onClose={() => !deleting && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? "this data source"}?`}
        description="This will remove this Data Source, its imported catalog/assets, and its associated Quote Profile. Quotes already generated are not affected."
        icon={<Trash2 className="w-5 h-5" />}
        testId="delete-dialog"
      >
        <DialogActions>
          <button type="button" className={dialogButton.secondary} onClick={() => setPendingDelete(null)} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className={dialogButton.destructive} onClick={performDelete} disabled={deleting} data-testid="confirm-delete" data-autofocus>
            {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</> : "Delete Data Source"}
          </button>
        </DialogActions>
      </Dialog>
    </>
  );

  return { busy, confirmDelete, replaceWorkbook, setDefault, rename, refresh, elements };
}
