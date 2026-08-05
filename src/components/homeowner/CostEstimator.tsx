"use client";

import { useState, useMemo } from "react";
import { useBenchmarks } from "@/hooks/useBenchmarks";

/* ─── Project types with fallback cost data ─── */
const projectTypes = [
  { value: "kitchen", label: "Kitchen Remodel", trade: "general remodel", baseLow: 15000, baseAvg: 35000, baseHigh: 75000, unit: "project" },
  { value: "bathroom", label: "Bathroom Remodel", trade: "general remodel", baseLow: 8000, baseAvg: 18000, baseHigh: 40000, unit: "project" },
  { value: "roof", label: "Roof Replacement", trade: "roofing", baseLow: 6000, baseAvg: 12000, baseHigh: 25000, unit: "project" },
  { value: "hvac", label: "HVAC System", trade: "hvac", baseLow: 5000, baseAvg: 10000, baseHigh: 20000, unit: "project" },
  { value: "electrical", label: "Electrical Panel Upgrade", trade: "electrical", baseLow: 1500, baseAvg: 3000, baseHigh: 6000, unit: "project" },
  { value: "plumbing", label: "Plumbing Repair/Repipe", trade: "plumbing", baseLow: 2000, baseAvg: 5500, baseHigh: 12000, unit: "project" },
  { value: "solar", label: "Residential Solar", trade: "solar", baseLow: 12000, baseAvg: 22000, baseHigh: 35000, unit: "project" },
  { value: "windows", label: "Window Replacement", trade: "windows", baseLow: 4000, baseAvg: 9000, baseHigh: 18000, unit: "project" },
  { value: "paint_ext", label: "Exterior Painting", trade: "painting", baseLow: 2500, baseAvg: 5000, baseHigh: 10000, unit: "project" },
  { value: "adu", label: "ADU Construction", trade: "adu", baseLow: 95000, baseAvg: 200000, baseHigh: 350000, unit: "project" },
  { value: "foundation", label: "Foundation Repair", trade: "foundation", baseLow: 4000, baseAvg: 12000, baseHigh: 30000, unit: "project" },
  { value: "landscaping", label: "Full Landscape", trade: "landscaping", baseLow: 5000, baseAvg: 20000, baseHigh: 50000, unit: "project" },
];

const qualityTiers = [
  { value: "standard", label: "Standard", multiplier: 0.85 },
  { value: "mid", label: "Mid-Range", multiplier: 1.0 },
  { value: "premium", label: "Premium", multiplier: 1.45 },
];

interface CostEstimatorProps {
  initialZip?: string;
  /** Opens the intake chat with this project's trade prefilled. The
   *  "Get Quotes" CTA had no handler at all before 2026-08-04 — it was a
   *  styled div that did nothing when clicked. */
  onRequestQuotes?: (trade: string) => void;
}

