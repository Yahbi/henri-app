import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_NOTIFICATION_PREFS,
} from "@/types/profile";
import type { NotificationPrefs } from "@/types/profile";
import {
  NotificationPrefsPatchBodySchema,
  parseBody,
} from "@/lib/schemas/api";
import { logger } from "@/lib/logger";

/* ─── GET /api/profile/notifications — return notification preferences ─── */
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", user.id)
      .single();

    if (error) {
      logger.error("Notification prefs fetch error", { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: "Failed to fetch notification preferences" },
        { status: 500 }
      );
    }

    /* Merge stored prefs over defaults so any new keys get defaults */
    const stored = (data?.notification_prefs ?? {}) as Partial<NotificationPrefs>;
    const prefs: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...stored };

    return NextResponse.json(
      { prefs },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("Notification prefs GET error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── PATCH /api/profile/notifications — update notification preferences ─── */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = await request.json();
    const parsed = parseBody(NotificationPrefsPatchBodySchema, raw);
    if (parsed.response) return parsed.response;

    /* Strict schema → drop undefined keys so we only persist fields the
     * caller actually asked to change. The schema's `.strict()` already
     * rejects unknown keys at the validation layer. */
    const incomingUpdate: Partial<NotificationPrefs> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === "boolean") {
        (incomingUpdate as Record<string, boolean>)[key] = value;
      }
    }

    if (Object.keys(incomingUpdate).length === 0) {
      return NextResponse.json(
        { error: "No valid preference fields to update" },
        { status: 400 }
      );
    }

    /* Fetch current prefs to merge */
    const { data: current } = await supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", user.id)
      .single();

    const existingPrefs = (current?.notification_prefs ?? {}) as Partial<NotificationPrefs>;
    const merged: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      ...existingPrefs,
      ...incomingUpdate,
    };

    /* Persist */
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ notification_prefs: merged })
      .eq("id", user.id);

    if (updateError) {
      logger.error("Notification prefs update error", { error: updateError instanceof Error ? updateError.message : String(updateError) });
      return NextResponse.json(
        { error: "Failed to update notification preferences" },
        { status: 500 }
      );
    }

    return NextResponse.json({ prefs: merged });
  } catch (err) {
    logger.error("Notification prefs PATCH error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
