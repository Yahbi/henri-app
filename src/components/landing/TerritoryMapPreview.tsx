"use client";

import dynamic from "next/dynamic";
import { MapPin, Grid3X3, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";


const Map = dynamic(() => import("@/components/map/MapDashboard"), {
  ssr: false,
  loading: () => <Skeleton className="h-[500px] w-full rounded-xl" />,
});

const stats = [
  { icon: MapPin, value: "6", label: "Cities" },
  { icon: Grid3X3, value: "10,000+", label: "ZIPs" },
  { icon: Users, value: "1", label: "Contractor Per ZIP" },
] as const;

export function TerritoryMapPreview() {
  return (
    <section className="bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
            Lock Down Your Territory
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            One contractor per trade per ZIP. Be the first — and only — one to
            know about every new permit in your exclusive territory.
          </p>
        </div>

        {/* Map */}
        <Card variant="elevated" className="mt-12 overflow-hidden">
          <div className="h-[500px]">
            <Map />
          </div>
        </Card>

        {/* Stat cards */}
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} variant="glass" className="text-center">
                <CardContent className="flex flex-col items-center gap-2 p-6">
                  <Icon className="h-6 w-6 text-primary" />
                  <span className="text-2xl font-bold text-foreground">
                    {stat.value}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {stat.label}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
