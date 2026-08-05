import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * POST /api/webhooks/supabase
 *
 * Receives Supabase Database Webhook events.
 * Primary use: auto-create a profiles row when a new auth.users row is inserted
 * (covers Google OAuth sign-ups and email/password sign-ups where the trigger
 * may not be available).
 *
 * Configure in Supabase Dashboard:
 *   Database → Webhooks → New Webhook
 *   Table: auth.users  |  Events: INSERT
 *   URL: https://<your-domain>/api/webhooks/supabase
 *   Headers: { "x-webhook-secret": "<SUPABASE_WEBHOOK_SECRET>" }
 */
export async function POST(request: NextRequest) {
  /* Verify webhook secret to prevent spoofing.
   * Reject when the env var is unset — an unconfigured secret means
   * any anonymous caller can create profiles. */
  const secret = request.headers.get("x-webhook-secret");
  if (!process.env.SUPABASE_WEBHOOK_SECRET || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = body.type as string | undefined;
  const record = body.record as Record<string, unknown> | undefined;

  /* Only handle INSERT events on auth.users */
  if (type !== "INSERT" || !record) {
    return NextResponse.json({ received: true, skipped: true });
  }

  const userId = record.id as string | undefined;
  const email = record.email as string | undefined;
  const rawMeta = record.raw_user_meta_data as Record<string, unknown> | undefined;
  const fullName =
    (rawMeta?.full_name as string | undefined) ??
    (rawMeta?.name as string | undefined) ??
    null;

  /* Determine role from sign-up metadata, with a strict whitelist.
   *
   * Security note: the signup page reads `?role=` from the URL, so a user can
   * URL-manipulate into contractor signup. We default to `homeowner` (the
   * safer, non-paid role) when metadata is missing or unrecognized — including
   * for Google OAuth signups where raw_user_meta_data may omit `role`.
   * Contractor access still requires completing the paid onboarding flow
   * (license → plan → payment → territory), so an unauthorized role=contractor
   * tag at signup cannot actually access contractor features on its own. */
  const rawRole = rawMeta?.role as string | undefined;
  const role: "homeowner" | "contractor" =
    rawRole === "contractor" || rawRole === "homeowner" ? rawRole : "homeowner";

  if (!userId || !email) {
    return NextResponse.json({ error: "Missing user id or email" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    /* Upsert so re-deliveries are idempotent */
    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        role,
        plan: "free",
        onboarding_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id", ignoreDuplicates: false }
    );

    if (error) {
      logger.error("Supabase webhook: profile upsert failed", { error: String(error) });
      return NextResponse.json({ error: "Profile upsert failed" }, { status: 500 });
    }

    return NextResponse.json({ received: true, userId, role });
  } catch (err) {
    logger.error("Supabase webhook error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
