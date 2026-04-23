"use client";

import { useState, useMemo, useEffect } from "react";
import { CheckCircle, Clock, AlertTriangle } from "lucide-react";

/* ─── Maintenance Task Database ─── */
interface MaintenanceTask {
  id: string;
  title: string;
  category: "hvac" | "plumbing" | "electrical" | "exterior" | "interior" | "seasonal";
  months: number[]; // 0-indexed months when this task is due
  estimatedCost: string;
  urgency: "routine" | "important" | "critical";
  description: string;
}

const allTasks: MaintenanceTask[] = [
  // HVAC
  { id: "hvac-filter", title: "Replace HVAC air filters", category: "hvac", months: [0, 2, 5, 8, 11], estimatedCost: "$15-40", urgency: "routine", description: "Replace or clean air filters every 1-3 months for optimal airflow and air quality." },
  { id: "hvac-tune", title: "HVAC seasonal tune-up", category: "hvac", months: [2, 9], estimatedCost: "$80-150", urgency: "important", description: "Professional inspection before cooling and heating seasons. Prevents breakdowns and extends system life." },
  { id: "hvac-duct", title: "Inspect ductwork for leaks", category: "hvac", months: [3], estimatedCost: "$200-500", urgency: "routine", description: "Check for leaks, gaps, and insulation issues. Leaky ducts waste 20-30% of heating/cooling energy." },
  // Plumbing
  { id: "plumb-heater", title: "Flush water heater", category: "plumbing", months: [3, 9], estimatedCost: "$100-200", urgency: "important", description: "Drain and flush sediment buildup. Extends water heater life by 2-5 years." },
  { id: "plumb-leak", title: "Check for leaks under sinks", category: "plumbing", months: [0, 6], estimatedCost: "Free (DIY)", urgency: "routine", description: "Inspect under kitchen and bathroom sinks for drips, moisture, or mold." },
  { id: "plumb-sump", title: "Test sump pump", category: "plumbing", months: [2, 8], estimatedCost: "Free (DIY)", urgency: "important", description: "Pour water into the pit to verify the pump activates. Critical before rainy season." },
  // Exterior
  { id: "ext-gutter", title: "Clean gutters and downspouts", category: "exterior", months: [3, 10], estimatedCost: "$100-250", urgency: "important", description: "Remove debris to prevent water damage, foundation issues, and ice dams." },
  { id: "ext-roof", title: "Inspect roof for damage", category: "exterior", months: [3, 9], estimatedCost: "$150-400", urgency: "critical", description: "Check for missing shingles, flashing damage, and wear. Address issues before they cause leaks." },
  { id: "ext-paint", title: "Check exterior paint and caulking", category: "exterior", months: [4], estimatedCost: "$50-200 (touch-up)", urgency: "routine", description: "Look for peeling paint, cracked caulk around windows and doors." },
  // Electrical
  { id: "elec-smoke", title: "Test smoke & CO detectors", category: "electrical", months: [0, 6], estimatedCost: "$10-30 (batteries)", urgency: "critical", description: "Test all detectors and replace batteries. Replace units older than 10 years." },
  { id: "elec-gfci", title: "Test GFCI outlets", category: "electrical", months: [3, 9], estimatedCost: "Free (DIY)", urgency: "important", description: "Press the test/reset buttons on all GFCI outlets in kitchens, bathrooms, and garages." },
  // Seasonal
  { id: "season-winter", title: "Winterize exterior faucets", category: "seasonal", months: [10], estimatedCost: "$10-30", urgency: "important", description: "Disconnect hoses, drain exterior faucets, and insulate exposed pipes to prevent freezing." },
  { id: "season-spring", title: "Spring yard cleanup", category: "seasonal", months: [2], estimatedCost: "$100-300", urgency: "routine", description: "Clean debris, inspect drainage, check irrigation system, and prep garden beds." },
  { id: "season-ac", title: "Pre-summer AC check", category: "seasonal", months: [4], estimatedCost: "$80-150", urgency: "important", description: "Professional AC inspection before summer heat. Check refrigerant levels and clean coils." },
  // Interior
  { id: "int-caulk", title: "Re-caulk tubs and showers", category: "interior", months: [5], estimatedCost: "$10-20 (DIY)", urgency: "routine", description: "Inspect and replace cracked or moldy caulk in bathrooms to prevent water damage." },
  { id: "int-dryer", title: "Clean dryer vent", category: "interior", months: [6], estimatedCost: "$100-170", urgency: "critical", description: "Professional dryer vent cleaning. Lint buildup is the #1 cause of residential fires." },
];

