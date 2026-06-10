import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { logApiError } from "@/lib/log";
import { ReferralValidateBodySchema, parseBody } from "@/lib/schemas/api";

/* ─── GET /api/referrals/validate?code=HENRI-XXXXXX ─── */
/* Public endpoint: validates a referral code at signup time.
 * Rate-limited because it's unauthenticated and enumerable. */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`referrals.validate:${ip}`, {
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ valid: false, error: "No code provided" }, { status: 400 });
  }

  const supabase = createAdminClient();

  /* Look up the referral code */
  const { data: refCode, error } = await supabase
    .from("referral_codes")
    .select("code, contractor_id, profiles!inner(full_name, company_name)")
    .eq("code", code.toUpperCase())
    .single();

  if (error || !refCode) {
    return NextResponse.json({ valid: false });
  }

  const profile = Array.isArray(refCode.profiles)
    ? (refCode.profiles as Record<string, string>[])[0]
    : (refCode.profiles as Record<string, string>);

  return NextResponse.json({
    valid: true,
    referrer: profile?.company_name ?? profile?.full_name ?? "Henri contractor",
  });
}

/* ─── POST /api/referrals/validate — process signup with referral code ─── */
/* Called during user registration when ref= query param is present */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`referrals.validate.post:${ip}`, {
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(ReferralValidateBodySchema, raw);
  if (parsed.response) return parsed.response;
  const { code, userId, email, role } = parsed.data;

  /* Require an authenticated session and only allow the caller to process
   * their OWN signup — otherwise the admin-client RPC below could be used
   * to forge referral credit onto arbitrary user IDs. */
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();

  /* Call the DB function to process the referral signup */
  const { data: result, error } = await supabase.rpc("process_referral_signup", {
    p_referral_code: code.toUpperCase(),
    p_new_user_id: userId,
    p_new_user_email: email,
    p_new_user_role: role ?? "contractor",
  });

  if (error) {
    logApiError("referrals.signup", error);
    return NextResponse.json({ error: "Failed to process referral" }, { status: 500 });
  }

  return NextResponse.json(result);
}
