import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/SettingsNav";

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
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* Sidebar — desktop only; mobile gets the pill row below. */}
      <aside className="hidden md:block w-48 shrink-0 border-r border-border bg-card">
        <div className="px-4 py-5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Settings
          </p>
          <SettingsNav items={NAV_ITEMS} variant="sidebar" />
        </div>
      </aside>

      {/* Mobile section nav — horizontal scrollable pill row above the
       * content, replacing the sidebar below md. */}
      <SettingsNav items={NAV_ITEMS} variant="pills" />

      {/* Content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
