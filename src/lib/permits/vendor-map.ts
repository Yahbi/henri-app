/* ── Permit Portal Vendor Mapping ────────────────────────────────────────────
 * Maps jurisdictions to their permit portal vendors and URLs.
 * Source: Massive_US_Permit_Mapping.csv
 *
 * Most vendors (accela, tyler, etrakit) require authenticated scrapers or
 * FOIA requests. Socrata portals are API-accessible via SODA.
 *
 * This table is used for:
 * 1. Future scraper routing — given a ZIP, look up which vendor system to target
 * 2. Portal links in the compliance/permits UI
 * 3. Coverage planning — identify which cities need which ingestion strategy
 * ────────────────────────────────────────────────────────────────────────── */

export type PermitVendor = "socrata" | "accela" | "tyler" | "etrakit";

export interface VendorEntry {
  zip: string;
  city: string;
  county: string;
  state: string;
  vendor: PermitVendor;
  apiAvailable: boolean;
  portalUrl: string;
}

export const PERMIT_VENDOR_MAP: VendorEntry[] = [
  // ── Accela portals (auth scraper / FOIA required) ──
  { zip: "75201", city: "Dallas", county: "Dallas", state: "TX", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/DALLASTX/Default.aspx" },
  { zip: "80201", city: "Denver", county: "Denver", state: "CO", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/DENVER/Default.aspx" },
  { zip: "80903", city: "Colorado Springs", county: "El Paso", state: "CO", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/COSPRINGS/Default.aspx" },
  { zip: "33602", city: "Tampa", county: "Hillsborough", state: "FL", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/tampa/Default.aspx" },
  { zip: "46201", city: "Indianapolis", county: "Marion", state: "IN", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/INDY/Cap/CapHome.aspx?module=Permits&TabName=HOME" },
  { zip: "89101", city: "Clark County", county: "Clark", state: "NV", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/CLARKCO/Cap/CapHome.aspx?module=Building&TabName=Building" },
  { zip: "94612", city: "Oakland", county: "Alameda", state: "CA", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/oakland/Welcome.aspx" },
  { zip: "68102", city: "Omaha", county: "Douglas", state: "NE", vendor: "accela", apiAvailable: false, portalUrl: "https://aca-prod.accela.com/OMAHA/Cap/CapHome.aspx?TabName=Home&module=Permits" },

  // ── Tyler portals (auth scraper / FOIA required) ──
  { zip: "90745", city: "Carson", county: "Los Angeles", state: "CA", vendor: "tyler", apiAvailable: false, portalUrl: "https://cityofcarsonca-energovweb.tylerhost.net/apps/selfservice" },
  { zip: "27601", city: "Wake County", county: "Wake", state: "NC", vendor: "tyler", apiAvailable: false, portalUrl: "https://wakecountync-energovpub.tylerhost.net/apps/SelfService" },
  { zip: "33178", city: "Doral", county: "Miami-Dade", state: "FL", vendor: "tyler", apiAvailable: false, portalUrl: "https://doralfl-energovweb.tylerhost.net/apps/SelfService" },
  { zip: "87101", city: "Albuquerque", county: "Bernalillo", state: "NM", vendor: "tyler", apiAvailable: false, portalUrl: "https://cityofalbuquerquenm-energovweb.tylerhost.net/apps/selfservice" },
  { zip: "36601", city: "Mobile", county: "Mobile", state: "AL", vendor: "tyler", apiAvailable: false, portalUrl: "https://mobileal-energovpub.tylerhost.net/apps/selfservice" },
  { zip: "94541", city: "Hayward", county: "Alameda", state: "CA", vendor: "tyler", apiAvailable: false, portalUrl: "https://haywardca-energovpub.tylerhost.net/Apps/SelfService" },

  // ── etrakit portals (auth scraper / FOIA required) ──
  { zip: "75034", city: "Frisco", county: "Collin", state: "TX", vendor: "etrakit", apiAvailable: false, portalUrl: "https://etrakit.friscotexas.gov/etrakit/Search/permit.aspx" },
  { zip: "98133", city: "Shoreline", county: "King", state: "WA", vendor: "etrakit", apiAvailable: false, portalUrl: "https://permits.shorelinewa.gov/etrakit/" },
  { zip: "98201", city: "Everett", county: "Snohomish", state: "WA", vendor: "etrakit", apiAvailable: false, portalUrl: "https://onlinepermits.everettwa.gov/etrakit/" },
  { zip: "33071", city: "Coral Springs", county: "Broward", state: "FL", vendor: "etrakit", apiAvailable: false, portalUrl: "https://etrakit.coralsprings.gov/etrakit/" },

  // ── Socrata portals (API accessible) ──
  { zip: "90012", city: "Los Angeles", county: "Los Angeles", state: "CA", vendor: "socrata", apiAvailable: true, portalUrl: "https://data.lacity.org" },
  { zip: "10001", city: "New York", county: "New York", state: "NY", vendor: "socrata", apiAvailable: true, portalUrl: "https://data.cityofnewyork.us" },
];

/** Look up permit portal info for a given ZIP code. */
export function lookupVendor(zip: string): VendorEntry | undefined {
  return PERMIT_VENDOR_MAP.find((v) => v.zip === zip);
}

/** Get all cities using a specific vendor. */
export function getCitiesByVendor(vendor: PermitVendor): VendorEntry[] {
  return PERMIT_VENDOR_MAP.filter((v) => v.vendor === vendor);
}
