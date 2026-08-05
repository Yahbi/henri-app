import { describe, it, expect } from "vitest";
import {
  isMappingFailure,
  isFailureOutcome,
  collectObservedKeys,
  withDiagnostic,
  buildMappingDiagnostic,
  looksLikeNonPermitDataset,
  MIN_MAPPING_SAMPLE,
  type ScrapeOutcome,
} from "../types";
import { resolveScraperKind, sniffEndpoint } from "../dispatch";
import { resolveCkanTarget } from "../ckan";

/**
 * Outcome-model tests.
 *
 * These cover the two silent-failure classes that made the scrape cron
 * unmaintainable: a wrong field mapping recorded as a success, and a
 * mis-dispatched source type recorded as an empty city.
 */

describe("isMappingFailure", () => {
  it("is not a failure when nothing was fetched (genuinely quiet feed)", () => {
    expect(isMappingFailure(0, 0, 0)).toBe(false);
  });

  it("flags a page of rows where not one yielded an id — at ANY sample size", () => {
    // An endpoint that ships rows always has some identifier. Zero IDs means
    // id_field is wrong, even on a 3-row page.
    expect(isMappingFailure(3, 0, 0)).toBe(true);
    expect(isMappingFailure(1000, 0, 0)).toBe(true);
  });

  it("flags ids-but-no-address-or-date over a decent sample", () => {
    // The ArcGIS case: resolveId falls back to OBJECTID so IDs always
    // resolve, and a full page of ID-only rows used to upsert cleanly and be
    // recorded as a success.
    expect(isMappingFailure(1000, 1000, 0)).toBe(true);
    expect(isMappingFailure(MIN_MAPPING_SAMPLE, MIN_MAPPING_SAMPLE, 0)).toBe(true);
  });

  it("does NOT flag a tiny sample with no usable rows", () => {
    // Three address-less permits is not evidence of a broken mapping.
    expect(isMappingFailure(3, 3, 0)).toBe(false);
    expect(isMappingFailure(MIN_MAPPING_SAMPLE - 1, MIN_MAPPING_SAMPLE - 1, 0)).toBe(false);
  });

  it("does not flag a healthy page", () => {
    expect(isMappingFailure(1000, 1000, 940)).toBe(false);
    // Even a single usable row proves the address/date columns exist.
    expect(isMappingFailure(1000, 1000, 1)).toBe(false);
  });
});

describe("isFailureOutcome", () => {
  it("treats only ok and empty as healthy", () => {
    expect(isFailureOutcome("ok")).toBe(false);
    // A well-formed empty response proves the endpoint works — it must reset
    // error_count, otherwise a quiet city gets culled.
    expect(isFailureOutcome("empty")).toBe(false);
  });

  it("treats every other outcome as a failure that must increment error_count", () => {
    const failures: ScrapeOutcome[] = [
      "mapping_failed",
      "fetch_failed",
      "upstream_error",
      "write_failed",
      "unsupported",
    ];
    for (const o of failures) expect(isFailureOutcome(o)).toBe(true);
  });
});

describe("collectObservedKeys", () => {
  it("captures and sorts the payload keys an operator needs", () => {
    expect(collectObservedKeys({ zebra: 1, alpha: 2 })).toEqual(["alpha", "zebra"]);
  });
  it("degrades safely on junk", () => {
    expect(collectObservedKeys(null)).toEqual([]);
    expect(collectObservedKeys(undefined)).toEqual([]);
  });
  it("truncates so notes never becomes a payload dump", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) wide[`k${i}`] = i;
    expect(collectObservedKeys(wide).length).toBeLessThanOrEqual(40);
  });
});

