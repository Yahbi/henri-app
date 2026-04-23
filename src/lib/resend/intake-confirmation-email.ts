import { Resend } from "resend";

/**
 * Homeowner intake confirmation email (Phase 1.7).
 *
 * Fired after a successful POST to /api/intake. Gracefully no-ops when
 * `RESEND_API_KEY` isn't set so local dev keeps working without a
 * verified domain + API key.
 */

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "henri@henri.app";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface IntakeConfirmationInput {
  to: string;
  intakeId: string;
  trade: string;
  zip: string;
  contractorName: string | null;
  expectedContactLabel: string;
  appUrl: string;
}

export async function sendIntakeConfirmation(
  input: IntakeConfirmationInput,
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // Graceful no-op in local dev / preview envs that don't have RESEND wired.
  if (!process.env.RESEND_API_KEY) {
    return { success: false, skipped: true };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const projectUrl = `${input.appUrl.replace(/\/$/, "")}/homeowner/intakes/${input.intakeId}`;
    const contractorLine = input.contractorName
      ? `<p style="margin:8px 0 0;color:#475569;font-size:14px;">You've been matched with <strong>${escapeHtml(input.contractorName)}</strong>. They'll reach out by <strong>${escapeHtml(input.expectedContactLabel)}</strong>.</p>`
      : `<p style="margin:8px 0 0;color:#475569;font-size:14px;">We're finding a verified local contractor for your project — expect a call within 24 hours.</p>`;

    const subject = `Your Henri intake #${input.intakeId.slice(0, 8)} — ${input.trade}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;margin-top:20px;">
    <tr>
      <td style="background:#D4886A;padding:24px 32px;">
        <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:500;letter-spacing:-0.02em;">Henri.</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h2 style="color:#1e293b;margin:0 0 4px;font-size:20px;">Your project is in</h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:14px;">
          Intake #${input.intakeId.slice(0, 8)} · ${escapeHtml(input.trade)} · ZIP ${escapeHtml(input.zip)}
        </p>
        ${contractorLine}
        <div style="margin:24px 0;">
          <a href="${projectUrl}" style="display:inline-block;background:#D4886A;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">View your project →</a>
        </div>
        <p style="color:#64748b;font-size:12px;margin:24px 0 0;">
          Questions? Reply to this email or sign in at henri.app to chat directly with your contractor.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: input.to,
      subject,
      html,
    });

    if (error) {
      return { success: false, error: String(error) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
