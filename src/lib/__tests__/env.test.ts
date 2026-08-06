import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("env validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules so each test gets a fresh import
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("hasStripe returns false when env vars are missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_STARTER_PRICE_ID;
    const { hasStripe } = await import("../env");
    expect(hasStripe()).toBe(false);
  });

  it("hasStripe returns true when env vars are set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_STARTER_PRICE_ID = "price_123";
    const { hasStripe } = await import("../env");
    expect(hasStripe()).toBe(true);
  });

  it("hasSupabase returns false when env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { hasSupabase } = await import("../env");
    expect(hasSupabase()).toBe(false);
  });

  it("hasSupabase returns true when env vars are set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "key_123";
    const { hasSupabase } = await import("../env");
    expect(hasSupabase()).toBe(true);
  });

  it("hasTwilio returns false when env vars are missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    const { hasTwilio } = await import("../env");
    expect(hasTwilio()).toBe(false);
  });

  it("hasResend returns false when env var is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const { hasResend } = await import("../env");
    expect(hasResend()).toBe(false);
  });

  it("hasResend returns true when env var is set", async () => {
    process.env.RESEND_API_KEY = "re_123";
    const { hasResend } = await import("../env");
    expect(hasResend()).toBe(true);
  });

  it("hasOpenAI returns false when env var is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { hasOpenAI } = await import("../env");
    expect(hasOpenAI()).toBe(false);
  });

  it("hasMapbox returns false when env var is missing", async () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const { hasMapbox } = await import("../env");
    expect(hasMapbox()).toBe(false);
  });

  describe("getEnv in production", () => {
    /* getEnv() returns getters, so validation happens on PROPERTY ACCESS,
     * not on the call. That is the fix for the production crash: reading
     * `appUrl` must not require Twilio. These tests therefore assert on the
     * access, not on getEnv() itself. */
    it("throws when a required env var is read and is missing", async () => {
      // `@types/node` ≥ 20 makes `process.env.NODE_ENV` read-only in TS —
      // assigning to it produces TS2540. vitest's `vi.stubEnv()` uses
      // Object.defineProperty under the hood, which the TS types accept
      // because it goes through a function. Semantically identical; it
      // also auto-resets between tests when afterEach triggers the
      // restore path (we reassign process.env anyway, so no extra cleanup).
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const { getEnv } = await import("../env");
      expect(() => getEnv().supabaseUrl).toThrow("Required environment variable missing");
    });

    it("does not throw for unset optional integrations (Twilio/Resend/OpenAI/Mapbox)", async () => {
      /* Regression pin: Twilio is unprovisioned in production. When these
       * were `requireEnv`, merely calling getEnv() threw there and took
       * every Stripe path down with it. */
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_APP_URL = "https://meethenri.com";
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_FROM_NUMBER;
      delete process.env.RESEND_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

      const { getEnv } = await import("../env");
      const env = getEnv();
      expect(env.twilioAccountSid).toBe("");
      expect(env.resendApiKey).toBe("");
      expect(env.openaiApiKey).toBe("");
      expect(env.mapboxPublicToken).toBe("");
      // Reading a required var next to them still works.
      expect(env.appUrl).toBe("https://meethenri.com");
    });

    it("throws when CRON_SECRET is an insecure default", async () => {
      vi.stubEnv("NODE_ENV", "production");
      // Set all required vars
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "key";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.STRIPE_SECRET_KEY = "sk_test";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
      process.env.STRIPE_FOUNDER_PRICE_ID = "price_1";
      process.env.STRIPE_STARTER_PRICE_ID = "price_2";
      process.env.STRIPE_PRO_PRICE_ID = "price_3";
      process.env.STRIPE_ENTERPRISE_PRICE_ID = "price_4";
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      process.env.TWILIO_AUTH_TOKEN = "token";
      process.env.TWILIO_FROM_NUMBER = "+1234567890";
      process.env.RESEND_API_KEY = "re_123";
      process.env.OPENAI_API_KEY = "sk-123";
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.123";
      process.env.NEXT_PUBLIC_APP_URL = "https://meethenri.com";
      process.env.CRON_SECRET = "dev_cron_secret_change_in_production";

      const { getEnv } = await import("../env");
      expect(() => getEnv().cronSecret).toThrow("insecure default");
    });
  });

  describe("getEnv in development", () => {
    it("uses fallback values without throwing", async () => {
      vi.stubEnv("NODE_ENV", "development");
      // Clear env vars
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.STRIPE_SECRET_KEY;

      const { getEnv } = await import("../env");
      // Should not throw in dev mode
      const env = getEnv();
      expect(env.supabaseUrl).toBe("");
    });
  });

  // Belt-and-suspenders: vi.unstubAllEnvs() at the describe root ensures
  // NODE_ENV overrides don't leak between test files when they happen to
  // run in the same worker.
  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
