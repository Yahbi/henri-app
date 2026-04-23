/**
 * Central environment variable validation.
 * Call `getEnv()` in server code to get validated env values.
 * In dev mode, missing vars log a warning instead of crashing.
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

function requireEnv(key: string, fallback = ""): string {
  const value = process.env[key];
  if (!value) {
    if (isDev) {
      console.warn(`[Henri] Missing env var: ${key} — running in dev mode with fallback`);
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

export function getEnv(): EnvConfig {
  return {
    supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),

    stripeSecretKey: requireEnv("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
    stripeFounderPriceId: requireEnv("STRIPE_FOUNDER_PRICE_ID"),
    stripeStarterPriceId: requireEnv("STRIPE_STARTER_PRICE_ID"),
    stripeProPriceId: requireEnv("STRIPE_PRO_PRICE_ID"),
    stripeEnterprisePriceId: requireEnv("STRIPE_ENTERPRISE_PRICE_ID"),

    twilioAccountSid: requireEnv("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: requireEnv("TWILIO_AUTH_TOKEN"),
    twilioFromNumber: requireEnv("TWILIO_FROM_NUMBER"),
    resendApiKey: requireEnv("RESEND_API_KEY"),

    openaiApiKey: requireEnv("OPENAI_API_KEY"),
    mapboxPublicToken: requireEnv("NEXT_PUBLIC_MAPBOX_TOKEN"),

    appUrl: requireEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
    cronSecret: requireEnv("CRON_SECRET"),
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
