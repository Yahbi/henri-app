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
    it("throws when required env var is missing", async () => {
      process.env.NODE_ENV = "production";
      // Clear all env vars that getEnv() needs
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const { getEnv } = await import("../env");
      expect(() => getEnv()).toThrow("Required environment variable missing");
    });

    it("throws when CRON_SECRET is an insecure default", async () => {
      process.env.NODE_ENV = "production";
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
      process.env.NEXT_PUBLIC_APP_URL = "https://henri.app";
      process.env.CRON_SECRET = "dev_cron_secret_change_in_production";

      const { getEnv } = await import("../env");
      expect(() => getEnv()).toThrow("insecure default");
    });
  });

  describe("getEnv in development", () => {
    it("uses fallback values without throwing", async () => {
      process.env.NODE_ENV = "development";
      // Clear env vars
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.STRIPE_SECRET_KEY;

      const { getEnv } = await import("../env");
      // Should not throw in dev mode
      const env = getEnv();
      expect(env.supabaseUrl).toBe("");
    });
  });
});
