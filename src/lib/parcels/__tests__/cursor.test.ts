import { describe, it, expect } from "vitest";
import {
  PARCEL_CURSOR_OPEN,
  readParcelCursor,
  readParcelCursorUpdatedAt,
  writeParcelCursor,
} from "../cursor";
import { CURSOR_OPEN, readCursor, writeCursor } from "@/lib/scrapers/cursor";
import { buildArcgisQueryUrl } from "../endpoints";

/**
 * The cursor is what turns a fixed per-run page budget into a walk through a
 * multi-million-row feed. Without it every run re-reads page 1 and the tail
 * of WV-PARCEL-SUMMARY (1,394,081 rows) is permanently unreachable.
 */

describe("parcel cursor", () => {
  it("round-trips an offset", () => {
    expect(readParcelCursor(writeParcelCursor(null, 25_000))).toBe(25_000);
  });

  it("returns 0 for absent, malformed or non-positive values", () => {
    expect(readParcelCursor(null)).toBe(0);
    expect(readParcelCursor(undefined)).toBe(0);
    expect(readParcelCursor("just operator prose")).toBe(0);
    expect(readParcelCursor(`${PARCEL_CURSOR_OPEN} garbage [/henri:parcel-cursor]`)).toBe(0);
    expect(readParcelCursor(writeParcelCursor(null, -5))).toBe(0);
  });

  it("clears the block at end-of-feed so the next turn wraps to the start", () => {
    const withCursor = writeParcelCursor("operator prose", 25_000);
    const cleared = writeParcelCursor(withCursor, 0);
    expect(cleared).not.toContain(PARCEL_CURSOR_OPEN);
    expect(readParcelCursor(cleared)).toBe(0);
    expect(cleared).toContain("operator prose");
  });

  it("preserves operator prose verbatim across rewrites", () => {
    const prose = "PRIMARY WV SUBSTITUTE. Quarterly refresh from county assessors.";
    let notes = writeParcelCursor(prose, 1000);
    notes = writeParcelCursor(notes, 2000);
    notes = writeParcelCursor(notes, 3000);
    expect(notes).toContain(prose);
    expect(readParcelCursor(notes)).toBe(3000);
    // Exactly one block, never accumulating.
    expect(notes.split(PARCEL_CURSOR_OPEN)).toHaveLength(2);
  });

  it("records the write timestamp for operator forensics", () => {
    const at = new Date("2026-08-07T09:00:00.000Z");
    const notes = writeParcelCursor(null, 5000, at);
    expect(readParcelCursorUpdatedAt(notes)).toBe("2026-08-07T09:00:00.000Z");
    expect(readParcelCursorUpdatedAt("no block here")).toBeNull();
  });

  it("does NOT collide with the permit-scrape cursor sharing the same notes field", () => {
    // Both cursors use spliceBlock over a free-text `notes` column. Distinct
    // delimiters are the only thing keeping them independent.
    let notes = writeCursor("prose", 111);
    notes = writeParcelCursor(notes, 222);
    expect(readCursor(notes)).toBe(111);
    expect(readParcelCursor(notes)).toBe(222);
    expect(notes).toContain(CURSOR_OPEN);
    expect(notes).toContain(PARCEL_CURSOR_OPEN);

    // Clearing one must leave the other intact.
    const cleared = writeParcelCursor(notes, 0);
    expect(readCursor(cleared)).toBe(111);
    expect(readParcelCursor(cleared)).toBe(0);
  });
});

describe("buildArcgisQueryUrl", () => {
  it("appends /query to a bare layer URL", () => {
    const url = buildArcgisQueryUrl(
      "https://example.com/arcgis/rest/services/X/MapServer/0",
      0,
      1000,
    );
    expect(url).toContain("/MapServer/0/query?");
  });

  it("does not double up when the registry row already ends in /query", () => {
    // Both spellings exist in the live registry: the migration-00085 seeds
    // carry /query, the later research-session rows do not.
    const url = buildArcgisQueryUrl(
      "https://example.com/arcgis/rest/services/X/FeatureServer/0/query",
      0,
      1000,
    );
    expect(url.match(/\/query/g)).toHaveLength(1);
  });

  it("tolerates a trailing slash", () => {
    const url = buildArcgisQueryUrl("https://example.com/FeatureServer/0/", 0, 1000);
    expect(url).toContain("/FeatureServer/0/query?");
  });

  it("carries the paging parameters and suppresses geometry", () => {
    const url = buildArcgisQueryUrl("https://example.com/FeatureServer/0", 4000, 500);
    expect(url).toContain("resultOffset=4000");
    expect(url).toContain("resultRecordCount=500");
    // Geometry would balloon each page to hundreds of MB for parcel polygons
    // and blow the fetch budget; the sidecar only needs attributes.
    expect(url).toContain("returnGeometry=false");
  });
});
