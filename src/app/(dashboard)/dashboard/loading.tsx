import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex-1 flex flex-col h-screen">
      {/* Map placeholder */}
      <div className="relative flex-1">
        <Skeleton className="w-full h-full rounded-none" />
        {/* Fake overlay controls */}
        <div className="absolute top-4 left-4">
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <div className="absolute top-4 right-4">
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
