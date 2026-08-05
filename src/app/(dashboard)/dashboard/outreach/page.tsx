"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLeads } from "@/hooks/useLeads";
import { useOutreach } from "@/hooks/useOutreach";
import { FocusTrap } from "@/components/ui/focus-trap";
import { OutreachLibraryCard } from "@/components/dashboard/OutreachLibraryCard";
import { AutoFireOutreachToggle } from "@/components/dashboard/AutoFireOutreachToggle";
import { Card } from "@/components/ui/card";

interface Template {
  name: string;
  channel: "SMS" | "Email";
  preview: string;
  /** Phase AA — opportunity_stage this template targets (from migration
   *  00091's stage-specific seeds, or any contractor-authored row that
   *  set the column). Null = generic / non-stage-specific. Drives the
   *  stage filter dropdown above the template list. */
  stage?: string | null;
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

/* Token catalog + sample values for live preview. The Phase 1.5 sprint
 * plan calls for a token picker; this is the catalog that powers it.
 * Token names match what the sequence engine substitutes at send-time
 * (see src/lib/sequences/engine.ts). */
const TEMPLATE_TOKENS: { name: string; sample: string; hint: string }[] = [
  { name: "{{owner_first}}",        sample: "John",                   hint: "First name of the homeowner" },
  { name: "{{owner_last}}",         sample: "Smith",                  hint: "Last name of the homeowner" },
  { name: "{{address}}",            sample: "123 Maple St, Hartford", hint: "Full property address" },
  { name: "{{address_short}}",      sample: "123 Maple St",           hint: "Just the street address" },
  { name: "{{permit_number}}",      sample: "BLD-2026-04123",         hint: "City permit identifier" },
  { name: "{{permit_type}}",        sample: "Residential roofing",    hint: "Type of permit" },
  { name: "{{permit_value}}",       sample: "$24,000",                hint: "Estimated job value" },
  { name: "{{permit_description}}", sample: "Asphalt re-roof, 22sq",  hint: "Scope of work text" },
  { name: "{{trade}}",              sample: "roofing",                hint: "Trade slug" },
  { name: "{{zip}}",                sample: "06106",                  hint: "Property ZIP" },
  { name: "{{contractor_name}}",    sample: "Mike Henderson",         hint: "Contractor's first name" },
  { name: "{{contractor_company}}", sample: "Apex Roofing LLC",       hint: "Contractor business name" },
  { name: "{{contractor_phone}}",   sample: "(860) 555-0142",         hint: "Contractor callback number" },
  { name: "{{contractor_license}}", sample: "HIC.0654321",            hint: "Contractor license number" },
];

/** Render a template body with tokens replaced by sample values for the
 *  live-preview pane. Pure function; safe for render. */
function renderPreview(body: string): string {
  let out = body;
  for (const t of TEMPLATE_TOKENS) {
    out = out.replaceAll(t.name, t.sample);
  }
  return out;
}

/** Compute SMS segment count per the 7-bit GSM standard (160-char
 *  segments, or 153 chars/segment when the message is multi-part). */
function smsSegments(text: string): { chars: number; segments: number } {
  const chars = text.length;
  if (chars === 0) return { chars: 0, segments: 0 };
  if (chars <= 160) return { chars, segments: 1 };
  return { chars, segments: Math.ceil(chars / 153) };
}

function TemplateModal({ template, onClose, onSave }: TemplateModalProps) {
  const [name, setName] = useState(template.name);
  const [channel, setChannel] = useState<"SMS" | "Email">(template.channel);
  const [preview, setPreview] = useState(template.preview);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ESC closes the modal. FocusTrap below handles Tab-cycle; without
  // this keyboard users had to Shift+Tab to the X button and Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Insert a token at the current cursor position in the textarea.
   *  Falls back to appending if the textarea isn't focused. */
  function insertToken(token: string) {
    const el = textareaRef.current;
    if (!el) {
      setPreview((p) => p + token);
      return;
    }
    const start = el.selectionStart ?? preview.length;
    const end = el.selectionEnd ?? preview.length;
    const next = preview.slice(0, start) + token + preview.slice(end);
    setPreview(next);
    // Restore cursor to just-past-inserted-token.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const rendered = renderPreview(preview);
  const sms = channel === "SMS" ? smsSegments(rendered) : null;

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
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
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

          {/* Phase 1.5: Token picker — clickable chips that insert at cursor.
           * Replaces the previous "Use {first_name}, ..." hint with a real
           * UI affordance. Each chip carries a tooltip with sample value. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Tokens (click to insert)
              </label>
              <span className="text-[10px] text-muted-foreground">
                Replaced with real values at send time
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_TOKENS.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => insertToken(t.name)}
                  title={`${t.hint} — sample: ${t.sample}`}
                  className="rounded-md border border-border bg-bg-subtle px-2 py-1 text-[10px] font-mono text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="tpl-body">
                Message Body
              </label>
              {sms && (
                <span
                  className={
                    sms.segments > 1
                      ? "text-[10px] text-warm font-medium"
                      : "text-[10px] text-muted-foreground"
                  }
                  title="SMS messages over 160 characters are split into multiple segments — each charged separately by Twilio."
                >
                  {sms.chars} chars · {sms.segments} SMS segment{sms.segments === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <textarea
              id="tpl-body"
              ref={textareaRef}
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none font-mono"
            />
          </div>

          {/* Phase 1.5: Live preview pane. Renders the message with sample
           * token values so the contractor sees what the homeowner actually
           * receives — without needing a real lead. */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Preview (with sample values)
            </label>
            <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-sm text-foreground whitespace-pre-wrap min-h-[80px]">
              {rendered.trim() || (
                <span className="text-muted-foreground italic text-xs">
                  Preview will render here as you type or click tokens above.
                </span>
              )}
            </div>
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
  const { data: leads = [], isLoading: leadsLoading } = useLeads({ filters: { status: ["new", "contacted"] } });
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
              {/* Disabled-while-loading so the picker doesn't flash an
                  empty "Choose a lead..." list before the fetch lands. */}
              <select
                id="send-lead"
                value={selectedLead}
                onChange={(e) => setSelectedLead(e.target.value)}
                disabled={leadsLoading}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {leadsLoading ? (
                  <option value="">Loading leads...</option>
                ) : (
                  <>
                    <option value="">Choose a lead...</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.address ?? "Unknown address"}
                      </option>
                    ))}
                  </>
                )}
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
  // Phase AA — stage filter for the template library. "all" shows
  // everything (incl. legacy generic templates with stage=null);
  // picking a stage shows only the templates targeting that stage.
  const [stageFilter, setStageFilter] = useState<string>("all");
  const { stats: outreachStats, recent: outreachRecent, isLoading, error: outreachError, refresh: refreshOutreach, sendOutreach } = useOutreach();

  /* Hydrate templates from the contractor's saved rows. Previously
   * `defaultTemplates` was the only source — any TemplateModal.handleSave
   * upserted to the DB but the UI never refetched, so on reload the edit
   * was invisible. Now we fetch on mount and replace the seed list when
   * the DB returns any rows. */
  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Phase AA — also fetch the global library rows (contractor_id IS NULL,
    // is_library=true) so the 5 stage-specific templates seeded by
    // migration 00091 surface alongside the contractor's own rows. The RLS
    // policy on outreach_templates already permits SELECT of library rows
    // for any authenticated user (migration 00032).
    const { data } = await supabase
      .from("outreach_templates")
      .select("name, channel, body, subject, stage, contractor_id, is_library")
      .or(`contractor_id.eq.${user.id},and(contractor_id.is.null,is_library.eq.true)`)
      .order("updated_at", { ascending: false });
    if (data && data.length > 0) {
      type Row = {
        name?: string | null;
        subject?: string | null;
        channel?: string | null;
        body?: string | null;
        stage?: string | null;
      };
      setTemplates(
        (data as Row[]).map((r) => ({
          name: r.name ?? r.subject ?? "Untitled",
          channel: r.channel?.toUpperCase() === "EMAIL" ? "Email" : "SMS",
          preview: r.body ?? "",
          stage: r.stage ?? null,
        })),
      );
    }
  }, []);
  useEffect(() => {
    // Fetch templates on mount — setState happens inside fetchTemplates after IO
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

      {/* Phase 0a wedge #6 — auto-fire outreach on lead create.
       *
       * Promoted ABOVE the stats row on 2026-04-23 (design critique M7).
       * On a fresh account the stats are all "0 / 0.0% / 0.0%" and
       * reading three zeros before discovering the capability that will
       * populate them was the wrong information order. Capability first,
       * measurement second — stats only become meaningful once auto-fire
       * or a manual send has happened. */}
      <AutoFireOutreachToggle />

      {/* Stats Row. Shows empty-state helper when nothing's been sent
       * yet — avoids the "0 / 0.0% / 0.0%" dead-zone that mixed with
       * the auto-fire toggle order used to suggest the feature was
       * broken. When `total_sent` is 0 we explicitly frame the zeros
       * as "waiting for first send" rather than a failed metric. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            {isLoading ? (
              <div className="h-8 w-16 mt-1 rounded bg-muted animate-pulse" />
            ) : (
              <p className="text-2xl font-heading font-normal text-foreground mt-1">{stat.value}</p>
            )}
          </Card>
        ))}
      </div>
      {outreachError && (
        <div
          role="alert"
          className="-mt-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <p className="text-[12px] text-destructive">
            {outreachError} These numbers may be incomplete — retry.
          </p>
          <button
            type="button"
            onClick={() => refreshOutreach()}
            className="text-[12px] font-medium text-destructive underline underline-offset-2 hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}
      {!isLoading && !outreachError && outreachStats.total_sent === 0 && (
        <p className="-mt-2 text-[11px] text-muted-foreground italic">
          Stats will populate after your first outbound message. Enable
          auto-fire above to start automatically, or use a template below
          to send manually.
        </p>
      )}

      {/* Phase 0a wedge #10 — starter template library. Renders only
          when migration 00032 is live + seeded. Copy buttons clone
          a library template into the contractor's own. */}
      <OutreachLibraryCard onCopied={() => fetchTemplates()} />

      {/* Templates */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-heading font-normal text-foreground">Outreach Templates</h2>
          {/* Phase AA — stage filter (URL-stable could come later; for now
              this is in-component state). Renders only when ≥1 template
              has a stage value, so legacy contractors see no UI churn
              until the migration 00091 templates land. */}
          {templates.some((t) => t.stage) && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="outreach-stage-filter">
                Stage
              </label>
              <select
                id="outreach-stage-filter"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="text-sm rounded-lg border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="all">All templates</option>
                <option value="generic">Generic only</option>
                {Array.from(new Set(templates.map((t) => t.stage).filter(Boolean) as string[])).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {templates
            .filter((tpl) => {
              if (stageFilter === "all") return true;
              if (stageFilter === "generic") return !tpl.stage;
              return tpl.stage === stageFilter;
            })
            .map((tpl) => (
            <Card
              key={tpl.name}
              className="p-4 space-y-2 hover:border-primary/40 transition-colors cursor-pointer"
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
              {/* Phase AA — stage chip on the template card so contractors
                  can see at a glance which stage the template targets,
                  even when the filter dropdown isn't engaged. */}
              {tpl.stage && (
                <p className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary-10 text-primary border border-primary/30 leading-tight">
                  {tpl.stage.replace(/_/g, " ")}
                </p>
              )}
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
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Outreach Log */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">Recent Outreach</h2>
        {isLoading ? (
          <Card className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded bg-muted animate-pulse" />
            ))}
          </Card>
        ) : recentOutreach.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">No outreach sent yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use a template above to send your first message.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
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
          </Card>
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
