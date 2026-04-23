"use client";

import { cn } from "@/lib/utils/cn";
import { ExclusivityBadge } from "./ExclusivityBadge";
import type { ExclusivityLockSummary } from "@/lib/exclusivity/locks";

export interface LeadData {
  id: string;
  addr: string;
  zip: string;
  fullAddress: string;
  score: number;
  owner: string;
  firstName: string;
  lastName: string;
  coOwner?: string;
  phone: string;
  phone2?: string;
  email: string;
  email2?: string;
  mailing?: string;
  type: string;
  value: string;
  propertyValue?: string;
  assessedValue?: string;
  yearBuilt?: number;
  lotSqft?: string;
  homeSqft?: string;
  ownerSince?: string;
  ownerOccupied?: boolean;
  permitDescription?: string;
  permitNumber?: string;
  /** Supabase UUID of the backing `permits` row — used by the project
   *  stage timeline to fetch `permit_events`. Separate from
   *  `permitNumber` which is the jurisdiction-issued string. */
  permitUuid?: string;
  filedDate?: string;
  /** Phase 0b timeline: lifecycle dates read off the permits join. */
  appliedDate?: string;
  issuedDate?: string;
  completedDate?: string;
  permitStatus?: string;
  permitHistory?: string[];
  cascade?: boolean;
  cascadeCount?: number;
  permitAge?: number;
  freshScore?: number;
  valueScore?: number;
  contactScore?: number;
  demandScore?: number;
  engagementScore?: number;
  conversionScore?: number;
  /** Phase 0a transparency: typed signal breakdown written by the scorer
   *  into `leads.score_signals`. The drawer renders this when present;
   *  falls back to the 4 legacy numeric fields when null. */
  scoreSignals?: unknown;
  status?: string;
  trade?: string;
  isHomeowner?: boolean;
  lat?: number | null;
  lng?: number | null;
  cityState?: string;
  rawValue?: number;
}

function scoreColor(score: number) {
  if (score >= 75) return "text-hot bg-[rgba(212,136,106,0.10)]";
  if (score >= 50) return "text-warm bg-[rgba(212,162,74,0.10)]";
  return "text-cool bg-[rgba(74,127,192,0.10)]";
}

const TRADE_COLORS: Record<string, { bg: string; text: string }> = {
  roofing:          { bg: "rgba(212,136,106,0.15)", text: "#B5674D" },
  hvac:             { bg: "rgba(74,127,192,0.12)",  text: "#3B6FA0" },
  plumbing:         { bg: "rgba(74,127,192,0.12)",  text: "#3B6FA0" },
  electrical:       { bg: "rgba(212,180,74,0.15)",  text: "#9A7E1E" },
  solar:            { bg: "rgba(74,168,100,0.12)",  text: "#357A48" },
  adu:              { bg: "rgba(140,100,192,0.12)", text: "#6E4BA0" },
  "general remodel":{ bg: "rgba(140,140,140,0.10)", text: "#6B6B6B" },
};

function tradeBadgeStyle(trade?: string): { bg: string; text: string } {
  if (!trade) return { bg: "rgba(140,140,140,0.10)", text: "#8B8B8B" };
  const key = trade.toLowerCase().trim();
  return TRADE_COLORS[key] ?? { bg: "rgba(140,140,140,0.10)", text: "#8B8B8B" };
}

function urgencyDot(permitAge?: number): "red" | "yellow" | null {
  if (permitAge == null || permitAge < 0) return null;
  if (permitAge <= 3) return "red";
  if (permitAge <= 10) return "yellow";
  return null;
}

interface LeadCardProps {
  lead: LeadData;
  active?: boolean;
  onClick?: () => void;
  /** Phase 0a: exclusivity lock summary for this lead, if any. Falsy
   *  when migration 00031 isn't live, when the caller doesn't hold
   *  an active lock, or when the endpoint failed — badge simply
   *  doesn't render in any of those cases. */
  exclusivity?: ExclusivityLockSummary | null;
}

export function LeadCard({ lead, active, onClick, exclusivity }: LeadCardProps) {
  const score = lead.score;
  const badge = tradeBadgeStyle(lead.trade);
  const dot = urgencyDot(lead.permitAge);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-l-3 transition-colors",
        active
          ? "border-l-primary bg-primary-04"
          : "border-l-transparent hover:bg-bg-subtle"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {lead.addr}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <ExclusivityBadge summary={exclusivity} size="xs" />
            {lead.cascade && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary-08 px-1.5 py-0.5 rounded">
                <span className="text-xs">&#9670;</span> Cascade
              </span>
            )}
            {lead.trade && (
              <span
                className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-tight"
                style={{ backgroundColor: badge.bg, color: badge.text }}
              >
                {lead.trade}
              </span>
            )}
            <span className="text-[12px] text-muted-foreground truncate">
              {lead.type}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {lead.cityState || lead.zip?.split(" \u00B7 ")[0]}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {lead.value}
            </span>
          </div>
          {lead.permitDescription && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate leading-tight">
              {lead.permitDescription}
            </p>
          )}
          <p className="text-[11px] text-fg-subtle mt-1 inline-flex items-center gap-1.5">
            {dot && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: dot === "red" ? "#DC4A3D" : "#D4A24A",
                }}
              />
            )}
            {lead.permitAge != null && lead.permitAge >= 0
              ? `Permit ${lead.permitAge} days ago`
              : "Recent permit"}
          </p>
        </div>
        <div
          className={cn(
            "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold",
            scoreColor(score)
          )}
        >
          {score}
        </div>
      </div>
    </button>
  );
}
