"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { MapPin, Plus, Trash2, Calendar, Hash } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog } from "@/components/ui/dialog";
import { TopBar } from "@/components/layout/TopBar";

interface Territory {
  id: string;
  zip: string;
  city: string;
  state: string;
  slot_number: number;
  status: "active" | "pending" | "waitlisted";
  created_at: string;
}

async function fetchTerritories(): Promise<{
  territories: Territory[];
}> {
  const res = await fetch("/api/territories");
  if (!res.ok) throw new Error("Failed to fetch territories");
  return res.json();
}

async function releaseTerritory(zip: string): Promise<void> {
  const res = await fetch(`/api/territories/${zip}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to release territory");
  }
}

export default function TerritoriesPage() {
  const queryClient = useQueryClient();
  const [confirmRelease, setConfirmRelease] = useState<Territory | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["territories"],
    queryFn: fetchTerritories,
  });

  const releaseMutation = useMutation({
    mutationFn: releaseTerritory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["territories"] });
      setConfirmRelease(null);
    },
  });

  const territories = data?.territories ?? [];
  const maxTerritories = 5; // Based on plan limits
  const usedCount = territories.length;

  return (
    <div className="flex flex-col h-full">
      <TopBar title="My Territories" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Summary + CTA */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {usedCount} of {maxTerritories} territories used
            </p>
            <div className="mt-1 h-2 w-48 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (usedCount / maxTerritories) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
          <Button variant="primary" asChild>
            <Link href="/territories/select">
              <Plus className="h-4 w-4 mr-2" />
              Claim New Territory
            </Link>
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6 space-y-3">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : territories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-6">
              <MapPin className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No territories claimed yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Select ZIP codes on the map to claim exclusive territories and
              start receiving permit leads.
            </p>
            <Button variant="primary" asChild>
              <Link href="/territories/select">
                <Plus className="h-4 w-4 mr-2" />
                Select Territories
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {territories.map((territory) => (
              <Card key={territory.id} hover>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold text-foreground">
                        {territory.zip}
                      </span>
                    </div>
                    <Badge
                      variant={
                        territory.status === "active"
                          ? "success"
                          : territory.status === "waitlisted"
                          ? "warning"
                          : "secondary"
                      }
                    >
                      {territory.status}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground mb-1">
                    {territory.city}, {territory.state}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      Slot {territory.slot_number}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(territory.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <Button
                    variant="danger"
                    size="sm"
                    className="w-full"
                    onClick={() => setConfirmRelease(territory)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Release
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Release confirmation dialog */}
      <Dialog
        open={!!confirmRelease}
        onClose={() => setConfirmRelease(null)}
        title="Release Territory"
        description={`Are you sure you want to release ZIP ${confirmRelease?.zip}? This action cannot be undone and another contractor may claim the slot.`}
      >
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="outline" onClick={() => setConfirmRelease(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={releaseMutation.isPending}
            onClick={() => {
              if (confirmRelease) {
                releaseMutation.mutate(confirmRelease.zip);
              }
            }}
          >
            {releaseMutation.isPending ? "Releasing..." : "Release Territory"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
