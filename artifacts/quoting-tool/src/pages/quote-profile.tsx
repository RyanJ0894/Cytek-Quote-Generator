import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2, Building2, ImagePlus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useListDataSources, getListDataSourcesQueryKey, type QuoteProfile } from "@workspace/api-client-react";
import { AppHeader, HeaderLink, PageShell } from "@/components/AppHeader";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const EMPTY: QuoteProfile = {
  companyName: "",
  shortName: "",
  address: { street: "", cityStateZip: "" },
  contact: { phone: "", fax: "", website: "", email: "" },
  logo: null,
  quoteBullets: [],
  termsAndConditions: { title: "", subtitle: "", intro: "", sections: [] },
  pdfTheme: { tableHeaderBackground: "#f1f1f1", textColor: "#000000", borderColor: "#000000" },
};

/** Sections are edited as plain text: a line starting with "# " begins a section; the lines after it are its body. */
function sectionsToText(sections: QuoteProfile["termsAndConditions"]["sections"]): string {
  return sections.map((s) => `# ${s.heading}\n${s.body}`).join("\n\n");
}
function textToSections(text: string): QuoteProfile["termsAndConditions"]["sections"] {
  const out: { heading: string; body: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("# ")) out.push({ heading: line.slice(2).trim(), body: "" });
    else if (out.length) out[out.length - 1].body += (out[out.length - 1].body ? "\n" : "") + line;
  }
  return out.map((s) => ({ heading: s.heading, body: s.body.trim() })).filter((s) => s.heading || s.body);
}

const input = "w-full px-3 py-2 rounded-xl border border-input bg-surface focus:bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const label = "block text-sm font-semibold text-secondary-foreground mb-1";

