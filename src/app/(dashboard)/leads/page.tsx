"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Search,
  LayoutGrid,
  List,
  MapPin,
  Calendar,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadScoreBadge } from "@/components/leads/LeadScoreBadge";
import { TopBar } from "@/components/layout/TopBar";

interface Lead {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  permit_type: string;
  value: number;
  date: string;
  score: number;
  urgency: "hot" | "warm" | "cold";
  status: string;
}

async function fetchLeads(params: {
  urgency?: string;
  trade?: string;
  zip?: string;
  page?: number;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params.urgency) searchParams.set("urgency", params.urgency);
  if (params.trade) searchParams.set("trade", params.trade);
  if (params.zip) searchParams.set("zip", params.zip);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const res = await fetch(`/api/leads?${searchParams.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json() as Promise<{ leads: Lead[]; total: number }>;
}

function LeadListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-9 w-full mt-2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-6">
        <Search className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No leads yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Leads will appear once permits are detected and scored in your
        territories. Claim territories to start receiving leads.
      </p>
      <Button variant="primary" size="md" className="mt-6" asChild>
        <Link href="/territories">Claim a Territory</Link>
      </Button>
    </div>
  );
}

export default function LeadsPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [urgency, setUrgency] = useState("");
  const [trade, setTrade] = useState("");
  const [zipSearch, setZipSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["leads", { urgency, trade, zip: zipSearch }],
    queryFn: () => fetchLeads({ urgency, trade, zip: zipSearch }),
  });

  const leads = data?.leads ?? [];

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Leads" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            className="w-36"
          >
            <option value="">All Urgency</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </Select>

          <Select
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            className="w-40"
          >
            <option value="">All Trades</option>
            <option value="general">General</option>
            <option value="roofing">Roofing</option>
            <option value="plumbing">Plumbing</option>
            <option value="electrical">Electrical</option>
            <option value="hvac">HVAC</option>
            <option value="solar">Solar</option>
          </Select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search ZIP..."
              value={zipSearch}
              onChange={(e) => setZipSearch(e.target.value)}
              className="pl-9 w-36"
            />
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-lg border border-input p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                viewMode === "grid"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                viewMode === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <LeadListSkeleton />
        ) : leads.length === 0 ? (
          <EmptyState />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {leads.map((lead) => (
              <Card key={lead.id} hover>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <LeadScoreBadge
                      score={lead.score}
                      urgency={lead.urgency}
                      size="md"
                    />
                    <Badge
                      variant={
                        lead.urgency === "hot"
                          ? "hot"
                          : lead.urgency === "warm"
                          ? "warm"
                          : "cold"
                      }
                    >
                      {lead.urgency}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground leading-tight">
                      {lead.address}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {lead.city}, {lead.state} {lead.zip}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {lead.value
                        ? `$${lead.value.toLocaleString()}`
                        : "N/A"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(lead.date).toLocaleDateString()}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {lead.permit_type}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    asChild
                  >
                    <Link href={`/leads/${lead.id}`}>View Details</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((lead) => (
              <Card key={lead.id}>
                <CardContent className="p-4 flex items-center gap-4">
                  <LeadScoreBadge
                    score={lead.score}
                    urgency={lead.urgency}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {lead.address}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lead.city}, {lead.state} {lead.zip} -{" "}
                      {lead.permit_type}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {lead.value
                        ? `$${lead.value.toLocaleString()}`
                        : "N/A"}
                    </span>
                    <span>
                      {new Date(lead.date).toLocaleDateString()}
                    </span>
                  </div>
                  <Badge
                    variant={
                      lead.urgency === "hot"
                        ? "hot"
                        : lead.urgency === "warm"
                        ? "warm"
                        : "cold"
                    }
                  >
                    {lead.urgency}
                  </Badge>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/leads/${lead.id}`}>View</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
