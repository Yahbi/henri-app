import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/* ─── POST /api/reviews/request — contractor sends a review request ─── */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Verify the user is a contractor */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, company_name, full_name")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "contractor") {
      return NextResponse.json(
        { error: "Only contractors can send review requests" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      lead_id,
      customer_name,
      customer_email,
      customer_phone,
      channel,
    } = body as {
      lead_id?: string;
      customer_name?: string;
      customer_email?: string;
      customer_phone?: string;
      channel?: "email" | "sms";
    };

    if (!customer_name) {
      return NextResponse.json(
        { error: "customer_name is required" },
        { status: 400 }
      );
    }

    if (!channel || (channel !== "email" && channel !== "sms")) {
      return NextResponse.json(
        { error: "channel must be 'email' or 'sms'" },
        { status: 400 }
      );
    }

    if (channel === "email" && !customer_email) {
      return NextResponse.json(
        { error: "customer_email is required for email channel" },
        { status: 400 }
      );
    }

    if (channel === "sms" && !customer_phone) {
      return NextResponse.json(
        { error: "customer_phone is required for sms channel" },
        { status: 400 }
      );
    }

    /* Generate a unique token */
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

    /* Create the review request record */
    const { data: reviewRequest, error: insertErr } = await supabase
      .from("review_requests")
      .insert({
        contractor_id: user.id,
        lead_id: lead_id ?? null,
        customer_name,
        customer_email: customer_email ?? null,
        customer_phone: customer_phone ?? null,
        channel,
        token,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      logger.error("Review request insert error", { error: insertErr instanceof Error ? insertErr.message : String(insertErr) });
      return NextResponse.json(
        { error: "Failed to create review request" },
        { status: 500 }
      );
    }

    const senderName =
      profile.company_name ?? profile.full_name ?? "Your contractor";
    const reviewLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com"}/review/${token}`;

    /* Send via the appropriate channel */
    if (channel === "email" && customer_email) {
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
              to: [customer_email],
              subject: `${senderName} is requesting your feedback`,
              html: `
                <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
                  <h2 style="color: #1a1a1a;">How was your experience?</h2>
                  <p style="color: #555; line-height: 1.6;">
                    ${senderName} would love to hear about your recent experience.
                    Your feedback helps other homeowners find quality contractors.
                  </p>
                  <a href="${reviewLink}"
                     style="display: inline-block; background: #D4886A; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                    Leave a Review
                  </a>
                  <p style="color: #888; font-size: 13px; margin-top: 24px;">
                    This link expires in 30 days.
                  </p>
                </div>
              `,
            }),
          });

          /* Mark as sent */
          await supabase
            .from("review_requests")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", reviewRequest.id);
        }
      } catch (emailErr) {
        logger.error("Review request email error", { error: emailErr instanceof Error ? emailErr.message : String(emailErr) });
        /* Non-blocking: request is saved even if email fails */
      }
    }

    if (channel === "sms" && customer_phone) {
      try {
        const twilioSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

        if (twilioSid && twilioToken && twilioFrom) {
          const smsBody = `${senderName} is requesting your feedback. Leave a review: ${reviewLink}`;

          await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization:
                  "Basic " +
                  Buffer.from(`${twilioSid}:${twilioToken}`).toString(
                    "base64"
                  ),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                To: customer_phone,
                From: twilioFrom,
                Body: smsBody,
              }).toString(),
            }
          );

          /* Mark as sent */
          await supabase
            .from("review_requests")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", reviewRequest.id);
        }
      } catch (smsErr) {
        logger.error("Review request SMS error", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
        /* Non-blocking: request is saved even if SMS fails */
      }
    }

    return NextResponse.json(
      {
        success: true,
        reviewRequest,
        reviewLink,
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Review request POST error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
