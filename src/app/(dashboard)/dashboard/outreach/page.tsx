"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLeads } from "@/hooks/useLeads";
import { useOutreach } from "@/hooks/useOutreach";
import { FocusTrap } from "@/components/ui/focus-trap";
import { OutreachLibraryCard } from "@/components/dashboard/OutreachLibraryCard";
import { AutoFireOutreachToggle } from "@/components/dashboard/AutoFireOutreachToggle";

interface Template {
  name: string;
  channel: "SMS" | "Email";
  preview: string;
}

const defaultTemplates: Template[] = [
  {
    name: "New Lead SMS",
    channel: "SMS",
    preview:
      "Hi {first_name}, I noticed your home at {address} might benefit from a free roof inspection. We're offering complimentary assessments this week. Interested?",
  },
  {
    name: "Follow-up Email",
    channel: "Email",
    preview:
      "Subject: Your Roof Inspection Report\n\nHi {first_name}, just following up on our conversation last week. I've attached the inspection report for your review...",
  },
  {
    name: "Quote Reminder",
    channel: "SMS",
    preview:
      "Hey {first_name}, just a friendly reminder that your roofing estimate of {amount} is valid through Friday. Happy to answer any questions!",
  },
];

/* ── Time-ago helper ── */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function channelBadge(channel: string) {
  return channel === "SMS" ? (
    <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">SMS</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-400">Email</span>
  );
}

function statusBadge(status: string) {
  // Normalize for case-insensitive matching — `recentOutreach` maps DB
  // values to Title-Case strings, but a few call-sites still pass raw
  // lowercase ("sent", "failed"). Previously only "Replied"/"Opened"/
  // "Queued" + lowercase "failed" matched, so "Sent"/"sent" fell through
  // to the default branch, which happened to *still* label "Sent" — but
  // "Failed" with capital F would have shown as "Sent". Fix by lowering
  // then switching explicitly.
  const s = status.toLowerCase();
  if (s === "replied")
    return <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">Replied</span>;
  if (s === "opened")
    return <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">Opened</span>;
  if (s === "queued")
    return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">Queued</span>;
  if (s === "failed")
    return <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">Failed</span>;
  // Default = sent (delivered, no further telemetry yet).
  return <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">Sent</span>;
}

/* ── Template Edit Modal ── */
interface TemplateModalProps {
  template: Template;
  onClose: () => void;
  onSave: (updated: Template) => void;
}

function TemplateModal({ template, onClose, onSave }: TemplateModalProps) {
  const [name, setName] = useState(template.name);
  const [channel, setChannel] = useState<"SMS" | "Email">(template.channel);
  const [preview, setPreview] = useState(template.preview);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ESC closes the modal. FocusTrap below handles Tab-cycle; without
  // this keyboard users had to Shift+Tab to the X button and Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    if (!name.trim() || !preview.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("outreach_templates").upsert({
        contractor_id: user.id,
        name: name.trim(),
        subject: name.trim(),
        body: preview.trim(),
        channel: channel.toLowerCase(),
      });
    }
    setSaving(false);
    setSaved(true);
    onSave({ name, channel, preview });
    setTimeout(onClose, 800);
  }

  return (
    <FocusTrap active>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-modal-title"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="tpl-modal-title" className="text-lg font-heading font-normal text-foreground">
            Edit Template
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-subtle transition-colors"
            aria-label="Close template editor"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tpl-name">
              Template Name
            </label>
            <input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tpl-channel">
              Channel
            </label>
            <select
              id="tpl-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "SMS" | "Email")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="SMS">SMS</option>
              <option value="Email">Email</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tpl-body">
              Message Body
              <span className="ml-2 font-normal text-muted-foreground/70">Use {"{first_name}"}, {"{address}"}, {"{amount}"} as variables</span>
            </label>
            <textarea
              id="tpl-body"
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
        </div>

        {saved ? (
          <div className="rounded-lg bg-success/10 p-2 text-sm text-success text-center">Saved</div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground hover:bg-bg-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !preview.trim()}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Template"}
            </button>
          </div>
        )}
      </div>
    </div>
    </FocusTrap>
  );
}

/* ── Send Outreach Modal ── */
interface SendModalProps {
  templateName: string;
  channel: "sms" | "email";
  message: string;
  onClose: () => void;
  onSend: (data: { lead_id: string; channel: "sms" | "email"; template_name: string; message: string }) => Promise<{ success: boolean; error?: string }>;
}

