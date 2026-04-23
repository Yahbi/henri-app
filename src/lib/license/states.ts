/* ── State licensing board configuration ── */

export interface StateLicenseConfig {
  name: string;
  board: string;
  apiAvailable: boolean;
  lookupUrl: string;
  classifications?: string[];
}

export const STATE_LICENSE_CONFIGS: Record<string, StateLicenseConfig> = {
  CA: {
    name: "California",
    board: "Contractors State License Board (CSLB)",
    apiAvailable: true,
    lookupUrl: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx",
    classifications: [
      "A - General Engineering", "B - General Building",
      "C-2 Insulation", "C-4 Boiler", "C-7 Low Voltage", "C-8 Concrete",
      "C-10 Electrical", "C-11 Elevator", "C-12 Earthwork",
      "C-13 Fencing", "C-15 Flooring", "C-16 Fire Protection",
      "C-17 Glazing", "C-20 HVAC", "C-21 Building Moving",
      "C-23 Ornamental Metal", "C-27 Landscaping", "C-29 Masonry",
      "C-33 Painting", "C-34 Pipeline", "C-35 Lathing/Plastering",
      "C-36 Plumbing", "C-38 Refrigeration", "C-39 Roofing",
      "C-42 Sanitation", "C-43 Sheet Metal", "C-45 Signs",
      "C-46 Solar", "C-47 General Manufactured Housing",
      "C-50 Reinforcing Steel", "C-51 Structural Steel",
      "C-53 Swimming Pool", "C-54 Tile", "C-55 Water Conditioning",
      "C-57 Well Drilling", "C-60 Welding", "C-61 Limited Specialty",
    ],
  },
  TX: { name: "Texas", board: "Texas Department of Licensing and Regulation (TDLR)", apiAvailable: false, lookupUrl: "https://www.tdlr.texas.gov/LicenseSearch/" },
  FL: { name: "Florida", board: "Department of Business and Professional Regulation (DBPR)", apiAvailable: false, lookupUrl: "https://www.myfloridalicense.com/wl11.asp" },
  NY: { name: "New York", board: "NYC Department of Buildings", apiAvailable: false, lookupUrl: "https://a810-bisweb.nyc.gov/bisweb/bispi00.jsp" },
  AZ: { name: "Arizona", board: "Registrar of Contractors (ROC)", apiAvailable: false, lookupUrl: "https://roc.az.gov/contractor-search" },
  NV: { name: "Nevada", board: "Nevada State Contractors Board", apiAvailable: false, lookupUrl: "https://app.nvcontractorsboard.com/Clients/NVSCB/Public/ContractorSearch.aspx" },
  CO: { name: "Colorado", board: "DORA Division of Professions", apiAvailable: false, lookupUrl: "https://apps.colorado.gov/dora/licensing/Lookup/LicenseLookup.aspx" },
  WA: { name: "Washington", board: "Department of Labor & Industries", apiAvailable: false, lookupUrl: "https://fortress.wa.gov/lni/bbip/" },
  OR: { name: "Oregon", board: "Construction Contractors Board", apiAvailable: false, lookupUrl: "https://search.ccb.state.or.us/search/search_result.asp" },
  GA: { name: "Georgia", board: "Georgia Secretary of State", apiAvailable: false, lookupUrl: "https://sos.ga.gov/cgi-bin/plbquery.asp" },
  NC: { name: "North Carolina", board: "NC Licensing Board for General Contractors", apiAvailable: false, lookupUrl: "https://www.nclbgc.org/license-lookup" },
  VA: { name: "Virginia", board: "DPOR Board for Contractors", apiAvailable: false, lookupUrl: "https://www.dpor.virginia.gov/LicenseLookup/" },
  PA: { name: "Pennsylvania", board: "Attorney General Consumer Protection", apiAvailable: false, lookupUrl: "https://www.attorneygeneral.gov/hgcra/" },
  OH: { name: "Ohio", board: "Ohio Construction Industry Licensing Board", apiAvailable: false, lookupUrl: "https://elicense.ohio.gov/oh_verifylicense" },
  IL: { name: "Illinois", board: "IDFPR", apiAvailable: false, lookupUrl: "https://online-dfpr.micropact.com/lookup/licenselookup.aspx" },
  MI: { name: "Michigan", board: "LARA Bureau of Construction Codes", apiAvailable: false, lookupUrl: "https://aca-prod.accela.com/MILARA/" },
  NJ: { name: "New Jersey", board: "NJ Division of Consumer Affairs", apiAvailable: false, lookupUrl: "https://newjersey.mylicense.com/verification/" },
  MA: { name: "Massachusetts", board: "Division of Professional Licensure", apiAvailable: false, lookupUrl: "https://www.mass.gov/check-a-professional-license" },
  TN: { name: "Tennessee", board: "Board for Licensing Contractors", apiAvailable: false, lookupUrl: "https://verify.tn.gov/" },
  MD: { name: "Maryland", board: "Maryland Home Improvement Commission", apiAvailable: false, lookupUrl: "https://www.dllr.state.md.us/cgi-bin/ElicenseSearch/eLicenseSearch.cgi" },
  SC: { name: "South Carolina", board: "SC Contractors Licensing Board", apiAvailable: false, lookupUrl: "https://verify.llronline.com/LicLookup/LookupMain.aspx" },
};

/* ── All US states (for dropdown) ── */
export const ALL_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];
