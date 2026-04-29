/**
 * Numverify — phone number validation + carrier / line-type enrichment.
 *
 * Free tier: 100 requests / month. Cache on phone hash.
 *
 * ## What it gives us
 *
 * For a homeowner phone number on a lead:
 *   - Valid format check (catches typos before Twilio rejects)
 *   - Country / region / carrier
 *   - Line type: mobile / landline / voip
 *
 * Routes to better outreach: SMS to mobile, voice to landline, both
 * to VoIP. Today the cron blasts SMS regardless of line type, which
 * wastes Twilio cost on landlines (delivered as voicemail-only).
 *
 * ## Setup
 *
 *   1. Sign up at https://numverify.com
 *   2. Set NUMVERIFY_API_KEY in Vercel / .env.local
 *   3. Free tier 100/mo — call once per phone, persist result
 *
 * ## Pattern
 *
 * - Cache by E.164-normalized phone for 30 days
 * - Returns null on missing key, malformed phone, or quota error
 * - Used by the orchestrator's Phase D, written to leads.phone_metadata jsonb
 *   (column added by 00051; until then, render-only)
 */

import { logger } from "@/lib/logger";

interface NumverifyResponse {
  valid?: boolean;
  number?: string;
  local_format?: string;
  international_format?: string;
  country_prefix?: string;
  country_code?: string;
  country_name?: string;
  location?: string;
  carrier?: string;
  line_type?: string; // "mobile" / "landline" / "voip" / "special_services"
  error?: { code: number; type: string; info: string };
}

export interface PhoneMetadata {
  phone_e164: string;
  valid: boolean;
  line_type: "mobile" | "landline" | "voip" | "unknown" | "invalid";
  carrier: string | null;
  region: string | null;
  /** Outreach hint derived from line type. */
  outreach_strategy: "sms-preferred" | "voice-preferred" | "either" | "skip";
  source: "numverify";
  fetched_at: string;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const cache = new Map<string, { value: PhoneMetadata | null; expires_at: number }>();

/** Normalize a US phone string to E.164 (`+1XXXXXXXXXX`). Returns null on
 *  malformed input. Defensive against the wide variety of formats the
 *  permit feeds ship phones in. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function classifyLineType(raw: string | undefined): PhoneMetadata["line_type"] {
  const t = (raw ?? "").toLowerCase();
  if (t === "mobile") return "mobile";
  if (t === "landline" || t === "fixed_line") return "landline";
  if (t === "voip") return "voip";
  return "unknown";
}

function deriveOutreachStrategy(
  valid: boolean,
  lineType: PhoneMetadata["line_type"],
): PhoneMetadata["outreach_strategy"] {
  if (!valid) return "skip";
  if (lineType === "mobile") return "sms-preferred";
  if (lineType === "landline") return "voice-preferred";
  if (lineType === "voip") return "either";
  return "either";
}

/**
 * Validate + enrich a phone number. Returns null on missing key / quota
 * / malformed input.
 */
export async function lookupPhoneMetadata(
  phoneRaw: string,
): Promise<PhoneMetadata | null> {
  const apiKey = process.env.NUMVERIFY_API_KEY;
  if (!apiKey) return null;

  const e164 = toE164(phoneRaw);
  if (!e164) return null;

  const cached = cache.get(e164);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  try {
    // Numverify free tier requires HTTP not HTTPS. ZIPs / phone numbers
    // are non-PII enough for query-string transit; still, this runs
    // server-side only.
    const phoneForApi = e164.replace(/^\+/, "");
    const url = `http://apilayer.net/api/validate?access_key=${encodeURIComponent(apiKey)}&number=${encodeURIComponent(phoneForApi)}&country_code=US&format=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri-Bot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn("numverify non-200", { phone_hash: e164.slice(-4), status: res.status });
      cache.set(e164, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const data = (await res.json()) as NumverifyResponse;
    if (data.error) {
      logger.warn("numverify api error", { code: data.error.code, info: data.error.info });
      cache.set(e164, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const valid = data.valid ?? false;
    const lineType = valid ? classifyLineType(data.line_type) : "invalid";
    const meta: PhoneMetadata = {
      phone_e164: e164,
      valid,
      line_type: lineType,
      carrier: data.carrier ?? null,
      region: data.location ?? null,
      outreach_strategy: deriveOutreachStrategy(valid, lineType),
      source: "numverify",
      fetched_at: new Date().toISOString(),
    };
    cache.set(e164, { value: meta, expires_at: Date.now() + CACHE_TTL_MS });
    return meta;
  } catch (err) {
    logger.warn("numverify fetch failed", { error: String(err) });
    cache.set(e164, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
    return null;
  }
}
