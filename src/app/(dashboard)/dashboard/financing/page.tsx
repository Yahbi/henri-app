"use client";

import { useState } from "react";
import { useFinancing } from "@/hooks/useFinancing";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { ComingSoon, STUBS_ENABLED } from "@/components/ComingSoon";

import { FINANCING_PARTNERS } from "@/lib/constants/financing-partners";

const partners = FINANCING_PARTNERS;

function statusBadge(status: string) {
  if (status === "approved")
    return <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">Approved</span>;
  if (status === "pending")
    return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">Pending</span>;
  if (status === "funded")
    return <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-400">Funded</span>;
  if (status === "declined")
    return <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">Declined</span>;
  return <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">{status || "Draft"}</span>;
}

export default function FinancingPage() {
  if (!STUBS_ENABLED) {
    return (
      <ComingSoon
        feature="Financing"
        description="Quote homeowners with GreenSky / Mosaic / Service Finance monthly payments in-line. Partner API integrations are in final review and ship next release."
      />
    );
  }
  return <FinancingPageInner />;
}

function FinancingPageInner() {
  const { stats, deals, isLoading, error: financingError, refresh: refreshFinancing } = useFinancing();
  const [amount, setAmount] = useState(18500);
  const [rate, setRate] = useState(7.99);
  const [term, setTerm] = useState(36);

  const monthlyRate = rate / 100 / 12;
  const monthlyPayment =
    monthlyRate > 0
      ? (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -term))
      : amount / term;
  const totalCost = monthlyPayment * term;
  const totalInterest = totalCost - amount;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">
          Financing Calculator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Help homeowners afford the project
        </p>
      </div>

      {financingError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <p className="text-sm text-destructive">
            {financingError} These figures may be incomplete — retry.
          </p>
          <button
            type="button"
            onClick={() => refreshFinancing()}
            className="text-sm font-medium text-destructive underline underline-offset-2 hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}

      {/* Financing Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Quotes</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl font-heading font-normal text-foreground mt-1">{stats.total_quotes}</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Financed Deals</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl font-heading font-normal text-green-400 mt-1">{stats.quotes_with_financing}</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Ticket</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl font-heading font-normal text-primary mt-1">
              ${stats.avg_ticket_size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Approval Rate</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl font-heading font-normal text-blue-400 mt-1">{stats.approval_rate}%</p>
          )}
        </Card>
      </div>

      {/* Calculator Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-heading font-normal text-foreground">
            Project Details
          </h2>

          <div className="space-y-4">
            {/* Project Amount */}
            <div className="space-y-1.5">
              <label htmlFor="fin-amount" className="text-sm font-medium text-foreground">
                Project Amount ($)
              </label>
              <input
                id="fin-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min={0}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Interest Rate */}
            <div className="space-y-1.5">
              <label htmlFor="fin-rate" className="text-sm font-medium text-foreground">
                Interest Rate (%)
              </label>
              <input
                id="fin-rate"
                type="number"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                min={0}
                max={30}
                step={0.01}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Term */}
            <div className="space-y-1.5">
              <label htmlFor="fin-term" className="text-sm font-medium text-foreground">
                Term (months)
              </label>
              <select
                id="fin-term"
                value={term}
                onChange={(e) => setTerm(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={12}>12 months</option>
                <option value={24}>24 months</option>
                <option value={36}>36 months</option>
                <option value={48}>48 months</option>
                <option value={60}>60 months</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          <Card className="p-5 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Monthly Payment
            </p>
            <p className="text-3xl font-heading font-normal text-primary">
              ${monthlyPayment.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              For {term} months at {rate}% APR
            </p>
          </Card>

          <Card className="p-5 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total Interest
            </p>
            <p className="text-2xl font-heading font-normal text-foreground">
              ${totalInterest.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              Over the life of the loan
            </p>
          </Card>

          <Card className="p-5 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total Cost
            </p>
            <p className="text-2xl font-heading font-normal text-foreground">
              ${totalCost.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              Principal + interest
            </p>
          </Card>
        </div>
      </div>

      {/* Financing Partners */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-4">
          Financing Partners
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {partners.map((p) => (
            <Card
              key={p.name}
              className="p-5 space-y-3"
            >
              <h3 className="text-base font-heading font-normal text-foreground">
                {p.name}
              </h3>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">From </span>
                  <span className="font-medium text-primary">{p.rate}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{p.terms}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Deals */}
      {!isLoading && deals.length > 0 && (
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Recent Deals</h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Description</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Amount</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{deal.financing_partner || "Quote"}</td>
                    <td className="px-4 py-3 text-foreground font-medium">
                      ${deal.monthly_payment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                    </td>
                    <td className="px-4 py-3">{statusBadge(deal.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(deal.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
