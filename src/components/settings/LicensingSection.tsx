"use client";

import { useCallback, useState } from "react";
import { ShieldCheck, ShieldAlert, RefreshCcw } from "lucide-react";
import { useUser } from "@/hooks/useUser";

/**
 * Licensing surface on /dashboard/settings. Displays the contractor's
 * license state pulled from the profile (populated by the onboarding
 * flow), and exposes a "Verify now" button that POSTs to
 * /api/licenses/verify.
 *
 * TRUTHFULNESS NOTE (2026-08-04). The header copy used to read
 * "Verified daily. Lead generation pauses automatically if expired."
 * Neither half is implemented:
 *   - src/lib/license/verify.ts makes no HTTP request to any licensing
 *     board; every code path returns status "pending".
 *   - No scoring or leads code path gates on license status, so nothing
 *     pauses.
 * What IS real is the signup cross-check in
 * /api/onboarding/verify-license against `state_license_rosters`, which
 * covers the states we hold public rosters for. The copy below states
 * only that. Restore the stronger claim only once a real board check
 * and a real pause gate exist.
 */
export function LicensingSection() {
  const { profile } = useUser();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    verified_at: string;
    license_active: boolean;
    licensed_until: string | null;
  } | null>(null);

  const licensedUntil = profile?.licensed_until ? new Date(profile.licensed_until) : null;
  // Three distinct states, not two. Previously a contractor with NO
  // expiry on file was reported as `expired`, which rendered the red
  // "Your license is on file as expired" banner — a false alarm that
  // said the opposite of the truth (nothing is on file at all).
  const unknownExpiry = !licensedUntil;
  const expired = licensedUntil ? licensedUntil.getTime() < Date.now() : false;
  const expiresInDays = licensedUntil
    ? Math.ceil((licensedUntil.getTime() - Date.now()) / 86_400_000)
    : null;
  const expiringSoon = !expired && expiresInDays !== null && expiresInDays <= 30;

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/licenses/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setLastResult(await res.json());
        return;
      }
      // Previously any non-2xx was swallowed: the button spun, stopped,
      // and nothing on screen changed. The contractor had no way to tell
      // a successful re-check from a failed one.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setVerifyError(body?.error ?? `Verification failed (HTTP ${res.status}).`);
    } catch {
      setVerifyError("Couldn't reach the verification service. Check your connection and retry.");
    } finally {
      setVerifying(false);
    }
  }, []);

  return (
    <section id="licensing" className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              expired
                ? "bg-red-500/10 text-red-400"
                : expiringSoon || unknownExpiry
                  ? "bg-yellow-500/10 text-yellow-400"
                  : "bg-primary-08 text-primary"
            }`}
          >
            {expired || unknownExpiry ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Contractor License</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cross-checked against your state&apos;s public license roster at
              signup. Re-check it any time.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${verifying ? "animate-spin" : ""}`} />
          {verifying ? "Verifying..." : "Verify now"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">State</p>
          <p className="text-foreground mt-1">{profile?.license_state ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">License #</p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {(profile as unknown as { license_number?: string | null })?.license_number ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Expires</p>
          <p className={`mt-1 ${expired ? "text-red-400" : expiringSoon ? "text-yellow-400" : "text-foreground"}`}>
            {licensedUntil
              ? `${licensedUntil.toLocaleDateString()} ${
                  expired ? "(expired)" : expiringSoon ? `(${expiresInDays}d)` : ""
                }`
              : "Not on file"}
          </p>
        </div>
      </div>

      {/* text-red-300 (#FCA5A5) on this bg-card container measured ~1.78:1
          at 12px — the one message that explains why leads stopped
          arriving was unreadable. Semantic destructive token instead. */}
      {expired && (
        <div className="border border-destructive/30 bg-destructive/10 rounded-lg p-3 text-xs text-destructive">
          Your license is on file as expired. Renew it with your state board
          and update the expiration date here — contractors are expected to
          hold a current license to work leads Henri sends.
        </div>
      )}

      {unknownExpiry && (
        <div className="border border-warning/30 bg-warning/10 rounded-lg p-3 text-xs text-warning">
          We don&apos;t have an expiration date on file for this license yet.
          Add it during license setup so we can flag it before it lapses.
        </div>
      )}

      <div role="status" aria-live="polite">
        {verifyError && (
          <p className="text-[11px] text-destructive">{verifyError}</p>
        )}
        {!verifyError && lastResult && (
          <p className="text-[11px] text-muted-foreground">
            Last verified {new Date(lastResult.verified_at).toLocaleString()}
            {lastResult.license_active ? " — active" : " — not active"}
          </p>
        )}
      </div>
    </section>
  );
}
