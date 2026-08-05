import { describe, it, expect, vi, afterEach } from "vitest";
import { buildProbeUrl, classifyProbePayload, probeArcGISDataset } from "../probe";

/**
 * Activation-probe tests.
 *
 * The gate this covers is the reason ~2,642 enabled `permit_sources` rows
 * pointed at business-licence / utility / wetland datasets: the activation
 * cron flipped `enabled=true` without ever fetching a row. Every case below
 * is a shape that used to be activated blind.
 */

describe("buildProbeUrl", () => {
  it("appends /query to a bare layer URL", () => {
    expect(buildProbeUrl("https://gis.city.gov/rest/services/P/FeatureServer/0")).toContain(
      "/FeatureServer/0/query?",
    );
  });

  it("does not double up when the endpoint already ends in /query", () => {
    const url = buildProbeUrl("https://gis.city.gov/x/MapServer/3/query");
    expect(url.match(/\/query/g)).toHaveLength(1);
  });

  it("drops an existing query string instead of appending after it", () => {
    // `.../FeatureServer/0?f=json` + "/query" would be unanswerable.
    const url = buildProbeUrl("https://gis.city.gov/x/FeatureServer/0?f=json&where=1=1");
    expect(url).toBe(
      "https://gis.city.gov/x/FeatureServer/0/query" +
        "?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1&f=json",
    );
  });

  it("tolerates trailing slashes and surrounding whitespace", () => {
    expect(buildProbeUrl("  https://gis.city.gov/x/FeatureServer/0//  ")).toContain(
      "/FeatureServer/0/query?",
    );
  });

  it("asks for exactly one row without geometry", () => {
    const url = buildProbeUrl("https://x/FeatureServer/0");
    expect(url).toContain("resultRecordCount=1");
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("outFields=*");
  });
});

describe("classifyProbePayload", () => {
  it("rejects a business-licence payload", () => {
    // Elk Grove: 20,000 business-licence rows landed in `permits`.
    const probe = classifyProbePayload({
      features: [
        {
          attributes: {
            OBJECTID: 1,
            LICENSE_NUMBER: "BL-1",
            LICENSE_SUBTYPE: "retail",
            SITE_UNIT_NO: "A",
          },
        },
      ],
    });
    expect(probe.verdict).toBe("non_permit");
    expect(probe.reason).toContain("non-permit dataset");
    expect(probe.observedKeys).toContain("LICENSE_NUMBER");
  });

  it("rejects a sewer-wye inventory", () => {
    const probe = classifyProbePayload({
      features: [{ attributes: { OBJECTID: 9, WYE_NO: "12", DEPTH: 4 } }],
    });
    expect(probe.verdict).toBe("non_permit");
  });

  it("passes an ordinary permit payload", () => {
    const probe = classifyProbePayload({
      features: [
        { attributes: { PERMIT_NUMBER: "P-1", ISSUE_DATE: 1, ADDRESS: "1 Main St" } },
      ],
    });
    expect(probe.verdict).toBe("permit");
    expect(probe.reason).toBeNull();
  });

  it("falls back to the field schema when the layer is currently empty", () => {
    // An empty layer is a normal state for a low-volume jurisdiction — it must
    // not be mistaken for "no evidence", but it still has to be classifiable.
    const probe = classifyProbePayload({
      features: [],
      fields: [{ name: "LICENSE_NUMBER" }, { name: "OBJECTID" }],
    });
    expect(probe.verdict).toBe("non_permit");
    expect(probe.observedKeys).toEqual(["LICENSE_NUMBER", "OBJECTID"]);
  });

  it("passes an empty layer whose schema is permit-shaped", () => {
    const probe = classifyProbePayload({
      features: [],
      fields: [{ name: "PermitNumber" }, { name: "IssuedDate" }],
    });
    expect(probe.verdict).toBe("permit");
  });

  it("is unreachable — never 'permit' — when there is no evidence at all", () => {
    // The dangerous default: no rows, no schema used to mean "activate".
    expect(classifyProbePayload({ features: [], fields: [] }).verdict).toBe("unreachable");
    expect(classifyProbePayload({}).verdict).toBe("unreachable");
    expect(classifyProbePayload(null).verdict).toBe("unreachable");
    expect(classifyProbePayload("<html>404</html>").verdict).toBe("unreachable");
  });

  it("surfaces an ArcGIS error envelope as unreachable with the upstream message", () => {
    const probe = classifyProbePayload({ error: { message: "Invalid URL" } });
    expect(probe.verdict).toBe("unreachable");
    expect(probe.reason).toContain("Invalid URL");
  });

  it("ignores null feature slots and reads the first row that has attributes", () => {
    const probe = classifyProbePayload({
      features: [null, { attributes: { WYE_NO: "1" } }],
    });
    expect(probe.verdict).toBe("non_permit");
  });
});

describe("probeArcGISDataset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unreachable without a fetch when the endpoint is blank", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const probe = await probeArcGISDataset("   ");
    expect(probe.verdict).toBe("unreachable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a non-2xx response to unreachable, not to a pass", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const probe = await probeArcGISDataset("https://x/FeatureServer/0");
    expect(probe.verdict).toBe("unreachable");
    expect(probe.reason).toContain("404");
  });

  it("maps a thrown transport error to unreachable and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ETIMEDOUT"); }));
    const probe = await probeArcGISDataset("https://x/FeatureServer/0");
    expect(probe.verdict).toBe("unreachable");
    expect(probe.reason).toContain("ETIMEDOUT");
  });

  it("classifies a live permit payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ features: [{ attributes: { PermitNumber: "1", ADDRESS: "x" } }] }),
      })),
    );
    const probe = await probeArcGISDataset("https://x/FeatureServer/0");
    expect(probe.verdict).toBe("permit");
  });
});
