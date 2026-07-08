import { cytekConfig } from "./companies/cytek.js";
import type { CompanyConfig } from "./types.js";

export * from "./types.js";

const companies: Record<string, CompanyConfig> = {
  [cytekConfig.id]: cytekConfig,
};

/**
 * Reads COMPANY_ID from the environment when running under Node (the API
 * server). This module is also bundled into the browser frontend, where
 * `process` doesn't exist — guard against that instead of assuming Node.
 */
function readCompanyIdFromEnv(): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env["COMPANY_ID"];
}

/**
 * Selects which company's branding/content is served. Defaults to "cytek"
 * (the only company configured today). Set COMPANY_ID to switch companies
 * once additional `CompanyConfig`s are added to `src/companies/`.
 */
const ACTIVE_COMPANY_ID = readCompanyIdFromEnv() || cytekConfig.id;

export const activeCompany: CompanyConfig =
  companies[ACTIVE_COMPANY_ID] ?? cytekConfig;

/** Two-line address/contact footer printed on every PDF page. */
export function getFooterLines(
  company: CompanyConfig = activeCompany,
): [string, string] {
  const { legalName, address, contact } = company;
  const line1 = `${legalName} | Offices in ${address.cityStateZip}. ${address.street}`;
  const line2 = `Phone: ${contact.phone}${contact.fax ? ` | Fax: ${contact.fax}` : ""} | ${contact.website} | email: ${contact.supportEmail}`;
  return [line1, line2];
}
