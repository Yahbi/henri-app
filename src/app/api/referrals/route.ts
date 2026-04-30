import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { ReferralCreateBodySchema, parseBody } from "@/lib/schemas/api";

/* ─── GET /api/referrals — list my referrals + stats ─── */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Ensure the contractor has a referral code */
  const { data: codeResult } = await supabase.rpc("get_or_create_referral_code", {
    p_contractor_id: user.id,
  });

  const referralCode = (codeResult as string) ?? `HENRI-${user.id.slice(0, 6).toUpperCase()}`;

  /* Fetch all referrals for this user */
  const { data: referrals, error } = await supabase
    .from("referrals")
    .select("id, referrer_id, referred_email, referred_name, type, status, reward_issued, reward_amount, created_at")
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Referrals fetch error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch referrals" }, { status: 500 });
  }

  const rows = referrals ?? [];

  /* Compute stats */
  const stats = {
    totalReferred: rows.length,
    converted: rows.filter((r) => r.status === "converted").length,
    signedUp: rows.filter((r) => r.status === "signed_up").length,
    invited: rows.filter((r) => r.status === "invited").length,
    totalEarned: rows
      .filter((r) => r.reward_issued)
      .reduce((sum, r) => sum + (Number(r.reward_amount) || 0), 0),
    pendingRewards: rows.filter(
      (r) => r.status === "signed_up" && !r.reward_issued
    ).length,
  };

  return NextResponse.json({
    referralCode,
    referralLink: `https://meethenri.com/signup?ref=${referralCode}`,
    referrals: rows,
    stats,
  });
}

/* ─── POST /api/referrals — record an invite (email only) ─── */
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(ReferralCreateBodySchema, raw);
  if (parsed.response) return parsed.response;
  const { email, name, type } = parsed.data;

  /* Check for existing referral to this email */
  const { data: existing } = await supabase
    .from("referrals")
    .select("id")
    .eq("referrer_id", user.id)
    .eq("referred_email", email)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "You have already invited this person" },
      { status: 409 }
    );
  }

  /* Insert referral record */
  const { data: referral, error } = await supabase
    .from("referrals")
    .insert({
      referrer_id: user.id,
      referred_email: email,
      referred_name: name ?? null,
      type: type ?? "contractor",
      status: "invited",
    })
    .select()
    .single();

  if (error) {
    logger.error("Referral insert error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create referral" }, { status: 500 });
  }

  return NextResponse.json({ success: true, referral });
}
