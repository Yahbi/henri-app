/**
 * Tests for `src/lib/enrichment/description-miner.ts`.
 *
 * This is the only key-free enrichment source that still finds contact data
 * on Henri's corpus, so its two guards are load-bearing:
 *
 *   1. It must never surface the permit-issuing AUTHORITY as a lead contact.
 *      Measured 2026-08-07: of 292 email-shaped strings in `permits.raw_json`
 *      across a 5% lead sample, 290 were `<staff-id>@hartford.gov` — the city
 *      inspector assigned to the file. Writing those to `leads.email` would
 *      point homeowner-voiced outreach at a municipal employee.
 *
 *   2. It must never surface a CONTRACTOR's phone as the homeowner's. That
 *      decision was made on 2026-08-05 in `src/lib/ingest/extract-contact.ts`
 *      (contractor phone in `leads.phone` => Henri texts a competing
 *      contractor a message written in the homeowner's voice; TCPA exposure
 *      on a business line). `collectMinableText` is a second door into the
 *      same column, so it enforces the same rule.
 */
import { describe, it, expect } from "vitest";
import {
  mineDescription,
  mineMultiple,
  collectMinableText,
} from "../description-miner";

describe("mineDescription — phone extraction", () => {
  it("extracts a separator-formatted phone and normalizes it", () => {
    expect(mineDescription("Re-roof per plans. Contact John Smith 555-123-4567").phones)
      .toEqual(["555-123-4567"]);
    expect(mineDescription("Install 4-ton HVAC. Owner: Maria Gonzalez, (512) 555-9012").phones)
      .toEqual(["512-555-9012"]);
    expect(mineDescription("Emergency repair - call Tom 650/555/8899").phones)
      .toEqual(["650-555-8899"]);
  });

  it("rejects bare 10-digit runs, which are permit IDs and parcel numbers", () => {
    // The corpus is full of these: objectid 1066957623, apn 2004017007,
    // bbl 1000430002, tcad_id 0113630704. Requiring a separator is what keeps
    // them out of leads.phone.
    expect(mineDescription("permit 4081234567 issued").phones).toEqual([]);
    expect(mineDescription("APN 2004017007").phones).toEqual([]);
  });

  it("rejects toll-free area codes (businesses, not homeowners)", () => {
    expect(mineDescription("call 800-555-1234").phones).toEqual([]);
    expect(mineDescription("call 888-555-1234").phones).toEqual([]);
  });

  it("returns empty for null / empty input and never throws", () => {
    expect(mineDescription(null)).toEqual({ phones: [], emails: [] });
    expect(mineDescription(undefined)).toEqual({ phones: [], emails: [] });
    expect(mineDescription("")).toEqual({ phones: [], emails: [] });
  });
});

describe("mineDescription — authority-email rejection", () => {
  it("rejects the permit-issuing authority by domain suffix", () => {
    // The exact live shape: `ASSIGNED_TO` on Hartford CT permits.
    expect(mineDescription("Assigned to BETTW002@HARTFORD.GOV").emails).toEqual([]);
    expect(mineDescription("inspector jdoe@dc.gov").emails).toEqual([]);
    expect(mineDescription("contact planner@ci.austin.tx.us").emails).toEqual([]);
    expect(mineDescription("reach sgt@base.mil").emails).toEqual([]);
  });

  it("rejects municipal shared inboxes on vanity domains", () => {
    expect(mineDescription("email permits@cityofexample.org").emails).toEqual([]);
    expect(mineDescription("email inspections@townhall.net").emails).toEqual([]);
    expect(mineDescription("email records@borough.org").emails).toEqual([]);
  });

  it("captures multi-label domains whole rather than truncating them", () => {
    // Regression: the prior EMAIL_RE allowed one domain label plus a TLD, so
    // `owner@mail.corp.example.com` matched as `owner@mail.corp` — a malformed
    // address, and one whose real suffix the authority guard never saw.
    expect(mineDescription("owner@mail.corp.example.com").emails)
      .toEqual(["owner@mail.corp.example.com"]);
    expect(mineDescription("j.doe@sub.domain.co.uk").emails)
      .toEqual(["j.doe@sub.domain.co.uk"]);
  });

  it("still accepts a genuine party email", () => {
    expect(mineDescription("Owner contact jsmith@gmail.com for access").emails)
      .toEqual(["jsmith@gmail.com"]);
    expect(mineDescription("APARDO@KREADB.COM").emails).toEqual(["apardo@kreadb.com"]);
  });
});

