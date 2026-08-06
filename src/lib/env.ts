/**
 * Central environment variable validation.
 * Call `getEnv()` in server code to get validated env values.
 * In dev mode, missing vars log a warning instead of crashing.
 *
 * Two properties this file has to keep (both were broken until 2026-08-06,
 * see getEnv below):
 *   1. Reading one variable must not validate the other seventeen.
 *   2. A variable the app treats as optional — every one with a `hasX()`
 *      feature check below — must not be required here.
 */

interface EnvConfig {
  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;

  // Stripe
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripeFounderPriceId: string;
  stripeStarterPriceId: string;
  stripeProPriceId: string;
  stripeEnterprisePriceId: string;

  // Communication
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  resendApiKey: string;

  // OpenAI
  openaiApiKey: string;

  // Mapbox
  mapboxPublicToken: string;

  // App
  appUrl: string;
  cronSecret: string;
}

const isDev = process.env.NODE_ENV !== "production";
const INSECURE_CRON_SECRETS = ["dev_cron_secret_change_in_production", "change_me", "secret", "test"];

import { logger } from "@/lib/logger";

function requireEnv(key: string, fallback = ""): string {
  const value = process.env[key];
  if (!value) {
    if (isDev) {
      logger.warn("Missing env var — running in dev mode with fallback", { key });
      return fallback;
    }
    throw new Error(`[Henri] Required environment variable missing: ${key}`);
  }

  // Reject known-insecure CRON_SECRET values in production
  if (key === "CRON_SECRET" && !isDev && INSECURE_CRON_SECRETS.includes(value)) {
    throw new Error(
      `[Henri] CRON_SECRET is set to an insecure default ("${value}"). ` +
      `Generate a secure value: openssl rand -hex 16`
    );
  }

  return value;
}

/** An optional integration's key. Absent means "feature off", never fatal —
 *  callers gate on the matching `hasX()` helper below. */
function optionalEnv(key: string): string {
  return process.env[key] ?? "";
}

/**
 * Validated environment access.
 *
 * Every property is a GETTER, so a caller that reads `appUrl` validates
 * `NEXT_PUBLIC_APP_URL` and nothing else. Until 2026-08-06 this returned a
 * plain object literal, which meant calling `getEnv()` at all ran
 * `requireEnv` over all 18 vars — and `requireEnv` THROWS in production.
 * Twilio is unprovisioned in production, so `getEnv()` threw there for every
 * caller regardless of what they wanted; `src/lib/stripe/client.ts` had
 * already been rewritten to read `process.env.STRIPE_SECRET_KEY` directly to
 * escape it (see the note in that file), which is why nothing in src/ calls
 * this today.
 *
 * Twilio / Resend / OpenAI / Mapbox are also no longer `requireEnv`: the app
 * ships `hasTwilio()` / `hasResend()` / `hasOpenAI()` / `hasMapbox()` and
 * degrades when they are unset, so declaring them required here contradicted
 * how the rest of the codebase treats them. The Supabase, Stripe, cron and
 * app-URL vars stay required and still throw in production when missing.
 */
export function getEnv(): EnvConfig {
  return {
    get supabaseUrl() { return requireEnv("NEXT_PUBLIC_SUPABASE_URL"); },
    get supabaseAnonKey() { return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
    get supabaseServiceRoleKey() { return requireEnv("SUPABASE_SERVICE_ROLE_KEY"); },

    get stripeSecretKey() { return requireEnv("STRIPE_SECRET_KEY"); },
    get stripeWebhookSecret() { return requireEnv("STRIPE_WEBHOOK_SECRET"); },
    get stripeFounderPriceId() { return requireEnv("STRIPE_FOUNDER_PRICE_ID"); },
    get stripeStarterPriceId() { return requireEnv("STRIPE_STARTER_PRICE_ID"); },
    get stripeProPriceId() { return requireEnv("STRIPE_PRO_PRICE_ID"); },
    get stripeEnterprisePriceId() { return requireEnv("STRIPE_ENTERPRISE_PRICE_ID"); },

    get twilioAccountSid() { return optionalEnv("TWILIO_ACCOUNT_SID"); },
    get twilioAuthToken() { return optionalEnv("TWILIO_AUTH_TOKEN"); },
    get twilioFromNumber() { return optionalEnv("TWILIO_FROM_NUMBER"); },
    get resendApiKey() { return optionalEnv("RESEND_API_KEY"); },

    get openaiApiKey() { return optionalEnv("OPENAI_API_KEY"); },
    get mapboxPublicToken() { return optionalEnv("NEXT_PUBLIC_MAPBOX_TOKEN"); },

    get appUrl() { return requireEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"); },
    get cronSecret() { return requireEnv("CRON_SECRET"); },
  };
}

/** Check if a specific feature's env vars are present */
export function hasStripe(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_STARTER_PRICE_ID);
}

export function hasSupabase(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function hasTwilio(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function hasResend(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function hasMapbox(): boolean {
  return !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
}
