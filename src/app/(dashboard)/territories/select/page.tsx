"use client";

import { useRef, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { X, MapPin, Plus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/layout/TopBar";
import type { MapDashboardHandle } from "@/components/map/MapDashboard";
import type maplibregl from "maplibre-gl";

const MapDashboard = dynamic(() => import("@/components/map/MapDashboard"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

interface ClaimedZip {
  zip: string;
  city: string;
  state: string;
}

async function claimTerritory(zip: string) {
  const res = await fetch("/api/territories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zip }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to claim territory");
  }
  return res.json();
}

export default function TerritorySelectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mapRef = useRef<MapDashboardHandle>(null);
  const [, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [claimedZips, setClaimedZips] = useState<ClaimedZip[]>([]);
  const [selectedZip, setSelectedZip] = useState<{
    zip: string;
    status: string;
    city: string;
    state: string;
  } | null>(null);

  const claimMutation = useMutation({
    mutationFn: claimTerritory,
    onSuccess: (_data, zip) => {
      queryClient.invalidateQueries({ queryKey: ["territories"] });
      setClaimedZips((prev) => [
        ...prev,
        {
          zip,
          city: selectedZip?.city ?? "",
          state: selectedZip?.state ?? "",
        },
      ]);
      setSelectedZip(null);
    },
  });

  const removeZip = useCallback((zip: string) => {
    setClaimedZips((prev) => prev.filter((z) => z.zip !== zip));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Select Territories" />

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Map area */}
        <div className="flex-1 relative">
          <MapDashboard
            ref={mapRef}
            initialZoom={5}
            onMapReady={(map) => setMapInstance(map)}
          />

          {/* ZIP info popup */}
          {selectedZip && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <Card className="w-72 shadow-xl">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <span className="font-bold text-foreground">
                        ZIP {selectedZip.zip}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedZip(null)}
                      aria-label="Close"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {selectedZip.city}, {selectedZip.state}
                  </p>
                  <Badge
                    variant={
                      selectedZip.status === "available"
                        ? "success"
                        : selectedZip.status === "limited"
                        ? "warning"
                        : "destructive"
                    }
                    className="mb-3"
                  >
                    {selectedZip.status}
                  </Badge>
                  {selectedZip.status !== "full" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      disabled={claimMutation.isPending}
                      onClick={() => claimMutation.mutate(selectedZip.zip)}
                    >
                      {claimMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Plus className="h-4 w-4 mr-1" />
                      )}
                      Claim Territory
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full">
                      Join Waitlist
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Side panel: claimed territories */}
        <div className="lg:w-80 border-t lg:border-t-0 lg:border-l border-border bg-card overflow-y-auto">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Claimed Territories ({claimedZips.length})
            </h3>

            {claimedZips.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Click on ZIP codes on the map to claim territories.
              </p>
            ) : (
              <div className="space-y-2">
                {claimedZips.map((z) => (
                  <div
                    key={z.zip}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {z.zip}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {z.city}, {z.state}
                      </p>
                    </div>
                    <button
                      onClick={() => removeZip(z.zip)}
                      aria-label="Remove ZIP"
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="primary"
              className="w-full mt-4"
              onClick={() => router.push("/territories")}
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