describe("withDiagnostic", () => {
  it("preserves operator prose and appends the machine block", () => {
    const out = withDiagnostic("Manually verified 2026-05-01 by founder.", "body-1");
    expect(out).toContain("Manually verified 2026-05-01 by founder.");
    expect(out).toContain("body-1");
  });

  it("replaces a previous block instead of appending forever", () => {
    const first = withDiagnostic("operator note", "body-1");
    const second = withDiagnostic(first, "body-2");
    expect(second).toContain("operator note");
    expect(second).toContain("body-2");
    expect(second).not.toContain("body-1");
    // Exactly one block, no unbounded growth across runs.
    expect(second.match(/\[henri:scrape-diagnostic\]/g)).toHaveLength(1);
  });

  it("works from a null / empty starting value", () => {
    expect(withDiagnostic(null, "b")).toContain("b");
    expect(withDiagnostic("", "b")).toContain("b");
  });

  it("survives a truncated block with no closing tag", () => {
    const mangled = "note\n[henri:scrape-diagnostic] half-written";
    const out = withDiagnostic(mangled, "fresh");
    expect(out).toContain("note");
    expect(out).toContain("fresh");
    expect(out).not.toContain("half-written");
  });
});

describe("buildMappingDiagnostic", () => {
  it("records what we asked for next to what actually came back", () => {
    const body = buildMappingDiagnostic({
      outcome: "mapping_failed",
      fetched: 1000,
      mapped: 1000,
      usable: 0,
      observedKeys: ["objectid", "site_unit_no", "license_number"],
      configured: { id_field: "id", address_field: "address", guessed_fields: "id_field+address_field" },
      detail: "no address or date",
      at: new Date("2026-08-04T12:00:00.000Z"),
    });
    expect(body).toContain("outcome=mapping_failed");
    expect(body).toContain("fetched=1000 mapped=1000 usable=0");
    expect(body).toContain("address_field=address");
    expect(body).toContain("guessed_fields=id_field+address_field");
    expect(body).toContain("license_number");
  });

  it("says so explicitly when no keys were captured", () => {
    const body = buildMappingDiagnostic({
      outcome: "fetch_failed",
      fetched: 0,
      mapped: 0,
      usable: 0,
      observedKeys: [],
      configured: {},
      detail: "HTTP 404",
    });
    expect(body).toContain("(none captured)");
  });
});

describe("looksLikeNonPermitDataset", () => {
  it("flags a business-licence payload with no permit-shaped column", () => {
    // Elk Grove: 20,000 business-licence rows landed in `permits`.
    const reason = looksLikeNonPermitDataset([
      "LICENSE_NUMBER",
      "LICENSE_SUBTYPE",
      "EXPIRED",
      "MAIL_ZIP",
      "SITE_UNIT_NO",
    ]);
    expect(reason).toContain("non-permit dataset");
  });

  it("flags a sewer-wye inventory", () => {
    expect(looksLikeNonPermitDataset(["OBJECTID", "WYE_NO", "DEPTH"])).not.toBeNull();
  });

  it("does NOT flag a payload that also carries a permit column", () => {
    // Contractor-licence columns often ride ALONGSIDE a real permit feed.
    expect(
      looksLikeNonPermitDataset(["PERMIT_NUMBER", "LICENSE_NUMBER", "ADDRESS"]),
    ).toBeNull();
    expect(looksLikeNonPermitDataset(["application_number", "wye_no"])).toBeNull();
  });

  it("does not flag ordinary permit payloads or an empty sample", () => {
    expect(looksLikeNonPermitDataset(["permit_number", "issue_date", "address"])).toBeNull();
    expect(looksLikeNonPermitDataset([])).toBeNull();
    expect(looksLikeNonPermitDataset(["objectid", "address", "status"])).toBeNull();
  });
});

