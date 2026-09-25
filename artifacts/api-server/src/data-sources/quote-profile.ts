/**
 * Quote Profile: the seller identity and document branding used when a quote
 * is generated from a Data Source. Stored separately from the source's
 * catalog data, so replacing the workbook never touches it, and never shared
 * between sources: a new source starts with NO profile and cannot generate
 * documents until its profile is filled in.
 */

export interface QuoteProfileAddress {
  street: string;
  /** e.g. "Fremont, CA 94538" */
  cityStateZip: string;
}

export interface QuoteProfileContact {
  phone: string;
  fax: string;
  website: string;
  email: string;
}

export interface QuoteProfileLogo {
  /** data:image/png;base64,... or data:image/jpeg;base64,... */
  dataUrl: string;
  /** height / width of the image, used to scale it in the PDF header. */
  aspectRatio: number;
}

export interface TermsSection {
  heading: string;
  body: string;
}

export interface QuoteProfileTerms {
  title: string;
  subtitle: string;
  intro: string;
  sections: TermsSection[];
}

export interface QuoteProfileTheme {
  tableHeaderBackground: string;
  textColor: string;
  borderColor: string;
}

export interface QuoteProfile {
  /** Legal/display name printed on the document, e.g. "Cytek Biosciences Inc." */
  companyName: string;
  /** Short name used in UI copy and as the logo fallback text. */
  shortName: string;
  address: QuoteProfileAddress;
  contact: QuoteProfileContact;
  logo: QuoteProfileLogo | null;
  /** Lines printed under the line-item table. */
  quoteBullets: string[];
  /** Terms pages appended after the quote; omitted entirely when empty. */
  termsAndConditions: QuoteProfileTerms;
  pdfTheme: QuoteProfileTheme;
}

export interface QuoteProfileStatus {
  complete: boolean;
  /** Human-readable names of the required fields that are still empty. */
  missing: string[];
}

export const DEFAULT_THEME: QuoteProfileTheme = {
  tableHeaderBackground: "#f1f1f1",
  textColor: "#000000",
  borderColor: "#000000",
};

export const EMPTY_PROFILE: QuoteProfile = {
  companyName: "",
  shortName: "",
  address: { street: "", cityStateZip: "" },
  contact: { phone: "", fax: "", website: "", email: "" },
  logo: null,
  quoteBullets: [],
  termsAndConditions: { title: "", subtitle: "", intro: "", sections: [] },
  pdfTheme: { ...DEFAULT_THEME },
};

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const long = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 20000) : "");

export class QuoteProfileError extends Error {}

/** Accepts a data URL for a PNG/JPEG under the size limit; returns its decoded byte length. */
export function validateLogoDataUrl(dataUrl: string): number {
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw new QuoteProfileError("Logo must be a PNG or JPEG image.");
  const bytes = Math.floor((m[2].replace(/\s/g, "").length * 3) / 4);
  if (bytes > MAX_LOGO_BYTES) throw new QuoteProfileError("Logo must be smaller than 1.5 MB.");
  return bytes;
}

/** Coerces untrusted input into a well-formed QuoteProfile (throws QuoteProfileError on bad logos/colors). */
export function normalizeQuoteProfile(input: unknown): QuoteProfile {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const address = o.address ?? {};
  const contact = o.contact ?? {};
  const terms = o.termsAndConditions ?? {};
  const theme = o.pdfTheme ?? {};

  let logo: QuoteProfileLogo | null = null;
  if (o.logo && typeof o.logo === "object" && str(o.logo.dataUrl, 4_000_000)) {
    const dataUrl = String(o.logo.dataUrl).trim();
    validateLogoDataUrl(dataUrl);
    const aspectRatio = Number(o.logo.aspectRatio);
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 || aspectRatio > 5) {
      throw new QuoteProfileError("Logo aspect ratio is invalid.");
    }
    logo = { dataUrl, aspectRatio };
  }

  const color = (v: unknown, fallback: string) => {
    const s = str(v, 16);
    if (!s) return fallback;
    if (!COLOR.test(s)) throw new QuoteProfileError(`Color "${s}" must look like #RRGGBB.`);
    return s.toLowerCase();
  };

  const sections = Array.isArray(terms.sections)
    ? terms.sections
        .map((s: any) => ({ heading: str(s?.heading, 300), body: long(s?.body) }))
        .filter((s: TermsSection) => s.heading || s.body)
        .slice(0, 50)
    : [];

  return {
    companyName: str(o.companyName, 200),
    shortName: str(o.shortName, 100),
    address: { street: str(address.street, 300), cityStateZip: str(address.cityStateZip, 200) },
    contact: {
      phone: str(contact.phone, 100),
      fax: str(contact.fax, 100),
      website: str(contact.website, 200),
      email: str(contact.email, 200),
    },
    logo,
    quoteBullets: Array.isArray(o.quoteBullets) ? o.quoteBullets.map((b: unknown) => str(b, 500)).filter(Boolean).slice(0, 20) : [],
    termsAndConditions: {
      title: str(terms.title, 200),
      subtitle: str(terms.subtitle, 200),
      intro: long(terms.intro),
      sections,
    },
    pdfTheme: {
      tableHeaderBackground: color(theme.tableHeaderBackground, DEFAULT_THEME.tableHeaderBackground),
      textColor: color(theme.textColor, DEFAULT_THEME.textColor),
      borderColor: color(theme.borderColor, DEFAULT_THEME.borderColor),
    },
  };
}

