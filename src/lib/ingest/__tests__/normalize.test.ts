import { describe, it, expect } from "vitest";
import {
  normalizeRow,
  isGarbagePermit,
  extractOwnerName,
  cleanTylerAddress,
  parseAddress,
  mapPermitTypeToEnum,
  mapPermitTypeToTrade,
  mapStatusToEnum,
  deduplicatePermits,
  type RawPermitRow,
} from "../normalize";

/* ── Helper to create a raw row ───────────────────────────────────────── */

function makeRow(overrides: Partial<RawPermitRow> = {}): RawPermitRow {
  return {
    id: 1,
    permit_number: "RES-PLM-26-003996",
    permit_type: "Residential Plumbing Permit",
    address: "INSTALL NEW PLUMBING SYSTEMS FOR NEW HOUSE.",
    status: "1223 SEMINOLE DR, Dallas TX 75217",
    description: "1223 SEMINOLE DR, Dallas, TX 75217 : ADAN MARTINEZ",
    city: "Dallas",
    state: "TX",
    county: "Dallas",
    vendor: "accela",
    source_url: "https://aca-prod.accela.com/DALLASTX/Default.aspx",
    scraped_date: "2026-04-15",
    created_at: "2026-04-15 12:00:00",
    ...overrides,
  };
}

function makeTylerRow(overrides: Partial<RawPermitRow> = {}): RawPermitRow {
  return {
    id: 2337,
    permit_number: "B24-0001",
    permit_type: "Building Permit (Commercial) - Tenant Improvement/Alteration",
    address: "21039 FIGUEROA ST ST Unit: 100 CARSON, CA CA 90745",
    status: "Complete",
    description: "DISH WIRELESS ROOFTOP WIRELESS TELECOM FACILITY",
    city: "Carson",
    state: "CA",
    county: "Los Angeles",
    vendor: "tyler",
    source_url: "https://cityofcarsonca-energovweb.tylerhost.net/apps/selfservice",
    scraped_date: "2026-04-15",
    created_at: "2026-04-15 12:00:00",
    ...overrides,
  };
}

function makeEtrakitRow(overrides: Partial<RawPermitRow> = {}): RawPermitRow {
  return {
    id: 3837,
    permit_number: "18-00001",
    permit_type: "Permit",
    address: "5905 CHARLESTON DR",
    status: "",
    description: "CWE GROUP INC",
    city: "Frisco",
    state: "TX",
    county: "Collin",
    vendor: "etrakit",
    source_url: "https://etrakit.friscotexas.gov/etrakit/Search/permit.aspx",
    scraped_date: "2026-04-15",
    created_at: "2026-04-15 12:00:00",
    ...overrides,
  };
}

/* ── isGarbagePermit ──────────────────────────────────────────────────── */

describe("isGarbagePermit", () => {
  it("rejects permits with INVALID in number", () => {
    expect(isGarbagePermit(makeRow({ permit_number: "(INVALIDDONOTUSE)PP-2024-17023" }))).toBe(true);
  });

  it("rejects permits with test in number", () => {
    expect(isGarbagePermit(makeRow({ permit_number: "10-14-2020 11-29-AM - test simple project" }))).toBe(true);
  });

  it("rejects bare 1-3 digit numbers", () => {
    expect(isGarbagePermit(makeRow({ permit_number: "10" }))).toBe(true);
    expect(isGarbagePermit(makeRow({ permit_number: "100" }))).toBe(true);
  });

  it("rejects admin permit types", () => {
    expect(isGarbagePermit(makeRow({ permit_type: "Add Contractor License To a Record" }))).toBe(true);
    expect(isGarbagePermit(makeRow({ permit_type: "Change of Contact Information" }))).toBe(true);
  });

  it("accepts valid permits", () => {
    expect(isGarbagePermit(makeRow())).toBe(false);
    expect(isGarbagePermit(makeTylerRow())).toBe(false);
  });
});

/* ── extractOwnerName ─────────────────────────────────────────────────── */

describe("extractOwnerName", () => {
  it("extracts name from 'address : name' pattern", () => {
    const result = extractOwnerName("8200 WALNUT HILL LN, Dallas, TX 75231 : Arturo Galaviz");
    expect(result).not.toBeNull();
    expect(result!.fullName).toBe("Arturo Galaviz");
    expect(result!.firstName).toBe("Arturo");
    expect(result!.lastName).toBe("Galaviz");
  });

  it("extracts ALL CAPS names", () => {
    const result = extractOwnerName("1223 SEMINOLE DR, Dallas, TX 75217 : ADAN MARTINEZ");
    expect(result!.fullName).toBe("Adan Martinez");
    expect(result!.firstName).toBe("Adan");
    expect(result!.lastName).toBe("Martinez");
  });

  it("handles multi-word last names", () => {
    const result = extractOwnerName("addr : MOHAMMAD SHOUROV HOSSAIN");
    expect(result!.firstName).toBe("Mohammad");
    expect(result!.lastName).toBe("Shourov Hossain");
  });

  it("extracts the address portion", () => {
    const result = extractOwnerName("8200 WALNUT HILL LN, Dallas, TX 75231 : Owner");
    expect(result!.address).toBe("8200 WALNUT HILL LN, Dallas, TX 75231");
  });

  it("returns null for non-matching strings", () => {
    expect(extractOwnerName("Just some description text")).toBeNull();
    expect(extractOwnerName(null)).toBeNull();
    expect(extractOwnerName("")).toBeNull();
  });
});

