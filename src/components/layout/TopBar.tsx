"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Settings, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

interface TopBarProps {
  title?: string;
}

export function TopBar({ title = "Dashboard" }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      // Hard-navigate to /login so any in-memory auth state is dropped.
      router.push("/login");
      router.refresh();
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="h-16 border-b border-border bg-card px-6 flex items-center justify-between shrink-0">
      {/* Left: Page title */}
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {/* Theme switcher (compact) */}
        <div className="hidden sm:block">
          <ThemeSwitcher />
        </div>

        {/* Notification bell */}
        <button
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Notifications (3 unread)"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          <Badge
            variant="destructive"
            className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
            aria-hidden="true"
          >
            3
          </Badge>
        </button>

        {/* User avatar dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div
              className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary"
              aria-hidden="true"
            >
              U
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>

          {dropdownOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-card shadow-lg py-1 z-50"
              role="menu"
            >
              <a
                href="/settings/billing"
                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                role="menuitem"
              >
                <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Settings
              </a>
              <a
                href="/settings/billing"
                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                role="menuitem"
              >
                <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Profile
              </a>
              <hr className="my-1 border-border" />
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors disabled:opacity-50"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-busy={signingOut || undefined}
                role="menuitem"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {signingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
