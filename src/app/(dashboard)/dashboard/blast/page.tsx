"use client";

import { useState, useEffect, useCallback } from "react";
import { Send, CheckCircle } from "lucide-react";
import { useLeads } from "@/hooks/useLeads";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import type { Lead } from "@/types/lead";
import { ComingSoon, STUBS_ENABLED } from "@/components/ComingSoon";

interface BlastRecord {
  id: string;
  job_type: string;
  radius_miles: number;
  target_count: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

const radiusOptions = [
  { value: "0.25", label: "0.25 mi" },
  { value: "0.5", label: "0.5 mi" },
  { value: "1", label: "1 mi" },
];

export default function BlastPage() {
  if (!STUBS_ENABLED) {
    return (
      <ComingSoon
        feature="Neighborhood Blast"
        description="Reach every homeowner near a closed job via SMS/email. Requires per-contractor A2P 10DLC registration — onboarding that flow is what's holding this up."
      />
    );
  }
  return <BlastPageInner />;
}

function BlastPageInner() {
  const { user } = useUser();
  const { data: wonLeads } = useLeads({ filters: { status: ["won"] } });
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [radius, setRadius] = useState("0.5");
  const [channels, setChannels] = useState({ sms: true, email: true });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [pastBlasts, setPastBlasts] = useState<BlastRecord[]>([]);
  const [homeCount, setHomeCount] = useState(0);
  const [estimateSource, setEstimateSource] = useState<"data" | "density">("density");
  const [estimateLoading, setEstimateLoading] = useState(false);

  const won: Lead[] = wonLeads ?? [];
  const selectedLead = won.find((l) => l.id === selectedLeadId) ?? won[0];

  // Initialize selection
  useEffect(() => {
    if (won.length > 0 && !selectedLeadId) setSelectedLeadId(won[0].id);
  }, [won, selectedLeadId]);

  // Fetch dynamic home count estimate when lead or radius changes
  useEffect(() => {
    if (!selectedLead) { setHomeCount(0); return; }
    const lat = (selectedLead as Lead & { latitude?: number }).latitude;
    const lng = (selectedLead as Lead & { longitude?: number }).longitude;
    if (!lat || !lng) { setHomeCount(0); return; }

    setEstimateLoading(true);
    fetch(`/api/blast/estimate?lat=${lat}&lng=${lng}&radius=${radius}`)
      .then((r) => r.json())
      .then((data) => {
        setHomeCount(data.homeCount ?? 0);
        setEstimateSource(data.source ?? "density");
      })
      .catch(() => setHomeCount(0))
      .finally(() => setEstimateLoading(false));
  }, [selectedLead, radius]);

  const loadBlasts = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("blast_campaigns")
      .select("id, job_type, radius_miles, target_count, status, sent_at, created_at")
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    setPastBlasts((data ?? []) as BlastRecord[]);
  }, [user]);

  useEffect(() => { loadBlasts(); }, [loadBlasts]);

  async function handleSend() {
    if (!user || !selectedLead) return;
    setSending(true);
    const supabase = createClient();
    await supabase.from("blast_campaigns").insert({
      contractor_id: user.id,
      job_type: selectedLead.permit_type ?? selectedLead.trade ?? "General",
      radius_miles: parseFloat(radius),
      target_count: homeCount,
      status: "queued",
    });
    setSending(false);
    setSent(true);
    await loadBlasts();
    setTimeout(() => setSent(false), 4000);
  }

  const toggleChannel = (ch: "sms" | "email") =>
    setChannels((prev) => ({ ...prev, [ch]: !prev[ch] }));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Neighborhood Blast</h1>
        <p className="text-sm text-muted-foreground mt-1">Reach every homeowner near a completed job</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Setup */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-5">
          <h2 className="text-lg font-heading font-normal text-foreground">Blast Setup</h2>

          {/* Job selector */}
          <div className="space-y-1.5">
            <label htmlFor="blast-job" className="text-sm font-medium text-foreground">Completed Job</label>
            {won.length === 0 ? (
              <p className="text-xs text-muted-foreground">No won deals yet. Close a deal to enable blasting.</p>
            ) : (
              <select
                id="blast-job"
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {won.map((j) => (
                  <option key={j.id} value={j.id}>{j.address}</option>
                ))}
              </select>
            )}
          </div>

          {/* Radius */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Blast Radius</label>
            <div className="flex gap-3">
              {radiusOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    radius === opt.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-foreground"
                  }`}
                >
                  <input type="radio" name="radius" value={opt.value} checked={radius === opt.value}
                    onChange={(e) => setRadius(e.target.value)} className="sr-only" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Channels */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Channel</label>
            <div className="flex gap-4">
              {(["sms", "email"] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={channels[ch]} onChange={() => toggleChannel(ch)}
                    className="rounded border-border text-primary focus:ring-primary" />
                  {ch.toUpperCase()}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5 text-center space-y-1">
            {estimateLoading ? (
              <div className="h-9 w-20 mx-auto rounded bg-bg-subtle animate-pulse" />
            ) : (
              <p className="text-3xl font-heading font-normal text-primary">
                {homeCount.toLocaleString()}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              homes in blast radius{estimateSource === "density" ? " (est.)" : ""}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Message Preview</h3>
            <div className="rounded-md bg-bg-subtle p-4 text-sm text-foreground leading-relaxed">
              <p>Hi neighbor!</p>
              <p className="mt-2">
                We just completed a roof replacement at{" "}
                <span className="font-medium">{selectedLead?.address ?? "your neighbor's home"}</span>.
                As a local homeowner, you may want a free inspection before the next storm season.
                We are offering neighbors 15% off estimates through the end of the month.
              </p>
              <p className="mt-2">Reply YES for a free estimate.</p>
            </div>
          </div>

          {sent ? (
            <div className="w-full flex items-center justify-center gap-2 rounded-md bg-green-600 px-5 py-2.5 text-sm font-medium text-white">
              <CheckCircle className="h-4 w-4" />
              Blast queued for {homeCount} homes
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={sending || won.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {sending ? "Queuing..." : `Send Blast to ${homeCount} Homes`}
            </button>
          )}
        </div>
      </div>

      {/* Campaign history */}
      {pastBlasts.length > 0 && (
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Past Campaigns</h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Trade</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Radius</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Homes</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {pastBlasts.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{b.job_type}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.radius_miles} mi</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.target_count}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full px-2 py-0.5 text-xs bg-primary-08 text-primary font-medium">
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