describe("resolveScraperKind", () => {
  it("keeps the declared type for the three supported families", () => {
    expect(resolveScraperKind("arcgis", "https://x/FeatureServer/0")).toBe("arcgis");
    expect(resolveScraperKind("socrata", "https://d/resource/abcd-1234.json")).toBe("socrata");
  });

  it("routes ckan to the CKAN scraper — NOT Socrata", () => {
    // The blocker: 593 enabled ckan sources were funnelled into the Socrata
    // scraper and silently produced nothing (Boston ~658k permits).
    expect(
      resolveScraperKind("ckan", "https://data.milwaukee.gov/api/3/action/datastore_search?resource_id=x"),
    ).toBe("ckan");
  });

  it("sniffs the endpoint for junk/unknown source types instead of assuming Socrata", () => {
    expect(resolveScraperKind("unknown", "https://gis.city.gov/rest/services/P/FeatureServer/3")).toBe("arcgis");
    expect(resolveScraperKind("unknown", "https://data.city.gov/resource/ab12-cd34.json")).toBe("socrata");
    expect(resolveScraperKind("csv", "https://data.wprdc.org/datastore/dump/abc")).toBe("ckan");
  });

  it("returns unsupported — not socrata — for a portal landing page", () => {
    // These used to be dispatched to the Socrata scraper and recorded as
    // clean successes forever.
    expect(resolveScraperKind("csv", "https://providenceri.viewpointcloud.com/")).toBe("unsupported");
    expect(resolveScraperKind("html", "https://www.nashuanh.gov/278/Permits")).toBe("unsupported");
    expect(resolveScraperKind("unknown", null)).toBe("unsupported");
  });

  it("is case- and whitespace-insensitive on the declared type", () => {
    expect(resolveScraperKind("  ArcGIS ", "https://x/FeatureServer/0")).toBe("arcgis");
  });
});

describe("sniffEndpoint", () => {
  it("recognises FeatureServer and MapServer, with or without a layer index", () => {
    expect(sniffEndpoint("https://x/FeatureServer/0/query")).toBe("arcgis");
    expect(sniffEndpoint("https://x/MapServer/11")).toBe("arcgis");
    expect(sniffEndpoint("https://gis.wacotx.gov/server/rest/services/A/B/FeatureServer")).toBe("arcgis");
  });

  it("prefers a concrete Socrata resource id over a /dataset/ landing path", () => {
    expect(sniffEndpoint("https://data.x.gov/dataset/foo/resource/ab12-cd34.json")).toBe("socrata");
  });

  it("returns null when there is no recognisable signal", () => {
    expect(sniffEndpoint("https://www.census.gov/construction/bps/statemonthly.html")).toBeNull();
    expect(sniffEndpoint("")).toBeNull();
    expect(sniffEndpoint(undefined)).toBeNull();
  });
});

describe("resolveCkanTarget", () => {
  it("uses an explicit datastore_search resource_id", () => {
    expect(
      resolveCkanTarget("https://data.milwaukee.gov/api/3/action/datastore_search?resource_id=828e9630-d7cb-42e4-960e-964eae916397"),
    ).toEqual({
      kind: "resource",
      host: "https://data.milwaukee.gov",
      resourceId: "828e9630-d7cb-42e4-960e-964eae916397",
    });
  });

  it("converts a datastore dump URL to the same resource", () => {
    expect(
      resolveCkanTarget("https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7"),
    ).toEqual({
      kind: "resource",
      host: "https://data.wprdc.org",
      resourceId: "e1dcee82-9179-4306-8167-5891915b62a7",
    });
  });

  it("treats a dataset landing page as a package to resolve", () => {
    expect(resolveCkanTarget("https://data.sanantonio.gov/dataset/building-permits")).toEqual({
      kind: "package",
      host: "https://data.sanantonio.gov",
      slug: "building-permits",
    });
  });

  it("rejects file downloads and unrelated pages so they fail loudly", () => {
    // All of these are stored with source_type='ckan' in permit_sources.
    expect(
      resolveCkanTarget("https://data-fairfaxcountygis.opendata.arcgis.com/api/download/v1/items/abc/shapefile?layers=0"),
    ).toBeNull();
    expect(resolveCkanTarget("https://x.gov/parking_permits.kml")).toBeNull();
    expect(resolveCkanTarget("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC110703/")).toBeNull();
    expect(resolveCkanTarget("not a url")).toBeNull();
  });

  it("rejects a package_search call — it has no pageable resource", () => {
    expect(
      resolveCkanTarget("https://data.sanantonio.gov/api/3/action/package_search?q=permit&rows=100"),
    ).toBeNull();
  });
});
