"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";

/**
 * Footer / hero email capture. Posts to /api/newsletter, which
 * graceful-degrades across DB → JSONL → optional Resend ack.
 *
 * Source param identifies which placement the signup came from
 * ("footer", "portal-hero", etc.) so we can measure where intent
 * is concentrated.
 */
export function NewsletterSignup({
  source = "footer",
  className = "",
  placeholder = "you@email.com",
}: {
  source?: string;
  className?: string;
  placeholder?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || state === "submitting") return;
    setState("submitting");
    setErrMsg("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      const json: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("err");
        setErrMsg(json.error ?? "Could not subscribe. Try again.");
        return;
      }
      setState("ok");
      setEmail("");
    } catch (err) {
      setState("err");
      setErrMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  if (state === "ok") {
    return (
      <p className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`} role="status">
        <Check className="h-4 w-4 text-primary" aria-hidden />
        Thanks — we&apos;ll be in touch.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`flex flex-col gap-2 sm:flex-row sm:items-start ${className}`}>
      <label htmlFor={`newsletter-${source}`} className="sr-only">
        Email address
      </label>
      <input
        id={`newsletter-${source}`}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={placeholder}
        disabled={state === "submitting"}
        aria-invalid={state === "err"}
        aria-describedby={state === "err" ? `newsletter-err-${source}` : undefined}
        className="h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={state === "submitting" || !email.trim()}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-cta px-4 text-sm font-medium text-cta-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
      >
        {state === "submitting" ? "Sending…" : "Notify me"}
        {state !== "submitting" && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
      </button>
      {state === "err" && errMsg && (
        <p id={`newsletter-err-${source}`} role="alert" className="text-xs text-destructive sm:basis-full">
          {errMsg}
        </p>
      )}
    </form>
  );
}
