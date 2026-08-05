"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/useUser";
import { FocusTrap } from "@/components/ui/focus-trap";

const TRADES = [
  "Roofing", "HVAC", "Solar", "Electrical", "Plumbing",
  "Addition", "ADU", "Windows", "Painting", "Landscaping",
  "General Remodel", "Foundation",
];

interface AddLeadDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddLeadDialog({ open, onClose }: AddLeadDialogProps) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    address: "",
    trade: "Roofing",
    notes: "",
    status: "new" as const,
    estimated_value: "",
  });

  // Close on Escape — the modal otherwise had no keyboard dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError("");

    const supabase = createClient();

    try {
      // Insert a minimal lead record directly
      const { error: insertError } = await supabase.from("leads").insert({
        contractor_id: user.id,
        address: form.address,
        trade: form.trade,
        notes: form.notes || null,
        status: form.status,
        pipeline_value: form.estimated_value ? parseFloat(form.estimated_value.replace(/[^0-9.]/g, "")) : null,
        score: 50,
        urgency: "cold",
        cascade_flag: false,
        cascade_count: 0,
        score_freshness: 0,
        score_value: 0,
        score_contact: 0,
        score_demand: 0,
        zip: "",
        permit_id: null,
      });

      if (insertError) throw insertError;

      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      onClose();
      setForm({ address: "", trade: "Roofing", notes: "", status: "new", estimated_value: "" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add lead. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <FocusTrap active={open}>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-lead-title"
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 id="add-lead-title" className="text-base font-semibold text-foreground">Add lead to pipeline</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="add-address" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Property address *
            </label>
            <input
              id="add-address"
              required
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="123 Main St, City, CA 90000"
              className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label htmlFor="add-trade" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Trade
            </label>
            <select
              id="add-trade"
              value={form.trade}
              onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {TRADES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="add-value" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Estimated value
            </label>
            <input
              id="add-value"
              value={form.estimated_value}
              onChange={(e) => setForm((f) => ({ ...f, estimated_value: e.target.value }))}
              placeholder="$50,000"
              className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label htmlFor="add-notes" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Notes
            </label>
            <textarea
              id="add-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Owner context, follow-up details..."
              className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium bg-cta text-cta-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "Adding..." : "Add to pipeline"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </FocusTrap>
  );
}
