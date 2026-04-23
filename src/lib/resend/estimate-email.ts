import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

// See note in src/lib/resend/email.ts — production deploys must set
// RESEND_FROM_EMAIL to a verified-domain mailbox.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "henri@henri.app";

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface EstimateEmailData {
  contactName: string;
  contactEmail: string;
  trade: string;
  zip: string;
  description?: string;
  amount: number;
  scopeNotes?: string;
  estimateId: string;
  contractorName?: string;
  contractorCompany?: string;
}

function buildEstimateEmailHtml(data: EstimateEmailData): string {
  const formattedAmount = `$${data.amount.toLocaleString()}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://henri.app";

  return `
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
        <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:400;">Henri.</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h2 style="color:#1e293b;margin:0 0 8px;font-size:22px;">Your Estimate is Ready</h2>
        <p style="color:#64748b;font-size:14px;margin:0 0 24px;">
          Hi ${escapeHtml(data.contactName)},
          ${data.contractorCompany ? `${escapeHtml(data.contractorCompany)} has` : "Your contractor has"} prepared an estimate for your project.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:0;margin:0 0 24px;">
          <tr>
            <td style="padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-size:14px;width:140px;">Project Type</td>
                  <td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500;">${escapeHtml(data.trade)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-size:14px;">Location</td>
                  <td style="padding:6px 0;color:#1e293b;font-size:14px;">${escapeHtml(data.zip)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-size:14px;">Estimated Cost</td>
                  <td style="padding:6px 0;color:#1e293b;font-size:20px;font-weight:600;">${formattedAmount}</td>
                </tr>
                ${data.description ? `
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-size:14px;vertical-align:top;">Description</td>
                  <td style="padding:6px 0;color:#1e293b;font-size:14px;">${escapeHtml(data.description.slice(0, 500))}</td>
                </tr>` : ""}
                ${data.scopeNotes ? `
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-size:14px;vertical-align:top;">Scope Notes</td>
                  <td style="padding:6px 0;color:#1e293b;font-size:14px;">${escapeHtml(data.scopeNotes.slice(0, 500))}</td>
                </tr>` : ""}
              </table>
            </td>
          </tr>
        </table>
        <a href="${appUrl}/leads/${escapeHtml(data.estimateId)}"
           style="display:inline-block;background:#D4886A;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">
          View Full Estimate
        </a>
        <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;">
          This estimate was sent via Henri. If you did not request this, you can safely ignore this email.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send an estimate email to a homeowner.
 * Returns the Resend email ID on success.
 */
export async function sendEstimateEmail(
  data: EstimateEmailData,
): Promise<{ success: boolean; emailId: string | null }> {
  try {
    const resend = getResend();
    const html = buildEstimateEmailHtml(data);
    const contractorLabel = data.contractorCompany ?? data.contractorName ?? "Your contractor";

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: data.contactEmail,
      subject: `Estimate from ${contractorLabel} - ${data.trade} ($${data.amount.toLocaleString()})`,
      html,
    });

    if (error) {
      console.error("[estimate-email] Resend error:", error);
      return { success: false, emailId: null };
    }

    return { success: true, emailId: result?.id ?? null };
  } catch (err) {
    console.error("[estimate-email] Error:", err);
    return { success: false, emailId: null };
  }
}
