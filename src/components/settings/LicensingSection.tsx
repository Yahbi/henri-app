"use client";

import { useCallback, useState } from "react";
import { ShieldCheck, ShieldAlert, RefreshCcw } from "lucide-react";
import { useUser } from "@/hooks/useUser";

/**
 * Licensing surface on /dashboard/settings. Displays the contractor's
 * license state pulled from the profile (populated by the onboarding
 * flow + daily verify cron), and exposes a "Verify now" button that
 * POSTs to /api/licenses/verify.
 *
 * Matches the CLAUDE.md policy: "Licensing: required, verified daily,
 * leads paused if expired." Red-dot state corresponds to the pause
 * condition the scorer already honors.
 */
export function LicensingSection() {
  const { profile } = useUser();
  const [verifying, setVerifying] = useState(false);
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    verified_at: string;
    license_active: boolean;
    licensed_until: string | null;
  } | null>(null);

  const licensedUntil = profile?.licensed_until ? new Date(profile.licensed_until) : null;
  const expired = licensedUntil ? licensedUntil.getTime() < Date.now() : !profile?.licensed_until;
  const expiresInDays = licensedUntil
    ? Math.ceil((licensedUntil.getTime() - Date.now()) / 86_400_000)
    : null;
  const expiringSoon = !expired && expiresInDays !== null && expiresInDays <= 30;

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await fetch("/api/licenses/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setLastResult(await res.json());
      }
    } catch {
      /* silent — UI still shows stale state */
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
              expired ? "bg-red-500/10 text-red-400" : expiringSoon ? "bg-yellow-500/10 text-yellow-400" : "bg-primary-08 text-primary"
            }`}
          >
            {expired ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Contractor License</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verified daily. Lead generation pauses automatically if expired.
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

      {expired && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3 text-xs text-red-300">
          Your license is on file as expired. Lead generation is paused until
          you upload a current license (or update the expiration date with
          your state licensing board).
        </div>
      )}

      {lastResult && (
        <p className="text-[11px] text-muted-foreground">
          Last verified {new Date(lastResult.verified_at).toLocaleString()}
        </p>
      )}
    </section>
  );
}
