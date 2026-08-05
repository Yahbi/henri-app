"use client";

import { useState } from "react";
import { Copy, Check, Send, Gift, Users, DollarSign, Loader2 } from "lucide-react";
import { useReferrals } from "@/hooks/useReferrals";
import type { Referral } from "@/hooks/useReferrals";
import { Card } from "@/components/ui/card";

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    converted: { label: "Converted", cls: "bg-green-500/10 text-green-400" },
    signed_up: { label: "Signed Up", cls: "bg-blue-500/10 text-blue-400" },
    invited: { label: "Invited", cls: "bg-zinc-500/10 text-muted-foreground" },
  };
  const cfg = map[status] ?? { label: status, cls: "bg-zinc-500/10 text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rewardDisplay(referral: Referral) {
  if (referral.reward_issued && referral.reward_amount) {
    return `$${referral.reward_amount} credit`;
  }
  if (referral.reward_label && referral.status !== "invited") {
    return referral.reward_label;
  }
  if (referral.status === "invited") return "\u2014";
  return "Pending";
}

export default function ReferralsPage() {
  const {
    referralCode,
    referralLink,
    referrals,
    stats,
    isLoading,
    sendInviteEmail,
  } = useReferrals();

  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ success: boolean; message?: string } | null>(null);

  const handleCopy = () => {
    // referralLink can be null while /api/referrals is loading; guard
    // so we don't write "null" to the clipboard.
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteResult(null);

    const result = await sendInviteEmail(inviteEmail.trim());

    setInviteSending(false);
    setInviteEmail("");

    if (result.success) {
      setInviteResult({ success: true, message: "Invite sent" });
    } else {
      setInviteResult({ success: false, message: result.error ?? "Failed to send" });
    }

    setTimeout(() => setInviteResult(null), 4000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Referral Program</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Refer contractors and homeowners — earn credits when they join Henri
        </p>
      </div>

      {/* Reward tiers */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-heading font-normal text-foreground">How It Works</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Refer a Contractor</p>
            <p className="text-2xl font-heading font-normal text-primary">1 month free</p>
            <p className="text-xs text-muted-foreground">
              When they subscribe to any plan, you both get one month credited to your account.
            </p>
          </Card>
          <Card className="p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Refer a Homeowner</p>
            <p className="text-2xl font-heading font-normal text-primary">$50 credit</p>
            <p className="text-xs text-muted-foreground">
              When a homeowner you refer completes their first project through Henri.
            </p>
          </Card>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Referred</p>
          </div>
          <p className="text-2xl font-heading font-normal text-foreground">
            {isLoading ? "\u2014" : stats.totalReferred}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Check className="h-3.5 w-3.5 text-green-400" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Converted</p>
          </div>
          <p className="text-2xl font-heading font-normal text-green-400">
            {isLoading ? "\u2014" : stats.converted}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Earned</p>
          </div>
          <p className="text-2xl font-heading font-normal text-primary">
            {isLoading ? "\u2014" : `$${stats.totalEarned}`}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Gift className="h-3.5 w-3.5 text-warm" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p>
          </div>
          <p className="text-2xl font-heading font-normal text-warm">
            {isLoading ? "\u2014" : stats.pendingRewards}
          </p>
        </Card>
      </div>

      {/* Referral Link + Invite */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Share link */}
        <Card className="p-6 space-y-4">
          <h3 className="text-base font-heading font-normal text-foreground">Your Referral Link</h3>
          <div className="flex gap-2">
            <input
              readOnly
              value={referralLink ?? ""}
              placeholder={referralLink ? undefined : "Loading your referral link..."}
              className="flex-1 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm text-foreground font-mono truncate"
            />
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this link with contractors or homeowners. Your code:{" "}
            <span className="font-mono text-foreground">{referralCode}</span>
          </p>
        </Card>

        {/* Email invite */}
        <Card className="p-6 space-y-4">
          <h3 className="text-base font-heading font-normal text-foreground">Send an Invite</h3>
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              placeholder="colleague@email.com"
              aria-label="Invite email address"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={inviteSending}
            />
            <button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteSending}
              className="flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              {inviteSending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {inviteSending ? "Sending" : "Invite"}
            </button>
          </div>
          {inviteResult && (
            <p className={`text-xs ${inviteResult.success ? "text-green-400" : "text-red-400"}`}>
              {inviteResult.message}
            </p>
          )}
        </Card>
      </div>

      {/* Referral History */}
      <div>
        <h3 className="text-lg font-heading font-normal text-foreground mb-3">Referral History</h3>
        {isLoading ? (
          <Card className="p-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading referrals...</p>
          </Card>
        ) : referrals.length > 0 ? (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Email</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Type</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Reward</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => (
                  <tr key={ref.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground font-medium">
                      {ref.referred_name ?? ref.referred_email}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          ref.type === "contractor"
                            ? "bg-primary/10 text-primary"
                            : "bg-blue-500/10 text-blue-400"
                        }`}
                      >
                        {ref.type === "contractor" ? "Contractor" : "Homeowner"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{statusBadge(ref.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rewardDisplay(ref)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(ref.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium text-foreground">No referrals yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Share your referral link to start earning credits.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
