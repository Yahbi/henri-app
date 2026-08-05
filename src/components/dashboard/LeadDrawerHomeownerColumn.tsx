"use client";

import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  Home,
  User,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ProvenanceChip } from "./LeadDetailDrawer.helpers";
import type { LeadData } from "./LeadCard";
import { sanitizePropertyValue } from "@/lib/permits/value-sanity";

/**
 * LeadDrawerHomeownerColumn — the rightmost column of the LeadDetailDrawer:
 * homeowner identity + property details + contractor/business block +
 * permit status + Call/Email action buttons.
 *
 * Audit-04-29 priority D step 2: extracted from `LeadDetailDrawer.tsx`
 * (~290 LOC pulled out of the 1,055-LOC giant). Pure presentational —
 * the parent owns enrichment fetching; this component only renders.
 *
 * `enrichment` is the shape returned by `useEnrichment`; we accept a
 * narrowed structural type rather than importing the full hook return so
 * this component stays decoupled from the hook's type evolution.
 */

interface PropertyEnrichment {
  owner_name?: string | null;
  co_owner?: string | null;
  mailing_address?: string | null;
  owner_occupied?: boolean | null;
  owner_since?: string | null;
  assessed_value?: number | string | null;
  property_value?: number | string | null;
  year_built?: number | string | null;
  home_sqft?: number | string | null;
  lot_sqft?: number | string | null;
  source?: string | null;
}

interface LeadDrawerHomeownerColumnProps {
  lead: LeadData;
  enrichment: PropertyEnrichment | null | undefined;
  enrichLoading: boolean;
  /** Permit status resolved by the drawer (`lead.permitStatus` falling back
   *  to the on-demand `usePermitDetail` row, which is what god-mode pulls
   *  rely on because they skip the permits embed). Undefined = unknown. */
  permitStatus?: string | null;
}

/** Map a `permit_status` enum value (migration 00004: submitted / approved /
 *  issued / final / expired / revoked) to a truthful label + dot colour.
 *  Returns null when the status is unknown so the caller can say so rather
 *  than asserting a state the data doesn't support. */
function describePermitStatus(
  status: string | null | undefined,
): { label: string; dot: string } | null {
  if (!status) return null;
  switch (status.toLowerCase()) {
    case "submitted":
      return { label: "Submitted", dot: "bg-warning" };
    case "approved":
      return { label: "Approved", dot: "bg-success" };
    case "issued":
      return { label: "Issued / Active", dot: "bg-success" };
    case "final":
      return { label: "Final / Closed", dot: "bg-muted-foreground" };
    case "expired":
      return { label: "Expired", dot: "bg-destructive" };
    case "revoked":
      return { label: "Revoked", dot: "bg-destructive" };
    default:
      // Unknown jurisdiction string — show it verbatim rather than
      // laundering it into a green "Active".
      return { label: status, dot: "bg-muted-foreground" };
  }
}

