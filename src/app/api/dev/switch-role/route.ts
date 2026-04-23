import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { isGodModeEmail } from "@/lib/auth/god-mode";

/**
 * DEV-ONLY: Flip the signed-in user's role between `contractor` and
 * `homeowner` for one-click navigation between the two dashboards without
 * logging out. Returns 404 in production so the route effectively vanishes.
 *
 * Access is additionally restricted to the allowlist in
 * `src/lib/auth/god-mode.ts`. Non-allowlisted users see 403 even in dev.
 *
 * POST body: { role: "contractor" | "homeowner" }
 */

/* GET returns whether the signed-in user may use god mode. The widget uses
 * this to hide itself for non-allowlisted users. */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json({ allowed: isGodModeEmail(user?.email) });
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { role } = (await request.json()) as { role?: string };
    if (role !== "contractor" && role !== "homeowner") {
      return NextResponse.json(
        { error: "role must be 'contractor' or 'homeowner'" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isGodModeEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // When flipping to contractor, also mark onboarding complete so middleware
    // doesn't bounce the user to /onboarding/license.
    const update: Record<string, unknown> = { role };
    if (role === "contractor") {
      update.onboarding_completed = true;
    }

    const { error } = await supabase
      .from("profiles")
      .update(update)
      .eq("id", user.id);

    if (error) {
      logApiError("dev.switchRole", error);
      return NextResponse.json(
        { error: "Failed to switch role" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      role,
      redirect: role === "contractor" ? "/dashboard" : "/homeowner",
    });
  } catch (err) {
    logApiError("dev.switchRole", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
