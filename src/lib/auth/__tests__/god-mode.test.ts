/* ── god-mode.test.ts ────────────────────────────────────────────────────
 *
 *  The god-mode allowlist is a security-critical surface — any user
 *  whose email returns true bypasses plan-based caps + sees all admin
 *  pages. Contract:
 *
 *    1. Default allowlist is the founder's two emails (y.abismuth +
 *       waspinc20).
 *    2. GOD_MODE_EMAILS env var fully overrides the default.
 *    3. Comparison is case-insensitive (per RFC 5321 — local-parts
 *       are technically case-sensitive but every real-world mailer
 *       treats them as case-folded).
 *    4. null / undefined / empty inputs always return false.
 *    5. Whitespace around env-var entries is tolerated.
 * ─────────────────────────────────────────────────────────────────────── */

import { afterEach, describe, expect, it } from "vitest";
import { isGodModeEmail } from "../god-mode";

const ORIGINAL_ENV = process.env.GOD_MODE_EMAILS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.GOD_MODE_EMAILS;
  else process.env.GOD_MODE_EMAILS = ORIGINAL_ENV;
});

describe("isGodModeEmail — default allowlist", () => {
  it("returns true for y.abismuth@gmail.com", () => {
    delete process.env.GOD_MODE_EMAILS;
    expect(isGodModeEmail("y.abismuth@gmail.com")).toBe(true);
  });

  it("returns true for waspinc20@gmail.com (added in commit 1801ed5)", () => {
    delete process.env.GOD_MODE_EMAILS;
    expect(isGodModeEmail("waspinc20@gmail.com")).toBe(true);
  });

  it("returns false for any other email by default", () => {
    delete process.env.GOD_MODE_EMAILS;
    expect(isGodModeEmail("attacker@evil.com")).toBe(false);
    expect(isGodModeEmail("contractor@henri-customer.example")).toBe(false);
  });
});

describe("isGodModeEmail — null / empty inputs", () => {
  it("returns false for null", () => {
    expect(isGodModeEmail(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isGodModeEmail(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGodModeEmail("")).toBe(false);
  });
});

describe("isGodModeEmail — case sensitivity", () => {
  it("matches case-insensitively against the default allowlist", () => {
    delete process.env.GOD_MODE_EMAILS;
    expect(isGodModeEmail("Y.ABISMUTH@GMAIL.COM")).toBe(true);
    expect(isGodModeEmail("Y.Abismuth@Gmail.com")).toBe(true);
  });

  it("matches case-insensitively against env-var entries", () => {
    process.env.GOD_MODE_EMAILS = "ADMIN@example.com";
    expect(isGodModeEmail("admin@example.com")).toBe(true);
    expect(isGodModeEmail("Admin@Example.com")).toBe(true);
  });
});

describe("isGodModeEmail — env-var override", () => {
  it("respects GOD_MODE_EMAILS as a comma-separated list", () => {
    process.env.GOD_MODE_EMAILS = "alice@example.com,bob@example.com";
    expect(isGodModeEmail("alice@example.com")).toBe(true);
    expect(isGodModeEmail("bob@example.com")).toBe(true);
    expect(isGodModeEmail("y.abismuth@gmail.com")).toBe(false);
  });

  it("tolerates whitespace around entries", () => {
    process.env.GOD_MODE_EMAILS = "  alice@example.com  ,\tbob@example.com\n";
    expect(isGodModeEmail("alice@example.com")).toBe(true);
    expect(isGodModeEmail("bob@example.com")).toBe(true);
  });

  it("an empty env var produces an empty allowlist — explicit lockdown", () => {
    process.env.GOD_MODE_EMAILS = "";
    // Empty string IS the allowlist (?? doesn't fall through on ""), so
    // setting GOD_MODE_EMAILS="" is the way to disable god-mode entirely
    // in production without a code change. Even the default founder
    // emails are locked out.
    expect(isGodModeEmail("y.abismuth@gmail.com")).toBe(false);
    expect(isGodModeEmail("waspinc20@gmail.com")).toBe(false);
  });

  it("a single-email env var works", () => {
    process.env.GOD_MODE_EMAILS = "solo@admin.com";
    expect(isGodModeEmail("solo@admin.com")).toBe(true);
    expect(isGodModeEmail("y.abismuth@gmail.com")).toBe(false);
  });

  it("filters out empty-string entries from a malformed list", () => {
    process.env.GOD_MODE_EMAILS = "alice@x.com,,,bob@x.com";
    // Empty strings between commas should not match the empty-input
    // case (which is already false).
    expect(isGodModeEmail("alice@x.com")).toBe(true);
    expect(isGodModeEmail("bob@x.com")).toBe(true);
    expect(isGodModeEmail("")).toBe(false);
  });
});
