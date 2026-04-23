import { DashboardTopBar } from "@/components/layout/DashboardTopBar";
import { CommandPalette } from "@/components/dashboard/CommandPalette";
import { Toaster } from "@/components/toast/Toaster";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen max-h-screen bg-background overflow-hidden">
      <DashboardTopBar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
      {/* Global Cmd+K command palette */}
      <CommandPalette />
      {/* Toast notifications for send/save feedback — Phase 2.5 */}
      <Toaster />
    </div>
  );
}