const categoryLabels: Record<string, { label: string; color: string }> = {
  hvac: { label: "HVAC", color: "bg-blue-500/10 text-blue-400" },
  plumbing: { label: "Plumbing", color: "bg-cyan-500/10 text-cyan-400" },
  electrical: { label: "Electrical", color: "bg-yellow-500/10 text-yellow-400" },
  exterior: { label: "Exterior", color: "bg-green-500/10 text-green-400" },
  interior: { label: "Interior", color: "bg-purple-500/10 text-purple-400" },
  seasonal: { label: "Seasonal", color: "bg-orange-500/10 text-orange-400" },
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MaintenanceCalendar() {
  const currentMonth = new Date().getMonth();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());

  // Load persisted completion state from /api/homeowner/maintenance on mount.
  // Phase 1.6 — before this wiring, the `completedTasks` useState reset on
  // every page reload, making the checklist feel broken.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/homeowner/maintenance");
        if (!res.ok) return;
        const body = (await res.json()) as {
          completed: Array<{ task_id: string; completed_at: string }>;
        };
        if (cancelled) return;
        setCompletedTasks(new Set(body.completed.map((r) => r.task_id)));
      } catch {
        /* empty state is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tasksForMonth = useMemo(
    () => allTasks.filter((t) => t.months.includes(selectedMonth)),
    [selectedMonth],
  );

  const toggleComplete = (taskId: string) => {
    // Optimistic local flip first so the checkbox feels instant;
    // the POST below persists the new state. On failure we leave
    // the local state alone — worst case the user flips again.
    let wantCompleted = true;
    setCompletedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
        wantCompleted = false;
      } else {
        next.add(taskId);
        wantCompleted = true;
      }
      return next;
    });
    fetch("/api/homeowner/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, completed: wantCompleted }),
    }).catch(() => {
      /* network error — accept local flip for now */
    });
  };

  const completedCount = tasksForMonth.filter((t) => completedTasks.has(t.id)).length;
  const progressPct = tasksForMonth.length > 0 ? Math.round((completedCount / tasksForMonth.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground">Maintenance Calendar</h2>
        <p className="text-xs text-muted-foreground mt-1">Keep your home in top shape with personalized reminders</p>
      </div>

      {/* Month selector */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {monthNames.map((name, i) => (
          <button
            key={name}
            onClick={() => setSelectedMonth(i)}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              selectedMonth === i
                ? "bg-primary text-white"
                : i === currentMonth
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-bg-subtle"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{completedCount} of {tasksForMonth.length} tasks completed</span>
          <span className="text-foreground font-medium">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Tasks list */}
      <div className="space-y-2">
        {tasksForMonth.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No scheduled maintenance for {monthNames[selectedMonth]}.</p>
        ) : (
          tasksForMonth.map((task) => {
            const done = completedTasks.has(task.id);
            const cat = categoryLabels[task.category];
            return (
              <div
                key={task.id}
                className={`rounded-lg border p-3 transition-colors ${
                  done ? "border-green-500/20 bg-green-500/5" : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleComplete(task.id)}
                    className={`mt-0.5 shrink-0 ${done ? "text-green-500" : "text-muted-foreground hover:text-foreground"}`}
                    aria-label={done ? "Mark incomplete" : "Mark complete"}
                  >
                    {done ? <CheckCircle className="h-5 w-5" /> : (
                      <div className="h-5 w-5 rounded-full border-2 border-current" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                        {task.title}
                      </p>
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cat.color}`}>
                        {cat.label}
                      </span>
                      {task.urgency === "critical" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-400">
                          <AlertTriangle className="h-2.5 w-2.5" /> Critical
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px] text-muted-foreground">Est. {task.estimatedCost}</span>
                      {!done && (
                        <button className="text-[10px] text-primary hover:underline font-medium">
                          Book a Pro
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