function SendModal({ templateName, channel, message, onClose, onSend }: SendModalProps) {
  const { data: leads = [] } = useLeads({ filters: { status: ["new", "contacted"] } });
  const [selectedLead, setSelectedLead] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ESC dismisses.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSend() {
    if (!selectedLead) return;
    setSending(true);
    setSendError(null);
    const result = await onSend({
      lead_id: selectedLead,
      channel,
      template_name: templateName,
      message,
    });
    setSending(false);
    if (result.success) {
      setSent(true);
      // Phase 2.5 — fire a toast so the contractor gets persistent
      // feedback even after the modal auto-closes.
      const { toast } = await import("@/components/toast/Toaster");
      // Honest label: /api/outreach inserts status='queued'; the cron
      // worker dispatches separately. Previously said "Sent" which was
      // optimistic — if the worker is down the homeowner never got
      // anything.
      toast.success(
        channel === "email"
          ? `Email queued (${templateName})`
          : `SMS queued (${templateName})`,
      );
      setTimeout(onClose, 1200);
    } else {
      const msg = result.error ?? "Failed to send";
      setSendError(msg);
      const { toast } = await import("@/components/toast/Toaster");
      toast.error(`Send failed — ${msg}`);
    }
  }

  return (
    <FocusTrap active>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-modal-title"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="send-modal-title" className="text-lg font-heading font-normal text-foreground">
            Send: {templateName}
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-subtle transition-colors"
            aria-label="Close send modal"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="rounded-lg bg-success/10 p-3 text-sm text-success text-center">Message queued successfully</div>
        ) : (
          <>
            {sendError && (
              <div className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive text-center">{sendError}</div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="send-lead">
                Select Lead
              </label>
              <select
                id="send-lead"
                value={selectedLead}
                onChange={(e) => setSelectedLead(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Choose a lead...</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.address ?? "Unknown address"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground hover:bg-bg-subtle transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!selectedLead || sending}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    </FocusTrap>
  );
}

export default function OutreachPage() {
  const [templates, setTemplates] = useState<Template[]>(defaultTemplates);
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [sendTarget, setSendTarget] = useState<Template | null>(null);
  const { stats: outreachStats, recent: outreachRecent, isLoading, sendOutreach } = useOutreach();

  /* Hydrate templates from the contractor's saved rows. Previously
   * `defaultTemplates` was the only source — any TemplateModal.handleSave
   * upserted to the DB but the UI never refetched, so on reload the edit
   * was invisible. Now we fetch on mount and replace the seed list when
   * the DB returns any rows. */
  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("outreach_templates")
      .select("name, channel, body, subject")
      .eq("contractor_id", user.id)
      .order("updated_at", { ascending: false });
    if (data && data.length > 0) {
      type Row = { name?: string | null; subject?: string | null; channel?: string | null; body?: string | null };
      setTemplates(
        (data as Row[]).map((r) => ({
          name: r.name ?? r.subject ?? "Untitled",
          channel: r.channel?.toUpperCase() === "EMAIL" ? "Email" : "SMS",
          preview: r.body ?? "",
        })),
      );
    }
  }, []);
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const stats = isLoading
    ? [
        { label: "Messages Sent", value: "..." },
        { label: "Open Rate", value: "..." },
        { label: "Reply Rate", value: "..." },
      ]
    : [
        { label: "Messages Sent", value: String(outreachStats.total_sent) },
        { label: "Open Rate", value: `${outreachStats.open_rate.toFixed(1)}%` },
        { label: "Reply Rate", value: `${outreachStats.reply_rate.toFixed(1)}%` },
      ];

  const recentOutreach = outreachRecent.map((item) => ({
    name: item.address,
    channel: item.channel === "sms" ? "SMS" : "Email",
    template: item.subject ?? "Direct message",
    status: item.status === "sent" ? "Sent" : item.status === "queued" ? "Queued" : item.status,
    time: timeAgo(item.created_at),
  }));

  function handleTemplateSave(updated: Template) {
    // Optimistic: update the in-memory list so the modal-close feels
    // instant. Then refetch from DB so any field normalization the upsert
    // applied (trimmed whitespace, default channel) is reflected.
    setTemplates((prev) =>
      prev.map((t) => (t.name === editTarget?.name ? updated : t))
    );
    fetchTemplates();
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Outreach</h1>
        <p className="text-sm text-muted-foreground mt-1">Automated SMS &amp; email sequences</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            {isLoading ? (
              <div className="h-8 w-16 mt-1 rounded bg-muted animate-pulse" />
            ) : (
              <p className="text-2xl font-heading font-normal text-foreground mt-1">{stat.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Phase 0a wedge #6 — auto-fire outreach on lead create. */}
      <AutoFireOutreachToggle />

      {/* Phase 0a wedge #10 — starter template library. Renders only
          when migration 00032 is live + seeded. Copy buttons clone
          a library template into the contractor's own. */}
      <OutreachLibraryCard onCopied={() => fetchTemplates()} />

      {/* Templates */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">Outreach Templates</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <div
              key={tpl.name}
              className="rounded-lg border border-border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors cursor-pointer"
              onClick={() => setEditTarget(tpl)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setEditTarget(tpl)}
              aria-label={`Edit ${tpl.name} template`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                {channelBadge(tpl.channel)}
              </div>
              <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed line-clamp-3">
                {tpl.preview}
              </p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-primary">Click to edit</p>
                <button
                  onClick={(e) => { e.stopPropagation(); setSendTarget(tpl); }}
                  className="text-xs text-primary hover:underline"
                  aria-label={`Send ${tpl.name}`}
                >
                  Send
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Outreach Log */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">Recent Outreach</h2>
        {isLoading ? (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : recentOutreach.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No outreach sent yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use a template above to send your first message.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Lead</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Channel</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Template</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Time</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentOutreach.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{row.name}</td>
                    <td className="px-4 py-3">{channelBadge(row.channel)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.template}</td>
                    <td className="px-4 py-3">{statusBadge(row.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.time}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          const tpl = templates.find((t) => t.name === row.template);
                          if (tpl) setSendTarget(tpl);
                        }}
                        className="text-xs text-primary hover:underline"
                        aria-label={`Send ${row.template} to ${row.name}`}
                      >
                        Send
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Template Edit Modal */}
      {editTarget && (
        <TemplateModal
          template={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleTemplateSave}
        />
      )}

      {/* Send Modal */}
      {sendTarget && (
        <SendModal
          templateName={sendTarget.name}
          channel={sendTarget.channel === "SMS" ? "sms" : "email"}
          message={sendTarget.preview}
          onClose={() => setSendTarget(null)}
          onSend={sendOutreach}
        />
      )}
    </div>
  );
}
