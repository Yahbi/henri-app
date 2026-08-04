import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiError } from "@/lib/log";
import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { z } from "zod";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * POST /api/feedback
 *
 * In-app feedback submission from contractors and homeowners.
 * Supports three submit modes:
 *   - authenticated contractor (role derived from profile)
 *   - authenticated homeowner  (role derived from profile)
 *   - anonymous (pre-signup homeowner from the public portal) —
 *     must include `email` so we can reply
 *
 * Delivery: three independent paths, tried in order. The submission
 * is considered "received" as soon as ANY path succeeds:
 *   1. DB insert into `feedback` — best-effort. Fails silently if the
 *      table doesn't exist yet (pre-migration 00030).
 *   2. Email to the founder inbox via Resend — only runs when
 *      RESEND_API_KEY is set. Fails silently when the key is missing
 *      (common in dev).
 *   3. Append to `.henri-feedback.jsonl` at the repo root — always
 *      works in dev / local envs with a writable filesystem. On
 *      Vercel's read-only filesystem this will be skipped, but by
 *      then the DB path is already live.
 *
 * Returns 200 if any path succeeded, 502 only when all three failed.
 *
 * Rate limiting: 4KB body cap (Zod) + an IP limiter (10/hour) applied
 * before the DB insert and founder-inbox email, so the unauthenticated
 * anonymous path can't be used to email-bomb the inbox or burn Resend quota.
 */

const FEEDBACK_INBOX = process.env.FEEDBACK_INBOX ?? "y.abismuth@gmail.com";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "henri@meethenri.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSubject(role: string, category: string, rating?: number | null): string {
  // No star glyphs per brand rules (CLAUDE.md: "No emojis anywhere in code,
  // copy, logs, or UI"). Render as a plain "N/5" fraction instead — clearer
  // than a glyph run and copy-pastes cleanly into plain-text readers.
  const ratingText = rating ? ` (${rating}/5)` : "";
  const cat = category.replace(/_/g, " ");
  const roleShort = role === "anonymous" ? "anon" : role;
  return `[Henri feedback] ${roleShort} · ${cat}${ratingText}`;
}

interface FeedbackSubmission {
  user_id: string | null;
  role: string;
  email: string | null;
  category: string;
  rating: number | null;
  message: string;
  page_path: string | null;
  user_agent: string | null;
}

