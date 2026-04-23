"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Printer, X, Send, Copy, Check } from "lucide-react";
import { useLeads } from "@/hooks/useLeads";
import { useEstimates } from "@/hooks/useEstimates";
import { getTradeTierPrices } from "@/lib/constants/trade-costs";

/* ─── Types ─── */
interface LineItem {
  material: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

interface EstimateRecord {
  id: string;
  address: string;
  total: number;
  status: string;
  created_at: string;
}

type Tier = "good" | "better" | "best";

/* ─── Good/Better/Best Templates ─── */
/**
 * Tier multipliers are now trade-specific and sourced from
 * `src/lib/constants/trade-costs.ts` (national medians). The static
 * `multiplier` on each entry is the fallback when no trade is known —
 * prior arbitrary 1.0/1.35/1.75 is retained as the "other" default but
 * actual rendering uses `tierMultiplierForTrade` below.
 */
const tierTemplates: Record<Tier, { label: string; description: string; multiplier: number; color: string }> = {
  good: {
    label: "Good",
    description: "Standard materials, basic scope, budget-friendly",
    multiplier: 1.0,
    color: "border-blue-500/30 bg-blue-500/5",
  },
  better: {
    label: "Better",
    description: "Mid-range materials, enhanced scope, best value",
    multiplier: 1.35,
    color: "border-primary/30 bg-primary/5",
  },
  best: {
    label: "Best",
    description: "Premium materials, full scope, top quality",
    multiplier: 1.75,
    color: "border-green-500/30 bg-green-500/5",
  },
};

/* ─── Status Badge ─── */
function statusBadge(status: string) {
  if (status === "accepted")
    return <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">Accepted</span>;
  if (status === "sent")
    return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">Sent</span>;
  if (status === "viewed")
    return <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-400">Viewed</span>;
  if (status === "declined")
    return <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">Declined</span>;
  return <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">Draft</span>;
}

/* ─── Send Estimate Modal ─── */
function SendModal({ id, total, address, onClose }: { id: string; total: number; address: string; onClose: () => void }) {
  const [method, setMethod] = useState<"sms" | "email">("email");
  const [recipient, setRecipient] = useState("");
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ESC-to-dismiss: attach on mount, remove on unmount. Modal backdrop
  // click already closes via the div's onClick, but keyboard users
  // previously had no way out except Tab-to-close-button + Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const message = method === "email"
    ? `Hi,\n\nThank you for your interest in our services. Attached is your estimate for the project at ${address}.\n\nEstimate Total: $${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\nPlease review and let us know if you have any questions. We look forward to working with you!\n\nBest regards`
    : `Hi! Here's your estimate for ${address}: $${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. View the full breakdown here: [link]. Reply YES to accept or call us with questions!`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-heading font-normal text-foreground">Send Estimate</h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-subtle transition-colors" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2">
          {(["email", "sms"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                method === m ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "email" ? "Email" : "SMS"}
            </button>
          ))}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {method === "email" ? "Email Address" : "Phone Number"}
          </label>
          <input
            type={method === "email" ? "email" : "tel"}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={method === "email" ? "homeowner@email.com" : "(310) 555-0123"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Message Preview</p>
          <div className="rounded-lg bg-bg-subtle p-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto">
            {message}
          </div>
        </div>

        {sent ? (
          <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400 text-center">
            Estimate sent to {recipient}
          </div>
        ) : (
          <>
            {sendError && (
              <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive" role="alert">
                {sendError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-bg-subtle transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={async () => {
                  if (!recipient.trim() || sending) return;
                  setSending(true);
                  setSendError(null);
                  try {
                    // POST to the real send endpoint. Currently email-only
                    // (Resend) — SMS would need Twilio wired at the server
                    // side, so we pass the channel through and let the
                    // backend reject SMS with a clear error until it ships.
                    const res = await fetch("/api/estimates/send", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ estimate_id: id, to_email: method === "email" ? recipient : undefined, to_phone: method === "sms" ? recipient : undefined, channel: method }),
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok || j.ok === false) {
                      throw new Error(j.provider_error ?? j.error ?? `Server returned ${res.status}`);
                    }
                    setSent(true);
                    setTimeout(onClose, 1500);
                  } catch (e) {
                    setSendError(e instanceof Error ? e.message : "Couldn't send — try again.");
                  } finally {
                    setSending(false);
                  }
                }}
                disabled={!recipient.trim() || sending}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Estimate Builder Modal ─── */
function EstimateModal({ onClose, onSaved, onSave }: { onClose: () => void; onSaved: () => void; onSave: (data: any) => Promise<{ success: boolean; error?: string }> }) {
  const { data: leads } = useLeads();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [taxRate, setTaxRate] = useState(8.75);
  const [activeTier, setActiveTier] = useState<Tier>("better");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { material: "", quantity: 1, unit: "item", unitPrice: 0 },
  ]);

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);

  const addLine = () => setLineItems((prev) => [...prev, { material: "", quantity: 1, unit: "item", unitPrice: 0 }]);
  const removeLine = (i: number) => setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof LineItem, value: string | number) =>
    setLineItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  const baseSubtotal = lineItems.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  // Trade-aware tier multipliers. For a known trade we compute the ratio
  // against the "good" anchor from national median costs (see
  // src/lib/constants/trade-costs.ts). Fallback to the static template
  // multipliers when no lead/trade is selected.
  const tradeKey = (selectedLead?.trade ?? selectedLead?.permit_type ?? "").toLowerCase();
  const tradeTiers = tradeKey ? getTradeTierPrices(tradeKey) : null;
  const tierMultiplier = tradeTiers
    ? (activeTier === "good"
        ? 1
        : activeTier === "better"
          ? tradeTiers.better / tradeTiers.good
          : tradeTiers.best / tradeTiers.good)
    : tierTemplates[activeTier].multiplier;
  const subtotal = baseSubtotal * tierMultiplier;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  async function handleSave() {
    setSaving(true);
    setError("");
    const address = selectedLead ? selectedLead.address : "Manual estimate";
    const contact_name = selectedLead?.owner_name ?? "";
    const contact_email = selectedLead?.email ?? "";

    const tradeTiersLocal = tradeKey ? getTradeTierPrices(tradeKey) : null;
    const mult = (tier: Tier) => {
      if (!tradeTiersLocal) return tierTemplates[tier].multiplier;
      if (tier === "good") return 1;
      if (tier === "better") return tradeTiersLocal.better / tradeTiersLocal.good;
      return tradeTiersLocal.best / tradeTiersLocal.good;
    };
    const buildTier = (tier: Tier) => ({
      label: tierTemplates[tier].label,
      items: lineItems,
      total: baseSubtotal * mult(tier),
    });

    const result = await onSave({
      trade: "general",
      zip: "",
      description: address,
      tiers: {
        good: buildTier("good"),
        better: buildTier("better"),
        best: buildTier("best"),
      },
      amount: total,
      status: "draft",
      contact_name,
      contact_email,
    });

    setSaving(false);
    if (!result.success) { setError(result.error ?? "Failed to save estimate"); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm print:hidden">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">New Estimate</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Lead selector */}
          <div>
            <label htmlFor="est-lead" className="block text-xs font-medium text-muted-foreground mb-1.5">Link to lead (optional)</label>
            <select id="est-lead" value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— No lead linked —</option>
              {(leads ?? []).map((l) => <option key={l.id} value={l.id}>{l.address}</option>)}
            </select>
          </div>

          {/* Good / Better / Best Tiers */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Pricing Tier</p>
            <div className="grid grid-cols-3 gap-3">
              {(Object.entries(tierTemplates) as [Tier, typeof tierTemplates.good][]).map(([key, tier]) => (
                <button
                  key={key}
                  onClick={() => setActiveTier(key)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    activeTier === key ? tier.color + " ring-1 ring-primary/40" : "border-border hover:border-border/80"
                  }`}
                >
                  <p className="text-sm font-medium text-foreground">{tier.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{tier.description}</p>
                  {key !== "good" && (
                    <p className="text-[10px] text-primary mt-1">+{Math.round((tier.multiplier - 1) * 100)}% from base</p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Line items (base prices)</p>
              <button onClick={addLine} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="h-3 w-3" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[11px] text-muted-foreground px-1">
                <span className="col-span-5">Description</span>
                <span className="col-span-2 text-right">Qty</span>
                <span className="col-span-2">Unit</span>
                <span className="col-span-2 text-right">Unit price</span>
                <span className="col-span-1" />
              </div>
              {lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input className="col-span-5 px-2 py-1.5 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Material or service" value={item.material} onChange={(e) => updateLine(i, "material", e.target.value)} />
                  <input type="number" min="0" className="col-span-2 px-2 py-1.5 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-right"
                    value={item.quantity} onChange={(e) => updateLine(i, "quantity", parseFloat(e.target.value) || 0)} />
                  <input className="col-span-2 px-2 py-1.5 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="unit" value={item.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                  <input type="number" min="0" step="0.01" className="col-span-2 px-2 py-1.5 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-right"
                    value={item.unitPrice} onChange={(e) => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)} />
                  <button onClick={() => removeLine(i)} className="col-span-1 flex justify-center text-muted-foreground hover:text-red-500 transition-colors" aria-label="Remove line">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex items-start justify-between gap-8 pt-2 border-t border-border">
            <div>
              <label htmlFor="est-tax" className="text-xs font-medium text-muted-foreground">Tax rate %</label>
              <input id="est-tax" type="number" min="0" max="30" step="0.01"
                className="mt-1 w-24 px-2 py-1.5 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
                value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="flex flex-col items-end gap-1 text-sm">
              <div className="flex justify-between w-52">
                <span className="text-muted-foreground">Base subtotal</span>
                <span>${baseSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-52">
                <span className="text-muted-foreground">{tierTemplates[activeTier].label} tier ({tierMultiplier}x)</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-52">
                <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                <span>${tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-52 font-semibold border-t border-border pt-1">
                <span>Total</span>
                <span className="text-primary">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? "Saving..." : "Save estimate"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */
export default function EstimatePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<{ id: string; total: number; address: string } | null>(null);
  const { estimates: rawEstimates, isLoading, createEstimate, refresh } = useEstimates();

  const estimates: EstimateRecord[] = rawEstimates.map((e) => ({
    id: e.id,
    address: e.description || e.customer_name || "Estimate",
    total: typeof e.total === "number" ? e.total : 0,
    status: e.status,
    created_at: e.created_at,
  }));

  const loaded = !isLoading;

  // Stats
  const stats = {
    total: estimates.length,
    accepted: estimates.filter((e) => e.status === "accepted").length,
    pending: estimates.filter((e) => e.status === "sent" || e.status === "viewed").length,
    avgValue: estimates.length > 0 ? estimates.reduce((s, e) => s + (e.total || 0), 0) / estimates.length : 0,
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-heading font-normal text-foreground">Estimate Builder</h1>
          <p className="text-sm text-muted-foreground mt-1">Create, send, and track professional estimates with Good/Better/Best pricing</p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
          <Plus className="h-4 w-4" />
          Create Estimate
        </button>
      </div>

      {/* Quick Stats */}
      {loaded && estimates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Estimates</p>
            <p className="text-2xl font-heading font-normal text-foreground mt-1">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Accepted</p>
            <p className="text-2xl font-heading font-normal text-green-400 mt-1">{stats.accepted}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-heading font-normal text-blue-400 mt-1">{stats.pending}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg. Value</p>
            <p className="text-2xl font-heading font-normal text-primary mt-1">${stats.avgValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        </div>
      )}

      {/* Recent Estimates */}
      {loaded && estimates.length > 0 && (
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Recent Estimates</h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Address</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Total</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Date</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((est) => (
                  <tr key={est.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{est.address}</td>
                    <td className="px-4 py-3 text-foreground font-medium">${(est.total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3">{statusBadge(est.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(est.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      {est.status === "draft" && (
                        <button
                          onClick={() => setSendTarget({ id: est.id, total: est.total, address: est.address })}
                          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                        >
                          <Send className="h-3 w-3" /> Send
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loaded && estimates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl">
          <p className="text-sm font-semibold text-foreground">No estimates yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first estimate with Good/Better/Best pricing tiers.</p>
          <button onClick={() => setModalOpen(true)}
            className="mt-4 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
            Create first estimate
          </button>
        </div>
      )}

      {/* Modals */}
      {modalOpen && <EstimateModal onClose={() => setModalOpen(false)} onSaved={refresh} onSave={createEstimate} />}
      {sendTarget && <SendModal id={sendTarget.id} total={sendTarget.total} address={sendTarget.address} onClose={() => setSendTarget(null)} />}
    </div>
  );
}