/** Edit the seller identity and document branding for one Data Source. */
export default function QuoteProfilePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: listing } = useListDataSources();
  const source = listing?.dataSources.find((d) => d.id === id);

  const [profile, setProfile] = useState<QuoteProfile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [sectionsText, setSectionsText] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_URL}/api/data-sources/${encodeURIComponent(id)}/profile`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        if (cancelled) return;
        const p: QuoteProfile = body.profile ?? EMPTY;
        setProfile(p);
        setSectionsText(sectionsToText(p.termsAndConditions.sections));
        setBulletsText(p.quoteBullets.join("\n"));
        setMissing(body.missing ?? []);
      })
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const set = (patch: Partial<QuoteProfile>) => setProfile((p) => ({ ...(p ?? EMPTY), ...patch }));

  const onLogoFile = (file: File | undefined): void => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      toast({ variant: "destructive", title: "Logo must be a PNG or JPEG image." });
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Logo must be smaller than 1.5 MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => set({ logo: { dataUrl, aspectRatio: img.naturalHeight / img.naturalWidth } });
      img.onerror = () => toast({ variant: "destructive", title: "Could not read that image." });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      const body: QuoteProfile = {
        ...profile,
        quoteBullets: bulletsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        termsAndConditions: { ...profile.termsAndConditions, sections: textToSections(sectionsText) },
      };
      const r = await fetch(`${BASE_URL}/api/data-sources/${encodeURIComponent(id)}/profile`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || `Request failed (${r.status})`);
      await queryClient.invalidateQueries({ queryKey: getListDataSourcesQueryKey() });
      toast({
        title: "Quote Profile saved",
        description: res.complete ? "Quotes from this source will use this seller identity." : `Still missing: ${res.missing.join(", ")}.`,
      });
      navigate("/data-sources");
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Could not save", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <AppHeader>
        <HeaderLink href="/data-sources"><ArrowLeft className="w-4 h-4" /> Data Sources</HeaderLink>
      </AppHeader>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-foreground font-display mb-2">Quote Profile</h2>
          <p className="text-muted-foreground">
            Seller identity and document branding for <strong>{source?.name ?? id}</strong>. Used on every quote generated from this source and nowhere else.
          </p>
          {missing.length > 0 && <p className="text-sm text-warning-foreground mt-2">Required before documents can be generated: {missing.join(", ")}.</p>}
        </div>

        {loadError && <div className="bg-destructive/5 border border-destructive/30 text-destructive rounded-2xl p-6 text-sm">{loadError}</div>}
        {!profile && !loadError && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

        {profile && (
          <form onSubmit={onSave} className="space-y-6" data-testid="quote-profile-form">
            <section className="bg-card rounded-2xl border border-border shadow-card p-6 space-y-4">
              <h3 className="text-lg font-bold text-foreground">Company</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={label}>Company name (on the document) *</label><input name="companyName" className={input} value={profile.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="Evans Medical LLC" /></div>
                <div><label className={label}>Short name</label><input name="shortName" className={input} value={profile.shortName} onChange={(e) => set({ shortName: e.target.value })} placeholder="Evans Medical" /></div>
                <div><label className={label}>Street address *</label><input name="street" className={input} value={profile.address.street} onChange={(e) => set({ address: { ...profile.address, street: e.target.value } })} /></div>
                <div><label className={label}>City, state, ZIP *</label><input name="cityStateZip" className={input} value={profile.address.cityStateZip} onChange={(e) => set({ address: { ...profile.address, cityStateZip: e.target.value } })} placeholder="Fremont, CA 94538" /></div>
                <div><label className={label}>Phone *</label><input name="phone" className={input} value={profile.contact.phone} onChange={(e) => set({ contact: { ...profile.contact, phone: e.target.value } })} /></div>
                <div><label className={label}>Fax</label><input name="fax" className={input} value={profile.contact.fax} onChange={(e) => set({ contact: { ...profile.contact, fax: e.target.value } })} /></div>
                <div><label className={label}>Email *</label><input name="email" className={input} value={profile.contact.email} onChange={(e) => set({ contact: { ...profile.contact, email: e.target.value } })} /></div>
                <div><label className={label}>Website</label><input name="website" className={input} value={profile.contact.website} onChange={(e) => set({ contact: { ...profile.contact, website: e.target.value } })} /></div>
              </div>

              <div>
                <label className={label}>Logo (PNG or JPEG, printed top-left; the short name is printed instead when empty)</label>
                {/* The logo is a document asset: previewed on white, as it prints, regardless of the app theme. */}
                <div className="flex items-center gap-4">
                  {profile.logo ? (
                    <img src={profile.logo.dataUrl} alt="Logo preview" className="h-12 max-w-[200px] object-contain border border-border rounded-lg bg-white p-1" data-testid="logo-preview" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center text-muted-foreground"><Building2 className="w-5 h-5" /></div>
                  )}
                  <input ref={logoInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
                  <button type="button" onClick={() => logoInput.current?.click()} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-secondary-foreground hover:bg-muted/60"><ImagePlus className="w-3.5 h-3.5" /> {profile.logo ? "Replace logo" : "Upload logo"}</button>
                  {profile.logo && <button type="button" onClick={() => set({ logo: null })} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /> Remove</button>}
                </div>
              </div>
            </section>

            <section className="bg-card rounded-2xl border border-border shadow-card p-6 space-y-4">
              <h3 className="text-lg font-bold text-foreground">Document text</h3>
              <div>
                <label className={label}>Notes under the line items (one per line)</label>
                <textarea name="quoteBullets" rows={4} className={input} value={bulletsText} onChange={(e) => setBulletsText(e.target.value)} placeholder={"-All prices in USD\n-This quote is valid for 60 days."} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={label}>Terms title</label><input name="termsTitle" className={input} value={profile.termsAndConditions.title} onChange={(e) => set({ termsAndConditions: { ...profile.termsAndConditions, title: e.target.value } })} placeholder="GENERAL TERMS AND CONDITIONS OF SALE" /></div>
                <div><label className={label}>Terms subtitle</label><input name="termsSubtitle" className={input} value={profile.termsAndConditions.subtitle} onChange={(e) => set({ termsAndConditions: { ...profile.termsAndConditions, subtitle: e.target.value } })} /></div>
              </div>
              <div>
                <label className={label}>Terms opening paragraph</label>
                <textarea name="termsIntro" rows={3} className={input} value={profile.termsAndConditions.intro} onChange={(e) => set({ termsAndConditions: { ...profile.termsAndConditions, intro: e.target.value } })} />
              </div>
              <div>
                <label className={label}>Terms sections (start each with a line like <code># 1. PAYMENT TERMS:</code>; leave empty for no terms pages)</label>
                <textarea name="termsSections" rows={10} className={`${input} font-mono text-xs`} value={sectionsText} onChange={(e) => setSectionsText(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                {(["tableHeaderBackground", "textColor", "borderColor"] as const).map((k) => (
                  <div key={k}>
                    <label className={label}>{k === "tableHeaderBackground" ? "Table header" : k === "textColor" ? "Text" : "Borders"}</label>
                    <input type="color" name={k} value={profile.pdfTheme[k]} onChange={(e) => set({ pdfTheme: { ...profile.pdfTheme, [k]: e.target.value } })} className="h-9 w-full rounded-lg border border-input bg-card" />
                  </div>
                ))}
              </div>
            </section>

            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 py-2.5 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl transition-all disabled:opacity-70">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Quote Profile"}
              </button>
              <Link href="/data-sources" className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
            </div>
          </form>
        )}
      </main>
    </PageShell>
  );
}
