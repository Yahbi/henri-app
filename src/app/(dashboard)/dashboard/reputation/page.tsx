"use client";

import { useEffect, useState, useMemo } from "react";
import { Send, Copy, Check, Loader2, Star } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { ComingSoon, STUBS_ENABLED } from "@/components/ComingSoon";
import { useReviews } from "@/hooks/useReviews";
import { Card } from "@/components/ui/card";
import { FocusTrap } from "@/components/ui/focus-trap";

/* ─── Types ─── */
type Sentiment = "positive" | "neutral" | "negative";

interface ReviewItem {
  id: string;
  reviewer: string;
  platform: string;
  stars: number;
  date: string;
  text: string;
  sentiment: Sentiment;
  responded: boolean;
  trade: string | null;
}

/* ─── AI Response Templates ─── */
function generateAIResponse(reviewer: string, stars: number): string {
  const firstName = reviewer.split(" ")[0];
  if (stars >= 5) {
    return `Thank you so much, ${firstName}! We're thrilled to hear about your experience. Our team takes pride in delivering quality work and it means a lot when customers notice. We look forward to serving you again!`;
  }
  if (stars >= 4) {
    return `Thanks for the kind words, ${firstName}! We appreciate you taking the time to share your experience. We're always working to improve our timelines and communication. Hope to work with you again soon!`;
  }
  if (stars >= 3) {
    return `Hi ${firstName}, thank you for your honest feedback. We apologize for any inconvenience — we're actively improving our process. We're glad the actual work met your expectations and hope to earn a better experience next time.`;
  }
  return `Hi ${firstName}, we sincerely apologize for your experience. This falls below our standards and we'd like to make it right. Please reach out to us directly so we can resolve this. Your satisfaction is our priority.`;
}