/* ── cleanTylerAddress ────────────────────────────────────────────────── */

describe("cleanTylerAddress", () => {
  it("removes doubled street suffixes", () => {
    expect(cleanTylerAddress("21039 FIGUEROA ST ST")).toBe("21039 FIGUEROA ST");
    expect(cleanTylerAddress("514 238TH PL PL")).toBe("514 238TH PL");
    expect(cleanTylerAddress("21601 S AVALON BLVD BLVD")).toBe("21601 S AVALON BLVD");
    expect(cleanTylerAddress("20307 GOMERO CIR CIR")).toBe("20307 GOMERO CIR");
    expect(cleanTylerAddress("18724 BILLINGS AVE AVE")).toBe("18724 BILLINGS AVE");
  });

  it("fixes doubled city/state", () => {
    expect(cleanTylerAddress("FIGUEROA ST Unit: 100 CARSON, CA CA 90745")).toBe(
      "FIGUEROA ST Unit 100 CARSON, CA 90745",
    );
  });

  it("leaves clean addresses unchanged", () => {
    expect(cleanTylerAddress("937 E 222ND ST Carson CA 90745")).toBe(
      "937 E 222ND ST Carson CA 90745",
    );
  });
});

/* ── parseAddress ─────────────────────────────────────────────────────── */

describe("parseAddress", () => {
  it("extracts ZIP from Dallas address", () => {
    const result = parseAddress("8200 WALNUT HILL LN, Dallas TX 75231", "Dallas", "TX");
    expect(result.zip).toBe("75231");
  });

  it("extracts ZIP from Carson address", () => {
    const result = parseAddress("937 E 222ND ST Carson CA 90745", "Carson", "CA");
    expect(result.zip).toBe("90745");
  });

  it("strips city and state from street", () => {
    const result = parseAddress("8200 WALNUT HILL LN, Dallas TX 75231", "Dallas", "TX");
    expect(result.street).not.toContain("Dallas");
    expect(result.street).not.toContain("75231");
    expect(result.street).toContain("WALNUT HILL");
  });

  it("returns null zip when no 5-digit number", () => {
    const result = parseAddress("5905 CHARLESTON DR", "Frisco", "TX");
    expect(result.zip).toBeNull();
  });
});

/* ── mapPermitTypeToEnum ──────────────────────────────────────────────── */

describe("mapPermitTypeToEnum", () => {
  it("maps residential types", () => {
    expect(mapPermitTypeToEnum("Residential Plumbing Permit")).toBe("residential");
    expect(mapPermitTypeToEnum("Electrical - 1-2 Family")).toBe("residential");
  });

  it("maps commercial types", () => {
    expect(mapPermitTypeToEnum("Commercial Electrical Permit")).toBe("commercial");
    // A commercial tenant improvement classifies as commercial, not renovation
    // (the `commercial` check now precedes the project-type buckets).
    expect(mapPermitTypeToEnum("Building Permit (Commercial) - Tenant Improvement/Alteration")).toBe("commercial");
  });

  it("maps demolition types", () => {
    expect(mapPermitTypeToEnum("Residential Demolition Permit")).toBe("demolition");
    expect(mapPermitTypeToEnum("Wrecking Permit-1-2 Family")).toBe("demolition");
  });

  it("maps new construction", () => {
    expect(mapPermitTypeToEnum("Residential New Construction Permit")).toBe("new_construction");
    expect(mapPermitTypeToEnum("SINGLE FAMILY HOME OR DUPLEX")).toBe("new_construction");
  });

  it("maps renovation/alteration", () => {
    expect(mapPermitTypeToEnum("Residential Alteration Addition Permit")).toBe("renovation");
    expect(mapPermitTypeToEnum("Residential - Remodel Bathroom")).toBe("renovation");
  });

  it("defaults to other", () => {
    expect(mapPermitTypeToEnum("Legacy Permit - Legacy Building Safety")).toBe("other");
  });
});

/* ── mapPermitTypeToTrade ─────────────────────────────────────────────── */

