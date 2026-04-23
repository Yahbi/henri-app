import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Skeleton className="flex-1 w-full" />
    </div>
  );
}