function buildFeedbackHtml(s: FeedbackSubmission): string {
  // Render rating as a filled/empty bar string rather than star glyphs.
  // Same reason as buildSubject — brand rule is no emoji/glyph art. Five
  // block chars keep the visual weight close to the old star run without
  // violating the rule. (U+25A0 filled / U+25A1 empty are geometric shapes,
  // not emoji — same category as "—" we already use for the null case.)
  const rating = s.rating ?? 0;
  const ratingBar = s.rating
    ? "■".repeat(rating) + "□".repeat(5 - rating)
    : "—";
  const ratingLabel = s.rating ? `${s.rating}/5 ${ratingBar}` : "—";
  const categoryLabel = s.category.replace(/_/g, " ");
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;margin-top:20px;">
    <tr>
      <td style="background:#D4886A;padding:20px 28px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:500;letter-spacing:-0.02em;">Henri. · New feedback</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          <tr>
            <td style="padding:6px 0;color:#64748b;width:130px;">Role</td>
            <td style="padding:6px 0;color:#1e293b;text-transform:capitalize;">${escapeHtml(s.role)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b;">Category</td>
            <td style="padding:6px 0;color:#1e293b;font-weight:600;text-transform:capitalize;">${escapeHtml(categoryLabel)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b;">Rating</td>
            <td style="padding:6px 0;color:#D4886A;font-size:14px;font-family:monospace;letter-spacing:2px;">${escapeHtml(ratingLabel)}</td>
          </tr>
          ${s.email ? `
          <tr>
            <td style="padding:6px 0;color:#64748b;">Reply to</td>
            <td style="padding:6px 0;"><a href="mailto:${escapeHtml(s.email)}" style="color:#D4886A;">${escapeHtml(s.email)}</a></td>
          </tr>` : ""}
          ${s.page_path ? `
          <tr>
            <td style="padding:6px 0;color:#64748b;">Page</td>
            <td style="padding:6px 0;color:#1e293b;font-family:monospace;font-size:12px;">${escapeHtml(s.page_path)}</td>
          </tr>` : ""}
          ${s.user_id ? `
          <tr>
            <td style="padding:6px 0;color:#64748b;">User ID</td>
            <td style="padding:6px 0;color:#94a3b8;font-family:monospace;font-size:11px;">${escapeHtml(s.user_id)}</td>
          </tr>` : ""}
        </table>
        <div style="margin-top:20px;padding:16px;background:#f8fafc;border-left:3px solid #D4886A;border-radius:4px;">
          <p style="margin:0;color:#1e293b;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(s.message)}</p>
        </div>
        ${s.user_agent ? `
        <p style="margin:16px 0 0;color:#94a3b8;font-size:11px;font-family:monospace;">${escapeHtml(s.user_agent)}</p>` : ""}
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

const BodySchema = z.object({
  category: z
    .enum(["bug", "feature_request", "praise", "complaint", "question", "other"])
    .default("other"),
  rating: z.number().int().min(1).max(5).nullish(),
  message: z.string().min(1).max(4000),
  page_path: z.string().max(500).optional(),
  // Anonymous path only — authenticated submissions ignore this and
  // use the session email.
  email: z.string().email().max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // IP throttle before the DB insert + founder-inbox email (the anonymous
    // path is unauthenticated). Generous cap so legit in-app feedback isn't
    // blocked, but a flood can't email-bomb the inbox or burn Resend quota.
    const ip = getClientIp(request);
    const rl = checkRateLimit(`feedback:${ip}`, {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

    const raw = await request.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Identify the submitter. We don't require auth — anonymous paths
    // (portal pre-signup) must carry an email in the body.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let role: "contractor" | "homeowner" | "anonymous" = "anonymous";
    let userId: string | null = null;
    let email: string | null = body.email ?? null;

    if (user) {
      userId = user.id;
      email = user.email ?? email;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (profile?.role === "contractor") role = "contractor";
      else if (profile?.role === "homeowner") role = "homeowner";
    }

    if (role === "anonymous" && !email) {
      return NextResponse.json(
        {
          error:
            "Anonymous feedback requires an email so we can follow up. Sign in or include an email.",
        },
        { status: 400 },
      );
    }

    const ua = request.headers.get("user-agent")?.slice(0, 500) ?? null;
    const submission = {
      user_id: userId,
      role,
      email,
      category: body.category,
      rating: body.rating ?? null,
      message: body.message.trim(),
      page_path: body.page_path ?? null,
      user_agent: ua,
      app_version: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      status: "new" as const,
    };

    // 1) DB insert — best-effort. Swallow errors (table missing
    //    before migration 00030 is applied).
    let dbOk = false;
    try {
      const admin = createAdminClient();
      const { error: dbErr } = await admin.from("feedback").insert(submission);
      if (!dbErr) {
        dbOk = true;
      } else if (/Could not find the table/i.test(dbErr.message)) {
        logger.warn("feedback table missing — apply migration 00030");
      } else {
        logger.warn("feedback DB insert failed", { error: dbErr.message });
      }
    } catch (e) {
      logger.warn("feedback DB insert threw", { error: e instanceof Error ? e.message : String(e) });
    }

    // 2) Email delivery — fires only when RESEND_API_KEY is set.
    let emailed = false;
    try {
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error: emailErr } = await resend.emails.send({
          from: FROM_EMAIL,
          to: FEEDBACK_INBOX,
          replyTo: email ?? undefined,
          subject: buildSubject(role, body.category, body.rating),
          html: buildFeedbackHtml(submission),
        });
        if (!emailErr) emailed = true;
        else logger.warn("feedback email send failed", { error: emailErr instanceof Error ? emailErr.message : String(emailErr) });
      }
    } catch (e) {
      logger.warn("feedback email threw", { error: e instanceof Error ? e.message : String(e) });
    }

    // 3) Local JSONL fallback — guaranteed writable in dev, skipped
    //    on Vercel's read-only filesystem (where the DB path is
    //    expected to be the source of truth anyway).
    let fileOk = false;
    try {
      const filePath = path.join(process.cwd(), ".henri-feedback.jsonl");
      const line = JSON.stringify({
        received_at: new Date().toISOString(),
        ...submission,
      }) + "\n";
      await fs.appendFile(filePath, line, { encoding: "utf8" });
      fileOk = true;
    } catch (e) {
      // Vercel FS read-only, or permission issue — not fatal when
      // one of the other paths succeeded.
      if (!dbOk && !emailed) {
        logger.warn("feedback file-append failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (!dbOk && !emailed && !fileOk) {
      return NextResponse.json(
        { error: "Could not deliver feedback. Please try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      via: { db: dbOk, email: emailed, file: fileOk },
    });
  } catch (err) {
    logApiError("feedback.post", err);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 },
    );
  }
}
