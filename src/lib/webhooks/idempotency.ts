/**
 * Webhook idempotency helper (audit priority #7, 2026-04-28).
 *
 * Mirror of the Stripe webhook's `event.id` dedup pattern but generic
 * across providers. Lets Twilio (`MessageSid`) and Resend (`svix-id`)
 * webhooks dedupe replays the same way Stripe already does.
 *
 * Backed by `webhook_idempotency` table (migration 00054). Composite
 * primary key (provider, event_id) gives O(1) lookups; the script just
 * tries to INSERT and treats a conflict as "already processed".
 *
 * Graceful-degrade: if migration 00054 isn't applied yet, the helper
 * logs a warn and returns `false` (treats every event as new). The
 * caller falls back to the prior pre-idempotency behavior — duplicate
 * events fire duplicate handlers, which was the bug we're fixing, but
 * the route doesn't crash.
 *
 * Usage:
 *   import { wasProcessed, markProcessed } from "@/lib/webhooks/idempotency";
 *
 *   const seen = await wasProcessed(supabase, "twilio", messageSid);
 *   if (seen) return NextResponse.json({ ok: true, skipped: "duplicate" });
 *
 *   // ... process the event ...
 *
 *   await markProcessed(supabase, "twilio", messageSid, {
 *     event_type: messageStatus,
 *     raw_meta: { from, to, errorCode },
 *   });
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export type WebhookProvider = "twilio" | "resend" | "stripe";

interface MarkProcessedOptions {
  /** The provider's payload `type` field (e.g. Twilio "delivered",
   *  Resend "email.bounce"). Optional but useful for forensics. */
  event_type?: string;
  /** Truncated raw payload for forensics. Keep small (~2KB) — the
   *  table column is jsonb but PostgREST doesn't enforce a size limit. */
  raw_meta?: Record<string, unknown>;
}

/**
 * Returns true if this provider event has already been processed.
 * Returns false on any error (graceful-degrade — caller proceeds as if
 * new). Logs at warn level when the table is missing so the operator
 * sees the migration gap.
 */
export async function wasProcessed(
  supabase: SupabaseClient,
  provider: WebhookProvider,
  event_id: string,
): Promise<boolean> {
  if (!event_id) return false;
  const { data, error } = await supabase
    .from("webhook_idempotency")
    .select("event_id")
    .eq("provider", provider)
    .eq("event_id", event_id)
    .maybeSingle();

  if (error) {
    const msg = error.message ?? "";
    const tableMissing =
      error.code === "42P01" ||
      /relation .* does not exist/i.test(msg) ||
      /could not find the table/i.test(msg) ||
      /schema cache/i.test(msg);
    if (tableMissing) {
      logger.warn("webhook_idempotency table missing — graceful-degrade", {
        provider,
        hint: "apply migration 00054_webhook_idempotency.sql",
      });
    } else {
      logger.error("webhook_idempotency probe failed", {
        provider,
        error: msg,
      });
    }
    return false;
  }
  return data != null;
}

/**
 * Mark a provider event as processed. Idempotent — a duplicate INSERT
 * fails on the composite primary key; we swallow that as "already
 * marked" since the desired post-condition holds. Any other error logs
 * but doesn't propagate (the actual webhook work has already
 * succeeded; we just couldn't record it).
 */
export async function markProcessed(
  supabase: SupabaseClient,
  provider: WebhookProvider,
  event_id: string,
  opts: MarkProcessedOptions = {},
): Promise<void> {
  if (!event_id) return;
  const { error } = await supabase.from("webhook_idempotency").insert({
    provider,
    event_id,
    event_type: opts.event_type ?? null,
    raw_meta: opts.raw_meta ?? null,
  });
  if (!error) return;

  const msg = error.message ?? "";
  // Duplicate-key — the row already exists. Idempotent post-condition
  // holds; not an error.
  if (error.code === "23505" || /duplicate key/i.test(msg)) return;

  // Table missing — same graceful-degrade as wasProcessed().
  const tableMissing =
    error.code === "42P01" ||
    /relation .* does not exist/i.test(msg) ||
    /could not find the table/i.test(msg) ||
    /schema cache/i.test(msg);
  if (tableMissing) {
    logger.warn("webhook_idempotency table missing on insert", {
      provider,
      hint: "apply migration 00054_webhook_idempotency.sql",
    });
    return;
  }
  logger.error("webhook_idempotency insert failed", {
    provider,
    event_id,
    error: msg,
  });
}
