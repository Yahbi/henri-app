import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isGodModeEmail } from "@/lib/auth/god-mode";

/**
 * GET /api/dev/is-god-mode
 *
 * Returns `{ godMode: boolean }` for the currently-signed-in user.
 * Used by the client (useLeads) to decide whether to bypass plan-based
 * lead caps. Non-signed-in users get `{ godMode: false }`.
 *
 * Never returns 4xx — always 200 with a boolean — so callers can branch
 * without worrying about network or auth error handling.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return NextResponse.json(
      { godMode: isGodModeEmail(user?.email) },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch {
    return NextResponse.json({ godMode: false });
  }
}
