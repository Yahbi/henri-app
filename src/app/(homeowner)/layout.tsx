"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, MessageSquare, Home, UserPlus, MessageCircle } from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { useUser } from "@/hooks/useUser";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";

const NAV_LINKS = [
  { href: "/homeowner", label: "Dashboard", icon: Home },
  { href: "/homeowner/messages", label: "Messages", icon: MessageSquare },
] as const;

export default function HomeownerLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useUser();
  const pathname = usePathname();
  const [upgrading, setUpgrading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // A failed upgrade previously just reset the button — the user clicked
  // "I'm also a contractor", nothing happened, and nothing said why.
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  async function handleUpgrade() {
    if (upgrading) return;
    setUpgrading(true);
    setUpgradeError(null);
    try {
      const res = await fetch("/api/profile/upgrade-to-contractor", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        redirect?: string;
        error?: string;
      };
      if (res.ok && body.ok) {
        window.location.href = body.redirect ?? "/onboarding/license";
        return;
      }
      setUpgrading(false);
      setUpgradeError(
        body.error ?? `Couldn't switch your account to contractor (HTTP ${res.status}).`,
      );
    } catch {
      setUpgrading(false);
      setUpgradeError("Couldn't reach the server. Check your connection and retry.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <nav
        className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md"
        aria-label="Primary"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/homeowner"
              className="font-heading text-xl font-medium text-primary"
              aria-label="Henri. home"
            >
              Henri.
            </Link>
            <div className="hidden items-center gap-1 md:flex">
              {NAV_LINKS.map((link) => {
                const active =
                  link.href === "/homeowner"
                    ? pathname === "/homeowner"
                    : pathname?.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {profile?.full_name && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {profile.full_name}
              </span>
            )}
            <button
              onClick={handleUpgrade}
              disabled={upgrading}
              aria-label="Upgrade to a contractor account"
              aria-busy={upgrading || undefined}
              className="hidden items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60 sm:flex"
              title="Upgrade to a contractor account"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {upgrading ? "Switching…" : "I'm also a contractor"}
            </button>
            <ThemeSwitcher />
            <button
              onClick={() => setFeedbackOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
              aria-label="Send feedback"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Feedback</span>
            </button>
            <button
              onClick={signOut}
              aria-label="Sign out of your account"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        {/* Mobile secondary nav — shows tabs below the main bar on small viewports */}
        <div className="flex items-center gap-1 border-t border-border/60 px-4 py-1 md:hidden">
          {NAV_LINKS.map((link) => {
            const active =
              link.href === "/homeowner"
                ? pathname === "/homeowner"
                : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {upgradeError && (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/5 px-6 py-2 text-center text-xs text-destructive"
        >
          {upgradeError}
        </div>
      )}

      <main id="main-content" className="flex-1" tabIndex={-1}>{children}</main>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
