export default function BillingLoading() {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-7 w-32 rounded bg-muted" />
        <div className="h-4 w-48 rounded bg-muted mt-2" />
      </div>

      {/* Plan card */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
        <div className="h-10 w-36 rounded bg-muted" />
      </div>

      {/* Billing history skeleton rows */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-bg-subtle px-4 py-3">
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-4 w-20 rounded bg-muted ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
