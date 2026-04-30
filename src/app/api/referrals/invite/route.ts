import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { ReferralInviteBodySchema, parseBody } from "@/lib/schemas/api";

/* ─── POST /api/referrals/invite — send referral invite email ─── */
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(ReferralInviteBodySchema, raw);
  if (parsed.response) return parsed.response;
  const { email, type } = parsed.data;

  /* Get referral code */
  const { data: codeResult } = await supabase.rpc("get_or_create_referral_code", {
    p_contractor_id: user.id,
  });

  const referralCode = (codeResult as string) ?? `HENRI-${user.id.slice(0, 6).toUpperCase()}`;
  const referralLink = `https://meethenri.com/signup?ref=${referralCode}`;

  /* Get user profile for personalization */
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, company_name")
    .eq("id", user.id)
    .single();

  const senderName = profile?.company_name ?? profile?.full_name ?? "A Henri contractor";

  /* Upsert referral record (invited status) */
  await supabase
    .from("referrals")
    .upsert(
      {
        referrer_id: user.id,
        referred_email: email,
        type: type ?? "contractor",
        status: "invited",
      },
      { onConflict: "referrer_id,referred_email" }
    );

  /* Send invite email via Resend (or queue for sending) */
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Henri <noreply@meethenri.com>",
          to: [email],
          subject: `${senderName} invited you to Henri`,
          html: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">You've been invited to Henri</h2>
              <p style="color: #555; line-height: 1.6;">
                ${senderName} thinks you'd benefit from Henri — the lead generation platform
                for contractors. Sign up with the link below and you'll both earn rewards.
              </p>
              <a href="${referralLink}"
                 style="display: inline-block; background: #D4886A; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                Join Henri
              </a>
              <p style="color: #888; font-size: 13px; margin-top: 24px;">
                Your referral code: <strong>${referralCode}</strong>
              </p>
            </div>
          `,
        }),
      });
    }
  } catch (emailError) {
    /* Non-blocking: invite is recorded even if email fails */
    logger.error("Referral invite email error", { error: emailError instanceof Error ? emailError.message : String(emailError) });
  }

  return NextResponse.json({
    success: true,
    message: `Invite sent to ${email}`,
    referralCode,
    referralLink,
  });
}