/* ─── Components ─── */
function StarRating({ count }: { count: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill={i < count ? "#D4A24A" : "none"}
          stroke={i < count ? "#D4A24A" : "currentColor"}
          strokeWidth="1.5"
          aria-hidden="true"
          className={i < count ? "" : "text-border"}
        >
          <path d="M8 1.5l1.85 3.75 4.15.6-3 2.93.71 4.12L8 10.77l-3.71 1.95.71-4.12-3-2.93 4.15-.6z" />
        </svg>
      ))}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const config = {
    positive: { label: "Positive", cls: "bg-green-500/10 text-green-400" },
    neutral: { label: "Neutral", cls: "bg-yellow-500/10 text-yellow-400" },
    negative: { label: "Negative", cls: "bg-red-500/10 text-red-400" },
  }[sentiment];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.cls}`}>
      {config.label}
    </span>
  );
}

function TrendBar({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map((d) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{d.count}</span>
          <div
            className="w-full rounded-t bg-primary/70 transition-all"
            style={{ height: `${(d.count / max) * 100}%`, minHeight: 4 }}
          />
          <span className="text-[10px] text-muted-foreground">{d.month}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Reply Modal ─── */
function ReplyModal({ review, onClose }: { review: ReviewItem; onClose: () => void }) {
  // Seed with the canonical fallback so the textarea isn't empty while the
  // Claude draft is fetching. Swapped in by the useEffect below.
  const [text, setText] = useState(
    () => generateAIResponse(review.reviewer, review.stars),
  );
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Escape-to-close — the modal otherwise had no keyboard dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch a Claude-drafted reply on mount. Falls back to the canonical
  // template if the endpoint is unavailable or the model errors.
  useEffect(() => {
    let cancelled = false;
    async function fetchDraft() {
      setAiLoading(true);
      setAiError(null);
      try {
        const res = await fetch("/api/ai/draft-reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: review.stars,
            text: review.text,
            platform: review.platform,
            reviewer_name: review.reviewer,
          }),
        });
        if (!res.ok) throw new Error(`AI draft returned ${res.status}`);
        const j = (await res.json()) as { draft?: string };
        if (!cancelled && j.draft) setText(j.draft);
      } catch (e) {
        if (!cancelled) setAiError((e as Error).message);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }
    fetchDraft();
    return () => {
      cancelled = true;
    };
  }, [review.stars, review.text, review.platform, review.reviewer]);

  async function handleSend() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reviews/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_id: review.id, reply: text }),
      });
      if (res.ok) {
        setSent(true);
        setTimeout(onClose, 1500);
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setAiError(j.error ?? "Could not save reply");
      }
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    // Rejects on insecure origins / denied permission — the unguarded call
    // left an unhandled rejection and still claimed "Copied".
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setAiError("Your browser blocked clipboard access — select the text and copy manually.");
    }
  }

  return (
    <FocusTrap active>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="reply-modal-title">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="reply-modal-title" className="text-lg font-heading font-normal text-foreground">Reply to {review.reviewer}</h2>
              <div className="flex items-center gap-2 mt-1">
                <StarRating count={review.stars} />
                <span className="text-xs text-muted-foreground">{review.platform} · {review.date}</span>
                <SentimentBadge sentiment={review.sentiment} />
              </div>
            </div>
            <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-subtle" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
            </button>
          </div>

          <div className="rounded-lg bg-bg-subtle p-3 text-sm text-muted-foreground leading-relaxed">{review.text}</div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">AI-Generated Draft</span>
            <span className="text-[10px] text-muted-foreground">
              {aiLoading ? "— drafting…" : "— edit before sending"}
            </span>
          </div>

          {sent ? (
            <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400 text-center">Reply saved as draft</div>
          ) : (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
                disabled={aiLoading}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none disabled:opacity-60" />
              {aiError && (
                <p className="text-xs text-red-400">{aiError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={handleCopy} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-bg-subtle transition-colors">
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground hover:bg-bg-subtle transition-colors">Cancel</button>
                <button onClick={handleSend} disabled={!text.trim() || saving} className="rounded-lg bg-cta px-4 py-1.5 text-sm text-cta-foreground hover:opacity-90 transition-opacity disabled:opacity-40">
                  {saving ? "Saving…" : "Send Reply"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}

/* ─── Review Request Modal ─── */
function ReviewRequestModal({ onClose }: { onClose: () => void }) {
  const { requestReview } = useReviews();
  const [method, setMethod] = useState<"sms" | "email">("sms");
  const [recipient, setRecipient] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // requestReview returns {success:false, error} on failure; the result was
  // discarded, so a failed request just re-enabled the button silently.
  const [requestError, setRequestError] = useState<string | null>(null);

  // Escape-to-close — the modal otherwise had no keyboard dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const template = method === "sms"
    ? `Hi! Thanks for choosing us for your recent project. If you were happy with our work, we'd really appreciate a quick review. It helps other homeowners find trusted contractors. Here's the link: [Review Link]`
    : `Hi,\n\nThank you for trusting us with your recent home project. We hope you're happy with the results!\n\nIf you have a moment, we'd appreciate a quick review. It helps homeowners in your area find reliable contractors.\n\n[Leave a Review]\n\nThank you for your support!`;

  async function handleSend() {
    if (!recipient.trim() || !customerName.trim()) return;
    setSending(true);
    setRequestError(null);
    const result = await requestReview({
      customer_name: customerName,
      customer_email: method === "email" ? recipient : undefined,
      customer_phone: method === "sms" ? recipient : undefined,
      channel: method,
    });
    setSending(false);
    if (result.success) {
      setSent(true);
      setTimeout(onClose, 2000);
    } else {
      setRequestError(result.error ?? "Couldn't send that request — try again.");
    }
  }

  return (
    <FocusTrap active>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="review-request-title">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
          <div className="flex items-start justify-between">
            <h2 id="review-request-title" className="text-lg font-heading font-normal text-foreground">Request a Review</h2>
            <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-subtle" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
            </button>
          </div>

          <div className="flex gap-2">
            {(["sms", "email"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  method === m ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="rev-customer-name" className="text-xs font-medium text-muted-foreground mb-1 block">Customer Name</label>
            <input id="rev-customer-name" type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="John Doe"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label htmlFor="rev-recipient" className="text-xs font-medium text-muted-foreground mb-1 block">
              {method === "sms" ? "Phone Number" : "Email Address"}
            </label>
            <input id="rev-recipient" type={method === "sms" ? "tel" : "email"} value={recipient} onChange={(e) => setRecipient(e.target.value)}
              placeholder={method === "sms" ? "(310) 555-0123" : "customer@email.com"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Message Preview</p>
            <div className="rounded-lg bg-bg-subtle p-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{template}</div>
          </div>

          {requestError && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
              {requestError}
            </p>
          )}

          {sent ? (
            <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400 text-center">Review request sent</div>
          ) : (
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm hover:bg-bg-subtle transition-colors">Cancel</button>
              <button onClick={handleSend} disabled={!recipient.trim() || !customerName.trim() || sending}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm text-cta-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Sending..." : "Send Request"}
              </button>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}

/* ─── Page ─── */
export default function ReputationPage() {
  if (!STUBS_ENABLED) {
    return (
      <ComingSoon
        feature="Reputation management"
        description="Monitor and respond to Google / Yelp reviews from one place. Review aggregation goes live once we finalise the Google Places API integration."
      />
    );
  }
  return <ReputationPageInner />;
}

function ReputationPageInner() {
  const { user, profile } = useUser();
  // `error` was previously discarded. On a failed /api/reviews call the hook
  // holds its zeroed defaults, so this page rendered "0 reviews / 0% response
  // rate / 0 pos 0 neu 0 neg" plus "No reviews yet" — an outage shown to a
  // contractor as the fact that nobody has reviewed them. Matches the explicit
  // error state on /settings/territories.
  const { reviews: rawReviews, stats, isLoading, error, refresh } = useReviews(user?.id);
  const [replyTarget, setReplyTarget] = useState<ReviewItem | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [filter, setFilter] = useState<Sentiment | "all">("all");

  /* Map API reviews to page shape */
  const reviews: ReviewItem[] = useMemo(() =>
    rawReviews.map((r) => ({
      id: r.id,
      reviewer: r.reviewer_name,
      platform: r.source === "henri" ? "Henri" : r.source.charAt(0).toUpperCase() + r.source.slice(1),
      stars: r.rating,
      date: new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      text: r.body ?? r.title ?? "",
      sentiment: (r.sentiment ?? (r.rating >= 4 ? "positive" : r.rating >= 3 ? "neutral" : "negative")) as Sentiment,
      responded: r.response_sent,
      trade: r.trade,
    })),
  [rawReviews]);

  const filteredReviews = filter === "all" ? reviews : reviews.filter((r) => r.sentiment === filter);

  const sentimentCounts = useMemo(() => ({
    positive: reviews.filter((r) => r.sentiment === "positive").length,
    neutral: reviews.filter((r) => r.sentiment === "neutral").length,
    negative: reviews.filter((r) => r.sentiment === "negative").length,
  }), [reviews]);

  const responseRate = useMemo(() => {
    const responded = reviews.filter((r) => r.responded).length;
    return reviews.length > 0 ? Math.round((responded / reviews.length) * 100) : 0;
  }, [reviews]);

  /* Monthly review trend from real data */
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = d.toLocaleDateString("en-US", { month: "short" });
      const count = reviews.filter((r) => {
        const rd = new Date(r.date);
        return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
      }).length;
      months.push({ month: monthStr, count });
    }
    return months;
  }, [reviews]);

  const companyName = profile?.company_name ?? "Your Company";
  const avgRating = stats.avg > 0 ? stats.avg.toFixed(1) : "\u2014";

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-normal text-foreground">Reputation Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor, respond, and grow your online reviews</p>
        </div>
        <button onClick={() => setRequestOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity">
          <Send className="h-3.5 w-3.5" />
          Request Review
        </button>
      </div>

      {error ? (
        /* A failed fetch must not render as "you have no reviews". Every
           number below this point is derived from `reviews`, which is empty
           after a failure — so the whole body is replaced rather than
           dressed up with zeros. */
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm"
        >
          <p className="font-semibold text-destructive">
            Couldn&apos;t load your reviews
          </p>
          <p className="mt-1 text-muted-foreground">
            This is <strong className="text-foreground">not</strong> an empty
            review history — the request failed, so we can&apos;t show your
            rating, response rate, or replies right now. {error}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground transition-opacity hover:opacity-90"
          >
            Retry
          </button>
        </div>
      ) : (
      <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Overall Rating</p>
          {isLoading ? (
            <div className="h-8 w-12 bg-bg-subtle rounded animate-pulse mt-1" />
          ) : (
            <>
              <p className="text-2xl font-heading font-normal text-primary mt-1">{avgRating}</p>
              <StarRating count={Math.round(stats.avg)} />
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Reviews</p>
          {isLoading ? (
            <div className="h-8 w-12 bg-bg-subtle rounded animate-pulse mt-1" />
          ) : (
            <>
              <p className="text-2xl font-heading font-normal text-foreground mt-1">{stats.count}</p>
              {monthlyTrend.length > 0 && monthlyTrend[monthlyTrend.length - 1].count > 0 && (
                <p className="text-xs text-green-400 mt-0.5">+{monthlyTrend[monthlyTrend.length - 1].count} this month</p>
              )}
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Response Rate</p>
          <p className="text-2xl font-heading font-normal text-foreground mt-1">{responseRate}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">Goal: 90%+</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Sentiment</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-green-400">{sentimentCounts.positive} pos</span>
            <span className="text-xs text-yellow-400">{sentimentCounts.neutral} neu</span>
            <span className="text-xs text-red-400">{sentimentCounts.negative} neg</span>
          </div>
        </Card>
      </div>

      {/* Star Distribution + Review Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Rating Distribution</h2>
          <Card className="p-5 space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats.distribution[star] ?? 0;
              const pct = stats.count > 0 ? (count / stats.count) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-3">{star}</span>
                  <Star className="h-3 w-3 fill-[#D4A24A] text-[#D4A24A]" />
                  <div className="flex-1 h-2 rounded-full bg-bg-subtle overflow-hidden">
                    <div className="h-full rounded-full bg-[#D4A24A] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Review Trend</h2>
          <Card className="p-5">
            <TrendBar data={monthlyTrend} />
            <p className="text-xs text-muted-foreground mt-3 text-center">Reviews per month (last 6 months)</p>
          </Card>
        </div>
      </div>

      {/* Competitor Benchmarking — based on real data */}
      {stats.count > 0 && (
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Your Performance</h2>
          <Card className="border-primary/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm text-foreground font-medium">{companyName}</p>
              <StarRating count={Math.round(stats.avg)} />
              <span className="text-xs text-muted-foreground">{stats.count} reviews</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-bg-subtle p-3 text-center">
                <p className="text-2xl font-heading font-normal text-primary">{avgRating}</p>
                <p className="text-[10px] text-muted-foreground">Avg Rating</p>
              </div>
              <div className="rounded-lg bg-bg-subtle p-3 text-center">
                <p className="text-2xl font-heading font-normal text-foreground">{responseRate}%</p>
                <p className="text-[10px] text-muted-foreground">Response Rate</p>
              </div>
              <div className="rounded-lg bg-bg-subtle p-3 text-center">
                <p className="text-2xl font-heading font-normal text-foreground">{sentimentCounts.positive}</p>
                <p className="text-[10px] text-muted-foreground">5-Star Reviews</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Recent Reviews with Filters */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-heading font-normal text-foreground">Recent Reviews</h2>
          <div className="flex gap-1.5">
            {(["all", "positive", "neutral", "negative"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f ? "bg-cta text-cta-foreground" : "bg-bg-subtle text-muted-foreground hover:text-foreground"
                }`}>
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="p-5 animate-pulse space-y-3">
                <div className="h-4 w-48 bg-bg-subtle rounded" />
                <div className="h-3 w-full bg-bg-subtle rounded" />
                <div className="h-3 w-2/3 bg-bg-subtle rounded" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReviews.map((review) => (
              <Card key={review.id} className="p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <StarRating count={review.stars} />
                    <span className="text-sm font-medium text-foreground">{review.reviewer}</span>
                    <SentimentBadge sentiment={review.sentiment} />
                    {review.responded && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                        <Check className="h-2.5 w-2.5" /> Responded
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-muted-foreground">{review.platform}</span>
                    <span className="text-xs text-muted-foreground">{review.date}</span>
                  </div>
                </div>
                {review.text && <p className="text-sm text-foreground leading-relaxed">{review.text}</p>}
                {!review.responded && (
                  <button onClick={() => setReplyTarget(review)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                    <Send className="h-3 w-3" /> Reply with AI Draft
                  </button>
                )}
              </Card>
            ))}
            {filteredReviews.length === 0 && !isLoading && (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {reviews.length === 0 ? "No reviews yet" : "No reviews match this filter"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {reviews.length === 0 ? "Send a review request to your recent customers to start building your reputation." : "Try a different filter."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      </>
      )}

      {/* Modals */}
      {replyTarget && <ReplyModal review={replyTarget} onClose={() => setReplyTarget(null)} />}
      {requestOpen && <ReviewRequestModal onClose={() => setRequestOpen(false)} />}
    </div>
  );
}
