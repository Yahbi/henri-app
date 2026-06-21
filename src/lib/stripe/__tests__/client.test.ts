/**
 * getStripe regression test (2026-06-17 deep-eval fix).
 *
 * getStripe used to read getEnv().stripeSecretKey, and getEnv() eagerly
 * validates ~18 unrelated vars (Twilio, OpenAI, Mapbox), throwing in
 * production if any is missing. That killed every Stripe path when Twilio
 * was unprovisioned. getStripe must now depend ONLY on STRIPE_SECRET_KEY.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getStripe } from "../client";

const SAVED = { ...process.env };

describe("getStripe", () => {
  beforeEach(() => {
    // Wipe the unrelated subsystem vars to simulate a partially-provisioned prod.
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("succeeds with only STRIPE_SECRET_KEY set (Twilio/OpenAI/Mapbox absent)", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    expect(() => getStripe()).not.toThrow();
  });

  it("throws a clear error when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });
});
