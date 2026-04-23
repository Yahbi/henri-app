import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Enforces contractor-only access on an API route.
 *
 * Use alongside middleware, not instead of it — middleware blocks the obvious
 * path bypasses, this blocks the subtle one where a homeowner session survives
 * middleware (e.g. public route aliasing, stale cookies) and probes a
 * contractor-only endpoint.
 *
 * Returns either a NextResponse (401/403) to return immediately, or
 * { user, role: "contractor" } to continue.
 */
export async function requireContractor(supabase: SupabaseClient): Promise<
  | { response: NextResponse; user?: never }
  | { response?: never; user: User }
> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "contractor") {
    return {
      response: NextResponse.json(
        { error: "Contractors only" },
        { status: 403 }
      ),
    };
  }

  return { user };
}
