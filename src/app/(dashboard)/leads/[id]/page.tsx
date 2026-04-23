"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  FileText,
  CheckCircle2,
  XCircle,
  StickyNote,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadScoreBadge } from "@/components/leads/LeadScoreBadge";
import { TopBar } from "@/components/layout/TopBar";

const MapDashboard = dynamic(() => import("@/components/map/MapDashboard"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-muted animate-pulse rounded-lg" />,
});

interface LeadDetail {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  permit_type: string;
  permit_status: string;
  value: number;
  date: string;
  expiry_date: string | null;
  description: string;
  score: number;
  urgency: "hot" | "warm" | "cold";
  score_reasoning: string;
  lat: number;
  lng: number;
  notes: { id: string; text: string; created_at: string }[];
}

async function fetchLead(id: string): Promise<LeadDetail> {
  const res = await fetch(`/api/leads/${id}`);
  if (!res.ok) throw new Error("Failed to fetch lead");
  const data = await res.json();
  return data.lead;
}

function DetailSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-14 w-14 rounded-full mx-auto" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: lead, isLoading, isError, error } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetchLead(id),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Lead Details" />
        <DetailSkeleton />
      </div>
    );
  }

  if (isError || !lead) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Lead Details" />
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md w-full">
            <CardContent className="p-6 text-center space-y-4">
              <XCircle className="h-10 w-10 text-destructive mx-auto" />
              <h3 className="text-lg font-semibold text-foreground">
                Failed to load lead
              </h3>
              <p className="text-sm text-muted-foreground">
                {(error as Error)?.message ?? "An unknown error occurred."}
              </p>
              <Button variant="outline" onClick={() => router.back()}>
                Go Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Lead Details" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Back link */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Leads
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: permit details + score */}
          <div className="lg:col-span-2 space-y-6">
            {/* Permit details */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-xl">{lead.address}</CardTitle>
                    <CardDescription>
                      {lead.city}, {lead.state} {lead.zip}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      lead.urgency === "hot"
                        ? "hot"
                        : lead.urgency === "warm"
                        ? "warm"
                        : "cold"
                    }
                    className="text-sm"
                  >
                    {lead.urgency}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <FileText className="h-3 w-3" />
                      Permit Type
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {lead.permit_type}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Status
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {lead.permit_status}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <DollarSign className="h-3 w-3" />
                      Value
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {lead.value
                        ? `$${lead.value.toLocaleString()}`
                        : "N/A"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <Calendar className="h-3 w-3" />
                      Filed Date
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {new Date(lead.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {lead.description && (
                  <div className="mt-4 rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      Description
                    </p>
                    <p className="text-sm text-foreground">
                      {lead.description}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Score breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="flex items-start gap-6">
                <LeadScoreBadge
                  score={lead.score}
                  urgency={lead.urgency}
                  size="lg"
                />
                <div className="flex-1">
                  <p className="text-sm text-foreground leading-relaxed">
                    {lead.score_reasoning ||
                      "Score is based on permit value, recency, and territory demand."}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Notes section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {lead.notes && lead.notes.length > 0 ? (
                  <div className="space-y-3">
                    {lead.notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg border border-border p-3"
                      >
                        <p className="text-sm text-foreground">{note.text}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(note.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No notes yet. Add a note to track your interactions.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column: map + actions */}
          <div className="space-y-6">
            {/* Mini map */}
            <Card className="overflow-hidden">
              <div className="h-64">
                <MapDashboard
                  initialCenter={[lead.lng || -98.5795, lead.lat || 39.8283]}
                  initialZoom={lead.lat ? 14 : 4}
                />
              </div>
            </Card>

            {/* Action buttons */}
            <div className="space-y-2">
              <Button variant="primary" className="w-full">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Won
              </Button>
              <Button variant="outline" className="w-full">
                <XCircle className="h-4 w-4 mr-2" />
                Mark Lost
              </Button>
              <Button variant="ghost" className="w-full">
                <StickyNote className="h-4 w-4 mr-2" />
                Add Note
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