describe("mapPermitTypeToTrade", () => {
  it("maps roofing trades", () => {
    expect(mapPermitTypeToTrade("Residential - Re-Roof")).toBe("roofing");
    expect(mapPermitTypeToTrade("RE-ROOF")).toBe("roofing");
    expect(mapPermitTypeToTrade("Residential Roofing Permit")).toBe("roofing");
  });

  it("maps plumbing trades", () => {
    expect(mapPermitTypeToTrade("Residential Plumbing Permit")).toBe("plumbing");
    expect(mapPermitTypeToTrade("RESIDENTIAL PLUMBING")).toBe("plumbing");
    expect(mapPermitTypeToTrade("Residential - Water Heater Replacement")).toBe("plumbing");
  });

  it("maps HVAC trades", () => {
    expect(mapPermitTypeToTrade("Residential HVAC Replacement")).toBe("hvac");
    expect(mapPermitTypeToTrade("Heating & Cooling - 1-2 Family")).toBe("hvac");
    expect(mapPermitTypeToTrade("Commercial Mechanical Permit")).toBe("hvac");
  });

  it("maps electrical trades", () => {
    expect(mapPermitTypeToTrade("Electrical - 1-2 Family")).toBe("electrical");
    expect(mapPermitTypeToTrade("RESIDENTIAL NEW ELECTRICAL")).toBe("electrical");
  });

  it("maps solar trades", () => {
    expect(mapPermitTypeToTrade("Residential Solar/PV Permit")).toBe("solar");
  });

  it("maps fencing", () => {
    expect(mapPermitTypeToTrade("FENCE")).toBe("fencing");
  });

  it("defaults to general for generic types", () => {
    expect(mapPermitTypeToTrade("Building Plan Revision")).toBe("general");
    expect(mapPermitTypeToTrade("Legacy Permit - Legacy Building Safety")).toBe("general");
  });
});

/* ── mapStatusToEnum ──────────────────────────────────────────────────── */

describe("mapStatusToEnum", () => {
  it("maps Tyler statuses", () => {
    expect(mapStatusToEnum("tyler", "Complete")).toBe("final");
    expect(mapStatusToEnum("tyler", "Issued")).toBe("issued");
    expect(mapStatusToEnum("tyler", "Expired")).toBe("expired");
    expect(mapStatusToEnum("tyler", "Void")).toBe("revoked");
    expect(mapStatusToEnum("tyler", "In Review")).toBe("submitted");
  });

  it("maps Accela statuses", () => {
    expect(mapStatusToEnum("accela", "Open")).toBe("submitted");
    expect(mapStatusToEnum("accela", "Issued")).toBe("issued");
  });

  it("defaults to submitted for empty/unknown", () => {
    expect(mapStatusToEnum("etrakit", "")).toBe("submitted");
    expect(mapStatusToEnum("tyler", "unknown_status")).toBe("submitted");
  });
});

/* ── deduplicatePermits ───────────────────────────────────────────────── */

describe("deduplicatePermits", () => {
  it("removes duplicate rows by permit_number + city + vendor", () => {
    const rows = [
      makeRow({ id: 1 }),
      makeRow({ id: 2 }), // same permit_number + city
      makeRow({ id: 3, permit_number: "DIFFERENT-001" }),
    ];
    const result = deduplicatePermits(rows);
    expect(result).toHaveLength(2);
  });

  it("keeps permits from different cities", () => {
    const rows = [
      makeRow({ id: 1, city: "Dallas" }),
      makeRow({ id: 2, city: "Houston" }),
    ];
    const result = deduplicatePermits(rows);
    expect(result).toHaveLength(2);
  });

  it("keeps permits from different vendors", () => {
    const rows = [
      makeRow({ id: 1, vendor: "accela" }),
      { ...makeRow({ id: 2 }), vendor: "tyler" as const },
    ];
    const result = deduplicatePermits(rows);
    expect(result).toHaveLength(2);
  });
});

/* ── normalizeRow (integration) ───────────────────────────────────────── */

describe("normalizeRow", () => {
  describe("Accela", () => {
    it("swaps address/status columns and extracts owner", () => {
      const result = normalizeRow(makeRow());
      expect(result).not.toBeNull();
      expect(result!.address).toContain("SEMINOLE");
      expect(result!.zip).toBe("75217");
      expect(result!.ownerName).toBe("Adan Martinez");
      expect(result!.ownerFirst).toBe("Adan");
      expect(result!.ownerLast).toBe("Martinez");
      expect(result!.description).toBe("INSTALL NEW PLUMBING SYSTEMS FOR NEW HOUSE.");
    });
  });

  describe("Tyler", () => {
    it("cleans doubled suffixes and extracts ZIP", () => {
      const result = normalizeRow(makeTylerRow());
      expect(result).not.toBeNull();
      expect(result!.address).not.toContain("ST ST");
      expect(result!.zip).toBe("90745");
      expect(result!.statusEnum).toBe("final");
      expect(result!.description).toBe("DISH WIRELESS ROOFTOP WIRELESS TELECOM FACILITY");
    });
  });

  describe("Etrakit", () => {
    it("preserves address and captures contractor name", () => {
      const result = normalizeRow(makeEtrakitRow());
      expect(result).not.toBeNull();
      expect(result!.address).toBe("5905 CHARLESTON DR");
      expect(result!.contractorName).toBe("CWE GROUP INC");
      expect(result!.description).toBeNull();
      expect(result!.statusEnum).toBe("submitted");
    });
  });

  it("returns null for garbage permits", () => {
    const result = normalizeRow(makeRow({ permit_number: "(INVALIDDONOTUSE)PP-2024" }));
    expect(result).toBeNull();
  });
});
