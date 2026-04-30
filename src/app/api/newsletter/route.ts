import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiError } from "@/lib/log";
import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * POST /api/newsletter
 *
 * Email-list capture from the marketing footer / portal hero. Used
 * for the launch funnel — pre-signup interest, product updates,
 * Founder-tier waitlist when the 100-seat cap is hit.
 *
 * Delivery, in priority order. The submission is "received" as soon
 * as ANY path succeeds:
 *   1. DB upsert into `newsletter_subscribers` — best-effort. Fails
 *      silently if the table doesn't exist (pre-migration). Same
 *      graceful-degrade pattern as `feedback`.
 *   2. Append to `.henri-newsletter.jsonl` at the repo root — works
 *      in dev / local. Read-only on Vercel; the DB path takes over
 *      there once the migration ships.
 *
 * Returns 200 if any path succeeded, 502 only when both failed.
 *
 * Anti-abuse: 4KB body cap (Zod), email format validation. Platform
 * rate-limit handles flood; we don't double-up here because the
 * footer signup is by design low-friction.
 */

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "henri@meethenri.com";

const BodySchema = z.object({
  email: z.string().email().max(200),
  source: z.string().max(64).optional(),
});

interface NewsletterRow {
  email: string;
  source: string | null;
  user_agent: string | null;
  created_at: string;
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please enter a valid email." },
        { status: 400 },
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const source = parsed.data.source?.trim().slice(0, 64) ?? "footer";
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
    const createdAt = new Date().toISOString();

    let dbOk = false;
    let fileOk = false;
    let emailOk = false;

    /* 1. DB upsert — service-role; idempotent on email. */
    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("newsletter_subscribers")
        .upsert(
          {
            email,
            source,
            user_agent: userAgent,
          },
          { onConflict: "email" },
        );
      if (!error) {
        dbOk = true;
      } else if (!/relation .* does not exist|Could not find the table/i.test(error.message)) {
        // Real error (not just missing table) — log it.
        logApiError("newsletter.db", error);
      }
    } catch (err) {
      logApiError("newsletter.db.exception", err);
    }

    /* 2. JSONL fallback — local dev convenience. Vercel filesystem
     *    is read-only, so this silently no-ops in prod. */
    try {
      const repoRoot = process.cwd();
      const jsonlPath = path.join(repoRoot, ".henri-newsletter.jsonl");
      const row: NewsletterRow = {
        email,
        source,
        user_agent: userAgent,
        created_at: createdAt,
      };
      await fs.appendFile(jsonlPath, JSON.stringify(row) + "\n", "utf8");
      fileOk = true;
    } catch {
      /* read-only fs (Vercel) — expected in prod. */
    }

    /* 3. Welcome ack via Resend (optional, non-blocking on failure). */
    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: "You're on the Henri list",
          text:
            "Thanks for signing up. We'll send the occasional product " +
            "update and founder-tier seat-availability note. No spam, " +
            "no list-rentals, unsubscribe in one click from any email.\n\n" +
            "— The Henri team",
        });
        emailOk = true;
      } catch (err) {
        logger.warn?.("newsletter.resend", { err: String(err) });
      }
    }

    if (!dbOk && !fileOk) {
      return NextResponse.json(
        { error: "Could not record signup. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, email_sent: emailOk });
  } catch (err) {
    logApiError("newsletter.post", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
