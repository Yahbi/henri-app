import Link from "next/link";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/territories", label: "Territories" },
  { href: "/settings/capacity", label: "Capacity" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/referrals", label: "Referrals" },
  { href: "/settings/interviews", label: "Interviews" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-border bg-card">
        <div className="px-4 py-5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Settings
          </p>
          <nav className="space-y-0.5" aria-label="Settings navigation">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block px-3 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