export function CostEstimator({ initialZip = "", onRequestQuotes }: CostEstimatorProps) {
  const [projectType, setProjectType] = useState("kitchen");
  const [quality, setQuality] = useState("mid");
  const [zip, setZip] = useState(initialZip);
  const [showResult, setShowResult] = useState(false);
  const project = projectTypes.find((p) => p.value === projectType)!;
  const tier = qualityTiers.find((q) => q.value === quality)!;

  const { benchmarks: benchmarkResults } = useBenchmarks(zip, project.trade, project.label);

  const benchmark = useMemo(
    () =>
      benchmarkResults.length > 0
        ? {
            cost_low: benchmarkResults[0].cost_low,
            cost_avg: benchmarkResults[0].cost_avg,
            cost_high: benchmarkResults[0].cost_high,
            sample_size: benchmarkResults[0].sample_size,
          }
        : null,
    [benchmarkResults],
  );

  const estimate = useMemo(() => {
    const mult = tier.multiplier;

    /* Use real benchmark data if available, otherwise fallback */
    if (benchmark) {
      return {
        low: Math.round(benchmark.cost_low * mult),
        avg: Math.round(benchmark.cost_avg * mult),
        high: Math.round(benchmark.cost_high * mult),
        sampleSize: benchmark.sample_size,
      };
    }

    /* Fallback: static data with ZIP multiplier */
    const zipPrefix = zip.slice(0, 3);
    const highCost = ["100", "101", "102", "900", "901", "902", "941", "940", "021", "022"];
    const lowCost = ["350", "351", "720", "721", "390", "391", "260", "261"];
    let zipMult = 1.0;
    if (highCost.includes(zipPrefix)) zipMult = 1.35;
    else if (lowCost.includes(zipPrefix)) zipMult = 0.75;

    return {
      low: Math.round(project.baseLow * mult * zipMult),
      avg: Math.round(project.baseAvg * mult * zipMult),
      high: Math.round(project.baseHigh * mult * zipMult),
      sampleSize: 0,
    };
  }, [project, tier, zip, benchmark]);

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground">Cost Estimator</h2>
        <p className="text-xs text-muted-foreground mt-1">Get a quick estimate for your project based on your area</p>
      </div>

      {/* Project Type */}
      <div>
        <label htmlFor="ce-project-type" className="text-sm font-medium text-foreground block mb-1.5">Project Type</label>
        <select
          id="ce-project-type"
          value={projectType}
          onChange={(e) => { setProjectType(e.target.value); setShowResult(false); }}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {projectTypes.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Quality Tier */}
      <div>
        <p className="text-sm font-medium text-foreground block mb-1.5" id="ce-quality-label">Quality Level</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="ce-quality-label">
          {qualityTiers.map((q) => (
            <button
              key={q.value}
              onClick={() => { setQuality(q.value); setShowResult(false); }}
              aria-pressed={quality === q.value}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                quality === q.value
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* ZIP Code */}
      <div>
        <label htmlFor="ce-zip" className="text-sm font-medium text-foreground block mb-1.5">Your ZIP Code</label>
        <input
          id="ce-zip"
          type="text"
          inputMode="numeric"
          value={zip}
          onChange={(e) => { setZip(e.target.value.replace(/\D/g, "").slice(0, 5)); setShowResult(false); }}
          placeholder="90278"
          maxLength={5}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Estimate Button */}
      <button
        onClick={() => setShowResult(true)}
        className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity"
      >
        Get Estimate
      </button>

      {/* Results */}
      {showResult && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 space-y-4">
          <p className="text-sm font-medium text-foreground">
            Estimated cost for {project.label}
            {zip && ` in ZIP ${zip}`}:
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Low</p>
              <p className="text-xl font-heading font-normal text-foreground">${estimate.low.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-primary font-medium">Average</p>
              <p className="text-2xl font-heading font-normal text-primary">${estimate.avg.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">High</p>
              <p className="text-xl font-heading font-normal text-foreground">${estimate.high.toLocaleString()}</p>
            </div>
          </div>
          {/* Truthfulness: with no local benchmark rows this is a static
              national range times a coarse ZIP-prefix multiplier, not a
              local figure. The old copy said "in your area" either way. */}
          <p className="text-[10px] text-muted-foreground text-center">
            {estimate.sampleSize > 0
              ? `Based on ${estimate.sampleSize} local projects, ${tier.label.toLowerCase()} quality materials. Actual costs vary.`
              : `Ballpark national range for ${tier.label.toLowerCase()} quality materials — we don't have local project data for this ZIP yet. Actual costs vary a lot by site.`
            }
          </p>
          {onRequestQuotes && (
            <button
              onClick={() => onRequestQuotes(project.trade)}
              className="w-full rounded-lg border border-primary text-primary px-4 py-2 text-sm font-medium hover:bg-primary/5 transition-colors"
            >
              Get quotes from local contractors
            </button>
          )}
        </div>
      )}
    </div>
  );
}
