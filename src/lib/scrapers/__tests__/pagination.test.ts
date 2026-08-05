import { describe, it, expect } from "vitest";
import { decideNextPage } from "../arcgis";
import { readCursor, readCursorUpdatedAt, writeCursor } from "../cursor";
import { withDiagnostic } from "../types";

/**
 * Pagination + cursor tests.
 *
 * These cover the two paging bugs that capped ingest:
 *   - ArcGIS stopped after page 0 whenever `exceededTransferLimit` was absent
 *     (it is an OPTIONAL field), and treated any short page as the last page
 *     even when the server had merely capped it below the requested size.
 *   - Every run restarted at offset 0, so each source was permanently capped
 *     at maxPages x pageSize = 20,000 rows.
 */

describe("decideNextPage", () => {
  it("keeps paging while the page is full — WITHOUT needing exceededTransferLimit", () => {
    // The original bug: `!data.exceededTransferLimit` broke the loop, so
    // servers that never send the optional flag ingested exactly one page.
    const d = decideNextPage(1000, 1000, undefined);
    expect(d.next).toBe(true);
    expect(d.reachedEnd).toBe(false);
    expect(d.pageSize).toBe(1000);
  });

  it("keeps paging on a full page when the flag is explicitly false", () => {
    expect(decideNextPage(1000, 1000, false).next).toBe(true);
  });

  it("adopts the server's real cap when it truncates but flags more data", () => {
    // Columbus caps maxRecordCount at 500. Asking for 1000 returns 500 with
    // exceededTransferLimit=true; the old `features.length < 1000` check read
    // that as the last page and quit at 0.15% of the catalog.
    const d = decideNextPage(500, 1000, true);
    expect(d.next).toBe(true);
    expect(d.pageSize).toBe(500);
    expect(d.reachedEnd).toBe(false);
  });

  it("stops on a genuinely short final page", () => {
    const d = decideNextPage(137, 1000, undefined);
    expect(d.next).toBe(false);
    expect(d.reachedEnd).toBe(true);
  });

  it("stops on an empty page and reports end-of-feed", () => {
    const d = decideNextPage(0, 1000, true);
    expect(d.next).toBe(false);
    expect(d.reachedEnd).toBe(true);
  });

  it("keeps paging when a server returns MORE than requested", () => {
    // Some ArcGIS deployments ignore resultRecordCount and return their own
    // max. Treat that as a full page rather than an end condition.
    expect(decideNextPage(2000, 1000, true).next).toBe(true);
  });

  it("never proposes a zero or negative page size", () => {
    const d = decideNextPage(0, 500, true);
    expect(d.pageSize).toBeGreaterThan(0);
  });
});

describe("per-source cursor", () => {
  const T0 = new Date("2026-08-01T00:00:00.000Z");

  it("round-trips an offset so the next run resumes instead of restarting", () => {
    const notes = writeCursor(null, 20000, T0);
    expect(readCursor(notes)).toBe(20000);
    expect(readCursorUpdatedAt(notes)).toBe(T0.toISOString());
  });

  it("advances across runs", () => {
    let notes = writeCursor(null, 20000, T0);
    notes = writeCursor(notes, 40000, T0);
    expect(readCursor(notes)).toBe(40000);
    // Exactly one block — no unbounded growth in the notes column.
    expect(notes.match(/\[henri:scrape-cursor\]/g)).toHaveLength(1);
  });

  it("clears the block when the feed wraps to 0", () => {
    const notes = writeCursor(writeCursor(null, 20000, T0), 0, T0);
    expect(notes).not.toContain("henri:scrape-cursor");
    // Absent == start from the newest rows.
    expect(readCursor(notes)).toBe(0);
  });

  it("preserves operator prose in notes", () => {
    const notes = writeCursor("Verified by founder 2026-05-01. Do not disable.", 500, T0);
    expect(notes).toContain("Verified by founder 2026-05-01. Do not disable.");
    expect(readCursor(notes)).toBe(500);
  });

  it("coexists with the failure diagnostic block", () => {
    // Both blocks live in `notes`; each writer must only touch its own tags.
    let notes = withDiagnostic("operator note", "outcome=mapping_failed | keys: a,b");
    notes = writeCursor(notes, 7000, T0);
    expect(readCursor(notes)).toBe(7000);
    expect(notes).toContain("operator note");
    expect(notes).toContain("outcome=mapping_failed");

    // Rewriting the diagnostic must not disturb the cursor.
    notes = withDiagnostic(notes, "outcome=fetch_failed");
    expect(readCursor(notes)).toBe(7000);
    expect(notes).toContain("outcome=fetch_failed");
    expect(notes).not.toContain("outcome=mapping_failed");
  });

  it("degrades to 0 on absent, malformed or non-positive values", () => {
    expect(readCursor(null)).toBe(0);
    expect(readCursor("")).toBe(0);
    expect(readCursor("just operator prose")).toBe(0);
    expect(readCursor("[henri:scrape-cursor] garbage [/henri:scrape-cursor]")).toBe(0);
    // Unterminated block.
    expect(readCursor("[henri:scrape-cursor] offset=5")).toBe(0);
    expect(readCursorUpdatedAt(null)).toBeNull();
  });

  it("never stores a non-finite or negative offset", () => {
    expect(writeCursor(null, Number.NaN, T0)).not.toContain("henri:scrape-cursor");
    expect(writeCursor(null, -5, T0)).not.toContain("henri:scrape-cursor");
  });
});
