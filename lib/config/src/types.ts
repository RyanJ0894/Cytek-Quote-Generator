export interface CompanyAddress {
  street: string;
  /** e.g. "Fremont, CA 94538" */
  cityStateZip: string;
}

export interface CompanyContact {
  phone: string;
  fax?: string;
  website: string;
  supportEmail: string;
}

export interface CompanyLogo {
  /**
   * Filename of the logo image. Expected to exist in both the API
   * server's `src/data/` directory (used for PDF generation) and the
   * frontend's `public/` directory (used for on-screen branding).
   */
  fileName: string;
  /** width / height of the source image, used to scale the logo in the
   *  PDF header while preserving its aspect ratio. */
  aspectRatio: number;
}

export interface TermsAndConditionsSection {
  heading: string;
  body: string;
}

export interface TermsAndConditions {
  /** Main heading printed at the top of the terms & conditions pages. */
  title: string;
  /** Sub-heading printed below the title. */
  subtitle: string;
  /** Opening paragraph, printed before the numbered sections. */
  intro: string;
  sections: TermsAndConditionsSection[];
}

export interface PdfTheme {
  tableHeaderBackground: string;
  textColor: string;
  borderColor: string;
}

/**
 * All business-specific values that used to be hardcoded throughout the
 * quote generator. A single `CompanyConfig` fully describes how quotes and
 * contracts are branded and worded for one company.
 *
 * To onboard a new company, add a new file under `src/companies/`,
 * implement `CompanyConfig`, and point `ACTIVE_COMPANY_ID` (see
 * `src/index.ts`) at its `id`. No application code needs to change.
 */
export interface CompanyConfig {
  /** Stable identifier, e.g. "cytek". Used to select the active company. */
  id: string;
  /**
   * Which Data Source (asset + pricing catalog) Manual Mode looks up against
   * for this company. See artifacts/api-server/src/data-sources. Defaults to
   * the company id when omitted.
   */
  dataSourceId?: string;
  /** Full legal name, e.g. "Cytek Biosciences Inc." */
  legalName: string;
  /** Short/brand name, e.g. "Cytek". Used in UI copy. */
  shortName: string;
  address: CompanyAddress;
  contact: CompanyContact;
  logo: CompanyLogo;
  /** Short bullet points printed under the quote line-items table. */
  quoteBullets: string[];
  documentTitles: {
    termsTitle: string;
    termsSubtitle: string;
  };
  termsAndConditions: TermsAndConditions;
  pdfTheme: PdfTheme;
}
