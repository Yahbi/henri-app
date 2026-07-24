"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MessageSquare, Clock, CheckCircle, User, Plus, Home, Wrench, Search, DollarSign, ChevronRight } from "lucide-react";
import { CostEstimator } from "@/components/homeowner/CostEstimator";
import { MaintenanceCalendar } from "@/components/homeowner/MaintenanceCalendar";
import { PropertyTracker } from "@/components/homeowner/PropertyTracker";
import { ContractorList } from "@/components/homeowner/ContractorCard";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

// Code-split the intake modal (~1,430 LOC). Gated on `chatOpen` in the JSX
// below so its chunk isn't fetched until the homeowner opens it.
const ChatIntakeModal = dynamic(
  () =>
    import("@/components/portal/ChatIntakeModal").then((m) => m.ChatIntakeModal),
  { ssr: false },
);

/* ─── Types ─── */
interface Intake {
  id: string;
  trade: string;
  status: string;
  henri_score: number | null;
  created_at: string;
  matched_contractor_id: string | null;
}

type Tab = "projects" | "contractors" | "home" | "estimate";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending:     { label: "Finding your contractor", color: "text-[#D4A24A] bg-[rgba(212,162,74,0.1)]", icon: Clock },
  matched:     { label: "Contractor matched", color: "text-[#3D9970] bg-[rgba(61,153,112,0.1)]", icon: CheckCircle },
  in_progress: { label: "Project in progress", color: "text-primary bg-primary-10", icon: MessageSquare },
  completed:   { label: "Completed", color: "text-[#3D9970] bg-[rgba(61,153,112,0.1)]", icon: CheckCircle },
};

const tabs: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: "projects", label: "My Projects", icon: Wrench },
  { key: "contractors", label: "Find Contractors", icon: Search },
  { key: "home", label: "My Home", icon: Home },
  { key: "estimate", label: "Cost Estimator", icon: DollarSign },
];

/* ─── Page ─── */
export default function HomeownerDashboard() {
  const { user, profile } = useUser();
  const [chatOpen, setChatOpen] = useState(false);
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("projects");

  useEffect(() => {
    if (!user) return;
    const fetchIntakes = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("homeowner_intakes")
        .select("id, trade, status, henri_score, created_at, matched_contractor_id")
        .eq("contact_email", user.email)
        .order("created_at", { ascending: false });
      setIntakes(data ?? []);
      setLoading(false);
    };
    fetchIntakes();
  }, [user]);

  const firstName = profile?.full_name?.split(" ")[0] ?? null;
  const greeting = firstName ? `Welcome, ${firstName}` : "Welcome back";
  const userZip = (profile as Record<string, string> | null)?.zip ?? "";

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Welcome header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-normal tracking-tight text-foreground">
              {greeting}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your home projects and find verified contractors
            </p>
          </div>
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle mb-6 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors shrink-0 ${
                activeTab === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ─── My Projects Tab ─── */}
        {activeTab === "projects" && (
          <div>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              My Projects
            </h2>

            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
                ))}
              </div>
            ) : intakes.length > 0 ? (
              <div className="space-y-3">
                {intakes.map((intake) => {
                  const config = STATUS_CONFIG[intake.status] ?? STATUS_CONFIG.pending;
                  const Icon = config.icon;
                  const date = new Date(intake.created_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  });
                  return (
                    <Link
                      key={intake.id}
                      href={`/homeowner/intakes/${intake.id}`}
                      className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-10">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {intake.trade} Project
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Submitted {date}
                          {intake.henri_score && ` · Score: ${intake.henri_score}/100`}
                        </p>
                      </div>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", config.color)}>
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
                <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium text-foreground">No projects yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tell Henri about a project and we&apos;ll match you with a verified local contractor.
                </p>
                {/* 3-step ladder — Phase 1.5 gives the homeowner a clear
                    next-step expectation before they even open the chat */}
                <ol className="mx-auto mt-5 grid max-w-lg grid-cols-1 gap-3 text-left sm:grid-cols-3">
                  {[
                    { n: 1, t: "Chat about your project" },
                    { n: 2, t: "We score it in seconds" },
                    { n: 3, t: "Contractor calls you" },
                  ].map((s) => (
                    <li
                      key={s.n}
                      className="flex items-start gap-2 rounded-lg bg-bg-subtle p-3 text-xs"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                        {s.n}
                      </span>
                      <span className="text-muted-foreground">{s.t}</span>
                    </li>
                  ))}
                </ol>
                <button
                  onClick={() => setChatOpen(true)}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Start your first project
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Find Contractors Tab ─── */}
        {activeTab === "contractors" && <ContractorList zip={userZip} />}

        {/* ─── My Home Tab ─── */}
        {activeTab === "home" && (
          <div className="space-y-6">
            <PropertyTracker zip={userZip} />
            <MaintenanceCalendar />
          </div>
        )}

        {/* ─── Cost Estimator Tab ─── */}
        {activeTab === "estimate" && <CostEstimator initialZip={userZip} />}

        {/* Role-switch "I'm also a contractor" CTA moved to the top nav
            (src/app/(homeowner)/layout.tsx) as part of Phase 1.4 — it was
            previously buried here at the bottom of the page and new
            homeowners never saw it. */}
      </div>

      {/* Chat modal */}
      {chatOpen && (
        <ChatIntakeModal
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          initialZip={userZip}
        />
      )}
    </>
  );
}