export function LeadDrawerHomeownerColumn({
  lead,
  enrichment,
  enrichLoading,
  permitStatus,
}: LeadDrawerHomeownerColumnProps) {
  // Sanity-clamp enrichment property values before display — a bad county-GIS
  // join can attach an 8–9 figure "assessed value" to a home. Implausible
  // values collapse to null so the row simply hides rather than showing $380M.
  const assessedValueNum = sanitizePropertyValue(
    enrichment?.assessed_value != null ? Number(enrichment.assessed_value) : null,
  );
  const propertyValueNum = sanitizePropertyValue(
    enrichment?.property_value != null ? Number(enrichment.property_value) : null,
  );
  return (
    <div className="shrink-0 w-full sm:w-[220px] flex flex-col justify-between border-t pt-3 sm:border-t-0 sm:pt-0 sm:border-l border-border sm:pl-4 overflow-y-auto scrollbar-thin">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Homeowner
          </h3>
          {enrichLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Owner name — prefer explicit first+last split when both are
         * present; fall back to the enriched full name, then lead.owner.
         * Provenance chip shows the orchestrator's `contact_source`. */}
        {(() => {
          const first = (lead.firstName ?? "").trim();
          const last = (lead.lastName ?? "").trim();
          const hasSplit = first.length > 0 || last.length > 0;
          const displayName = hasSplit
            ? [first, last].filter(Boolean).join(" ")
            : (enrichment?.owner_name ??
                (lead.owner && lead.owner !== "Unknown" ? lead.owner : null));
          if (!displayName) {
            return (
              <p className="text-xs text-fg-subtle italic">Owner info pending</p>
            );
          }
          return (
            <>
              <div className="flex items-center gap-1.5">
                <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{displayName}</p>
              </div>
              {hasSplit && (
                <div className="flex flex-col gap-0 pl-[18px]">
                  {first && (
                    <span className="text-[10px] text-muted-foreground">
                      First: <span className="text-foreground">{first}</span>
                    </span>
                  )}
                  {last && (
                    <span className="text-[10px] text-muted-foreground">
                      Last: <span className="text-foreground">{last}</span>
                    </span>
                  )}
                </div>
              )}
              <ProvenanceChip source={lead.contactSource} />
            </>
          );
        })()}

        {/* Co-owner */}
        {(lead.coOwner || enrichment?.co_owner) && (
          <p className="text-[11px] text-muted-foreground pl-[18px]">
            Co-owner: {enrichment?.co_owner ?? lead.coOwner}
          </p>
        )}

        {/* Phone — provenance chip shares the lead's primary contactSource
         * because per-field source attribution isn't plumbed through the
         * API yet. */}
        {lead.phone && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              <span>{lead.phone}</span>
            </div>
            <ProvenanceChip source={lead.contactSource} />
          </>
        )}

        {/* Email */}
        {lead.email && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{lead.email}</span>
            </div>
            <ProvenanceChip source={lead.contactSource} />
          </>
        )}

        {/* Mailing address */}
        {(lead.mailing || enrichment?.mailing_address) && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="line-clamp-2">
              {enrichment?.mailing_address ?? lead.mailing}
            </span>
          </div>
        )}

        {/* Owner occupied badge */}
        {enrichment?.owner_occupied != null && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <Home className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span
              className={
                enrichment.owner_occupied
                  ? "text-green-600 font-medium"
                  : "text-muted-foreground"
              }
            >
              {enrichment.owner_occupied ? "Owner occupied" : "Non-owner occupied"}
            </span>
          </div>
        )}

        {/* Owner since */}
        {enrichment?.owner_since && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            <span>Owner since {enrichment.owner_since}</span>
          </div>
        )}

        {/* Property Details — always visible when data exists. */}
        {(enrichment || lead.propertyValue || lead.yearBuilt) && (
          <div className="mt-2.5 pt-2 border-t border-border space-y-1">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Property Details
            </h3>

            {(assessedValueNum != null || lead.assessedValue) && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Assessed</span>
                <span className="text-foreground font-medium">
                  {assessedValueNum != null
                    ? `$${assessedValueNum.toLocaleString()}`
                    : lead.assessedValue}
                </span>
              </div>
            )}

            {(propertyValueNum != null || lead.propertyValue) && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Est. Value</span>
                <span className="text-foreground font-medium">
                  {propertyValueNum != null
                    ? `$${propertyValueNum.toLocaleString()}`
                    : lead.propertyValue}
                </span>
              </div>
            )}

            {(enrichment?.year_built ?? lead.yearBuilt) && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Year Built</span>
                <span className="text-foreground">
                  {enrichment?.year_built ?? lead.yearBuilt}
                </span>
              </div>
            )}

            {(enrichment?.home_sqft ?? lead.homeSqft) && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Home Sqft</span>
                <span className="text-foreground">
                  {Number(
                    enrichment?.home_sqft ?? lead.homeSqft,
                  ).toLocaleString()}
                </span>
              </div>
            )}

            {(enrichment?.lot_sqft ?? lead.lotSqft) && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Lot Sqft</span>
                <span className="text-foreground">
                  {Number(
                    enrichment?.lot_sqft ?? lead.lotSqft,
                  ).toLocaleString()}
                </span>
              </div>
            )}

            {enrichment?.source && enrichment.source !== "none" && (
              <p className="text-[9px] text-muted-foreground mt-1 italic">
                via {enrichment.source.replace(/_/g, " ")}
              </p>
            )}
          </div>
        )}

        {/* ── Contractor / Business section (migration 00044) ──
         * Renders when ANY of the orchestrator's business-side enrichment
         * fields are populated. Distinct from the Homeowner block above. */}
        {(lead.businessPhone ||
          lead.licenseNumber ||
          lead.businessWebsite ||
          lead.businessStatus ||
          lead.naicsCode ||
          lead.employer ||
          lead.occupation) && (
          <div className="mt-2.5 pt-2 border-t border-border space-y-1">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Contractor / Business
            </h3>

            {lead.businessPhone && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0" />
                <span className="text-foreground">{lead.businessPhone}</span>
                <span className="text-[10px]">(business)</span>
              </div>
            )}

            {lead.businessWebsite && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3 shrink-0" />
                <a
                  /* Enrichment sources often store a scheme-less host
                   * ("acme.com"). Without this, the browser resolves it
                   * relative to the current path and the link navigates to
                   * /dashboard/acme.com — a route that doesn't exist. */
                  href={
                    /^https?:\/\//i.test(lead.businessWebsite)
                      ? lead.businessWebsite
                      : `https://${lead.businessWebsite}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {lead.businessWebsite
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "")}
                </a>
              </div>
            )}

            {lead.licenseNumber && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">License #</span>
                <span className="text-foreground font-mono text-[10px]">
                  {lead.licenseNumber}
                  {lead.licenseStatus && (
                    <span
                      className={cn(
                        "ml-1.5 px-1 py-0.5 rounded text-[9px] font-semibold",
                        /active/i.test(lead.licenseStatus)
                          ? "bg-success/10 text-success"
                          : "bg-warning/10 text-warning",
                      )}
                    >
                      {lead.licenseStatus}
                    </span>
                  )}
                </span>
              </div>
            )}

            {lead.businessStatus && lead.businessStatus !== "OPERATIONAL" && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Business status</span>
                <span className="text-warning font-medium">
                  {lead.businessStatus.replace(/_/g, " ").toLowerCase()}
                </span>
              </div>
            )}

            {lead.naicsCode && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">NAICS</span>
                <span className="text-foreground font-mono text-[10px]">
                  {lead.naicsCode}
                </span>
              </div>
            )}

            {lead.employer && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Employer</span>
                <span
                  className="text-foreground truncate max-w-[120px]"
                  title={lead.employer}
                >
                  {lead.employer}
                </span>
              </div>
            )}

            {lead.occupation && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Occupation</span>
                <span
                  className="text-foreground truncate max-w-[120px]"
                  title={lead.occupation}
                >
                  {lead.occupation}
                </span>
              </div>
            )}

            {lead.contactSource && (
              <p className="text-[9px] text-muted-foreground mt-1 italic">
                via {lead.contactSource.replace(/_/g, " ")}
                {typeof lead.contactConfidence === "number" &&
                  ` (${Math.round(lead.contactConfidence * 100)}% conf)`}
              </p>
            )}
          </div>
        )}

        {/* Permit status badge. Reads the real `permit_status` value —
            this block used to hardcode a green "Active / Filed" for every
            lead with a permit, so finaled / expired / revoked permits were
            presented as live work and contradicted the timeline panel in
            the same drawer. */}
        {lead.permitNumber && (() => {
          const resolved = describePermitStatus(permitStatus ?? lead.permitStatus);
          return (
            <div className="mt-2.5 pt-2 border-t border-border">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Permit Status
              </h3>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${resolved?.dot ?? "bg-muted-foreground"}`}
                  aria-hidden="true"
                />
                <span className="text-[11px] text-foreground font-medium capitalize">
                  {resolved?.label ?? "Status unknown"}
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-3 shrink-0">
        {lead.phone ? (
          <a
            href={`tel:${lead.phone.replace(/\D/g, "")}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cta text-cta-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Phone className="h-3 w-3" />
            Call
          </a>
        ) : enrichment?.mailing_address ? (
          <span className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold cursor-default">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              Mail
            </span>
            <span className="text-[9px] font-normal">No phone — mail only</span>
          </span>
        ) : (
          /* Inert lookalike — say why, instead of showing a greyed control
           * with no explanation (the reason used to live in a `title`,
           * unreachable by keyboard and touch). */
          <span className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-default">
            <span className="flex items-center gap-1.5">
              <Phone className="h-3 w-3" aria-hidden="true" />
              Call
            </span>
            <span className="text-[9px] font-normal">No phone on file</span>
          </span>
        )}
        {lead.email ? (
          <a
            href={`mailto:${lead.email}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-foreground text-xs font-semibold hover:bg-accent transition-colors"
          >
            <Mail className="h-3 w-3" />
            Email
          </a>
        ) : (
          <span className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-border text-muted-foreground text-xs font-semibold cursor-default">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3 w-3" aria-hidden="true" />
              Email
            </span>
            <span className="text-[9px] font-normal">No email on file</span>
          </span>
        )}
      </div>
    </div>
  );
}