/** What a document needs before it can be generated. Logo, fax, website, bullets and terms are optional. */
export function quoteProfileStatus(profile: QuoteProfile | null): QuoteProfileStatus {
  if (!profile) return { complete: false, missing: ["Company name", "Street address", "City, state and ZIP", "Phone", "Email"] };
  const missing: string[] = [];
  if (!profile.companyName) missing.push("Company name");
  if (!profile.address.street) missing.push("Street address");
  if (!profile.address.cityStateZip) missing.push("City, state and ZIP");
  if (!profile.contact.phone) missing.push("Phone");
  if (!profile.contact.email) missing.push("Email");
  return { complete: missing.length === 0, missing };
}

/** Two-line address/contact footer printed on every PDF page. */
export function footerLines(profile: QuoteProfile): [string, string] {
  const { companyName, address, contact } = profile;
  const line1 = `${companyName} | Offices in ${address.cityStateZip}. ${address.street}`;
  const parts = [`Phone: ${contact.phone}`];
  if (contact.fax) parts.push(`Fax: ${contact.fax}`);
  if (contact.website) parts.push(contact.website);
  parts.push(`email: ${contact.email}`);
  return [line1, parts.join(" | ")];
}

/** Decodes a logo data URL into the bytes PDFKit can embed. */
export function logoBuffer(logo: QuoteProfileLogo): Buffer {
  const comma = logo.dataUrl.indexOf(",");
  return Buffer.from(logo.dataUrl.slice(comma + 1), "base64");
}

/** Public shape for listings: everything except the (large) logo data. */
export interface QuoteProfileSummary {
  companyName: string;
  shortName: string;
  addressLine: string;
  phone: string;
  email: string;
  website: string;
  hasLogo: boolean;
  /** true when generated quotes from this source will carry Terms & Conditions pages. */
  hasTerms: boolean;
  termsSectionCount: number;
  complete: boolean;
  missing: string[];
}

/**
 * Terms are optional: a profile is complete without them, but when any
 * intro or section exists the PDF appends Terms & Conditions pages. Terms
 * belong to the profile only, so they are never affected by workbook
 * replacement and never inherited from another source.
 */
export function termsConfigured(profile: QuoteProfile | null): boolean {
  if (!profile) return false;
  const t = profile.termsAndConditions;
  return !!t.intro.trim() || t.sections.some((s) => s.heading.trim() || s.body.trim());
}

export function summarizeQuoteProfile(profile: QuoteProfile | null): QuoteProfileSummary {
  const status = quoteProfileStatus(profile);
  return {
    companyName: profile?.companyName ?? "",
    shortName: profile?.shortName ?? "",
    addressLine: profile ? [profile.address.street, profile.address.cityStateZip].filter(Boolean).join(", ") : "",
    phone: profile?.contact.phone ?? "",
    email: profile?.contact.email ?? "",
    website: profile?.contact.website ?? "",
    hasLogo: !!profile?.logo,
    hasTerms: termsConfigured(profile),
    termsSectionCount: profile?.termsAndConditions.sections.length ?? 0,
    ...status,
  };
}
