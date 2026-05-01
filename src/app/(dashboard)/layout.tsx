import { DashboardTopBar } from "@/components/layout/DashboardTopBar";
import { CommandPalette } from "@/components/dashboard/CommandPalette";
import { Toaster } from "@/components/toast/Toaster";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ContractorTour } from "@/components/tutorial/ContractorTour";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen max-h-screen bg-background overflow-hidden">
      <DashboardTopBar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* P0-6: per-route error boundary catches client-side component
         * crashes that slip past app/error.tsx (which only catches
         * route-render errors). A failure inside a panel — e.g., a
         * map-rendering exception or a useQuery selector throwing on
         * unexpected data — collapses to a graceful "Dashboard hit an
         * error" card instead of blanking the shell. Top-bar + command
         * palette stay alive so the user can still navigate. */}
        <ErrorBoundary tab="Dashboard">{children}</ErrorBoundary>
      </main>
      {/* Global Cmd+K command palette */}
      <CommandPalette />
      {/* Toast notifications for send/save feedback — Phase 2.5 */}
      <Toaster />
      {/* First-run guided tour for new contractors. Auto-fires once
       * after onboarding completion; users can skip any time and
       * replay from /dashboard/settings. Self-renders nothing until
       * the conditions match — see ContractorTour.tsx. */}
      <ContractorTour />
    </div>
  );
}
