import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * POST /api/profile/tutorial
 *   Marks the contractor's tutorial as completed (or skipped — same row,
 *   `tutorial_completed_at = now()`). The dashboard tour reads this
 *   timestamp via useUser() and only auto-fires when it's NULL.
 *
 * DELETE /api/profile/tutorial
 *   Resets the timestamp to NULL — used by the "Replay tutorial" button
 *   in /dashboard/settings.
 *
 * Both gated by an authenticated session. Service-role not needed
 * since the user is updating their own row and RLS allows it via the
 * existing profiles_update_own policy.
 */

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
      .from("profiles")
      .update({ tutorial_completed_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      // Pre-migration safety: if the column doesn't exist yet, the tour
      // still works in-memory; we just don't persist. The graceful-degrade
      // matches the pattern in /api/exclusivity and /api/feedback.
      if (/Could not find the column|column .* does not exist/i.test(error.message)) {
        logApiError("profile.tutorial.column_missing", error);
        return NextResponse.json({ ok: true, persisted: false }, { status: 200 });
      }
      logApiError("profile.tutorial.update", error);
      return NextResponse.json({ error: "Failed to mark tutorial complete" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    logApiError("profile.tutorial.post", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
      .from("profiles")
      .update({ tutorial_completed_at: null })
      .eq("id", user.id);

    if (error) {
      if (/Could not find the column|column .* does not exist/i.test(error.message)) {
        return NextResponse.json({ ok: true, persisted: false }, { status: 200 });
      }
      logApiError("profile.tutorial.reset", error);
      return NextResponse.json({ error: "Failed to reset tutorial" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    logApiError("profile.tutorial.delete", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