describe("collectMinableText", () => {
  it("returns free-text scope values the description COLUMN does not carry", () => {
    const raw = {
      work_desc: "Installation Dishwasher, call 323-898-4128",
      DESC_OF_WORK: "AFTER HOURS WORK PERMIT",
      JobDescription: "R10 RECONNECT - MARVIN LARA - 334-600-9057",
      COMMENTS: "Brian Selby (919) 810-1158",
      permit_condition: "CONTACT SUPERVISOR 312-743-3562",
      projectdescription: "Abuse Counseling (225) 802-1218",
    };
    const texts = collectMinableText(raw);
    expect(texts).toHaveLength(6);
    expect(mineMultiple(texts).phones).toEqual(
      expect.arrayContaining([
        "323-898-4128",
        "334-600-9057",
        "919-810-1158",
        "312-743-3562",
        "225-802-1218",
      ]),
    );
  });

  it("EXCLUDES contractor-attributed keys — upholds the 2026-08-05 decision", () => {
    // Verbatim shapes from the live corpus. These account for 91% of every
    // phone number recoverable from raw_json and must stay out of leads.phone.
    const raw = {
      contractor: "1ST CLASS PLUMBING 1108 summit ave #3, plano, TX 75074 (214) 227-9554",
      ContractorPhone: "407-323-2102",
      contractor_phone: "210-373-6003",
      contractorphone: "602-540-3995",
      builder_phone: "555-123-9999",
      gc_phone: "555-123-8888",
      contractor_description: "roofing work, call 214-555-0000",
    };
    expect(collectMinableText(raw)).toEqual([]);
    expect(mineMultiple(collectMinableText(raw)).phones).toEqual([]);
  });

  it("ignores keys that are not free text", () => {
    const raw = {
      objectid: "1066957623",
      apn: "2004017007",
      address: "123 Main St",
      owner: "Al Quaglien 518-489-8016",
      status: "ISSUED",
    };
    // `owner` is a name field, not prose — the structured extractor owns it.
    expect(collectMinableText(raw)).toEqual([]);
  });

  it("skips non-string values, blanks, arrays and non-objects", () => {
    expect(collectMinableText({ description: 12345 })).toEqual([]);
    expect(collectMinableText({ description: null })).toEqual([]);
    expect(collectMinableText({ description: "   " })).toEqual([]);
    expect(collectMinableText(null)).toEqual([]);
    expect(collectMinableText(undefined)).toEqual([]);
    expect(collectMinableText("not an object")).toEqual([]);
    expect(collectMinableText([{ description: "x" }])).toEqual([]);
  });

  it("caps a single value so a pathological blob cannot stall the scan", () => {
    const texts = collectMinableText({ description: "a".repeat(20_000) });
    expect(texts).toHaveLength(1);
    expect(texts[0]!.length).toBe(8_000);
  });

  it("never lets an authority email through the raw_json door", () => {
    // ASSIGNED_TO is not a free-text key, but even if a municipality puts the
    // inspector's address in the scope text, the email guard catches it.
    const raw = { description: "Assigned inspector BETTW002@HARTFORD.GOV, call 860-555-1212" };
    const mined = mineMultiple(collectMinableText(raw));
    expect(mined.emails).toEqual([]);
    expect(mined.phones).toEqual(["860-555-1212"]);
  });
});
