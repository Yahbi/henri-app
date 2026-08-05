"use client";

/**
 * Homeowner messages tab (Phase 1.2).
 *
 * Mirror of the contractor's `/dashboard/messages` thread page. Uses
 * the same `leads.notes` line-prefix format (`[out]` = contractor,
 * `[in]` = homeowner) via `/api/homeowner/messages`.
 *
 * One thread per matched intake. Initial selection is pulled from the
 * `?thread=<lead_id>` query param (set by the "Message" CTA on the
 * post-intake project page).
 */

import { useEffect, useMemo, useRef, useState, useCallback, Suspense } from "react";
import { Send, MessageSquare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Client-side reads `?thread=<lead_id>` from searchParams so the inner
// component must live under a Suspense boundary — prevents the Next
// prerender bailout at build time.
export default function HomeownerMessagesPageWrapper() {
  return (
    <Suspense fallback={<MessagesLoading />}>
      <HomeownerMessagesPage />
    </Suspense>
  );
}

function MessagesLoading() {
  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl items-center justify-center text-sm text-muted-foreground">
      Loading messages…
    </div>
  );
}

type Thread = {
  lead_id: string;
  intake_id: string;
  contractor_id: string;
  contractor_name: string;
  trade: string;
  zip: string;
  status: string;
  created_at: string;
  notes: string | null;
};

type Message = {
  role: "contractor" | "homeowner";
  text: string;
  time: string;
};

function parseNotes(notes: string | null | undefined): Message[] {
  if (!notes) return [];
  return notes
    .split("\n")
    .filter(Boolean)
    .flatMap((line): Message[] => {
      // Format: "2026-04-21T12:00:00Z [out]: hi" — `out` = contractor, `in` = homeowner.
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^[]+)?\[(out|in)\]:\s*(.+)$/);
      if (match) {
        return [
          {
            role: match[2] === "out" ? "contractor" : "homeowner",
            text: match[3].trim(),
            time: match[1]?.trim() ?? "",
          },
        ];
      }
      return [{ role: "contractor", text: line, time: "" }];
    });
}

function formatTime(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function HomeownerMessagesPage() {
  const searchParams = useSearchParams();
  const initialThreadId = searchParams?.get("thread") ?? null;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Returns the refreshed threads so callers can verify a write landed.
  // `selectedId` is applied through the functional setter rather than a
  // dependency, so `refresh` is stable and the mount effect doesn't
  // re-fire (and re-fetch) every time a thread is selected.
  const refresh = useCallback(async (): Promise<Thread[] | null> => {
    try {
      const res = await fetch("/api/homeowner/messages");
      if (!res.ok) {
        setError("Couldn't load messages.");
        return null;
      }
      const body = (await res.json()) as { threads: Thread[] };
      const next = body.threads ?? [];
      setThreads(next);
      setSelectedId((current) => current ?? next[0]?.lead_id ?? null);
      return next;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => threads.find((t) => t.lead_id === selectedId) ?? null,
    [threads, selectedId],
  );

  const messages = useMemo(() => parseNotes(selected?.notes), [selected]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedId]);

  async function handleSend() {
    if (!draft.trim() || !selected || sending) return;
    const outgoing = draft.trim();
    const leadId = selected.lead_id;
    setSending(true);
    try {
      const res = await fetch("/api/homeowner/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, message: outgoing }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Send failed");
        return;
      }

      // Confirm the message is actually in the refetched thread before
      // clearing the draft. The send now goes through the
      // `append_homeowner_message` RPC, which raises when it writes no row
      // — so a 200 is far stronger evidence than it used to be (the old
      // direct UPDATE was filtered to zero rows by the contractor-scoped
      // RLS policy and reported as success, leaving the UI showing a
      // sent-looking message that vanished on the next refresh). The check
      // stays because this refetch happens either way, making it a free
      // end-to-end assertion: it also catches the write landing on a row
      // the homeowner cannot read back. Tell the truth when it isn't there.
      const next = await refresh();
      const landed =
        next === null ||
        (next.find((t) => t.lead_id === leadId)?.notes ?? "").includes(outgoing);

      if (!landed) {
        setError(
          "We couldn't deliver that message — it wasn't saved. Contact your contractor directly for now; we're fixing this.",
        );
        // Keep the draft so the homeowner doesn't lose what they wrote.
        return;
      }

      setDraft("");
      setError(null);
    } catch {
      setError("Send failed — retry");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl">
      <h1 className="sr-only">Messages — conversations with your contractors</h1>

      {/* Thread list */}
      <aside className="w-[280px] shrink-0 border-r border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Messages</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your matched contractors
          </p>
        </div>
        <div className="divide-y divide-border overflow-y-auto">
          {loading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse space-y-2 px-4 py-3">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
              </div>
            ))
          ) : threads.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              <MessageSquare className="mx-auto mb-2 h-6 w-6 opacity-40" />
              No conversations yet.
              <br />
              <Link
                href="/homeowner"
                className="mt-2 inline-block text-primary hover:underline"
              >
                Start a project →
              </Link>
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.lead_id}
                onClick={() => setSelectedId(t.lead_id)}
                className={`w-full px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
                  t.lead_id === selectedId ? "bg-accent/60" : ""
                }`}
              >
                <p className="truncate text-sm font-semibold text-foreground">
                  {t.contractor_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.trade} · ZIP {t.zip}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversation view */}
      <section className="flex flex-1 flex-col">
        {selected ? (
          <>
            <header className="border-b border-border bg-card px-6 py-3">
              <p className="text-sm font-semibold text-foreground">
                {selected.contractor_name}
              </p>
              <p className="text-xs text-muted-foreground">
                Re: your {selected.trade} project ·{" "}
                <Link
                  href={`/homeowner/intakes/${selected.intake_id}`}
                  className="text-primary hover:underline"
                >
                  View project →
                </Link>
              </p>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {messages.length === 0 && (
                <p className="mx-auto max-w-xs text-center text-xs text-muted-foreground">
                  No messages yet — send one below to start the conversation.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${
                    m.role === "homeowner" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "homeowner"
                        ? "bg-cta text-cta-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <p>{m.text}</p>
                    {m.time && (
                      <p
                        className={`mt-0.5 text-[10px] ${
                          m.role === "homeowner"
                            ? "text-white/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatTime(m.time)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            {error && (
              <div
                className="border-t border-destructive/40 bg-destructive/10 px-6 py-2 text-xs text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2 border-t border-border bg-card px-6 py-3"
            >
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message..."
                aria-label="Message"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                aria-label="Send message"
                className="inline-flex items-center gap-1.5 rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          </>
        ) : error ? (
          /* Load failure with no thread selected — surface the error + retry
           * here, otherwise it stays trapped in the `selected` branch above
           * and the inbox looks misleadingly empty. */
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
            role="alert"
          >
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="text-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        )}
      </section>
    </div>
  );
}
