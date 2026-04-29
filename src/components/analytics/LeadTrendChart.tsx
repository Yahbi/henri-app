"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const data = [
  { month: "Oct", leads: 12, wins: 3 },
  { month: "Nov", leads: 15, wins: 4 },
  { month: "Dec", leads: 22, wins: 6 },
  { month: "Jan", leads: 19, wins: 5 },
  { month: "Feb", leads: 31, wins: 9 },
  { month: "Mar", leads: 47, wins: 12 },
];

export function LeadTrendChart() {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">
        Lead &amp; Win Trend (6 months)
      </h3>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {/* Recharts wraps these in SVG <stop>/<path> elements. SVG
           * `stop-color` and `stroke` resolve `var()` at the CSS layer in
           * modern browsers, so the tokens propagate. Migrated from
           * #D4886A/#3D9970 hex on 2026-04-25 per design-system audit. */}
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--hot)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--hot)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="colorWins" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="hsl(var(--success))" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "12px" }}
              iconType="circle"
              iconSize={8}
            />
            <Area
              type="monotone"
              dataKey="leads"
              name="Leads"
              stroke="var(--hot)"
              strokeWidth={2}
              fill="url(#colorLeads)"
            />
            <Area
              type="monotone"
              dataKey="wins"
              name="Wins"
              stroke="hsl(var(--success))"
              strokeWidth={2}
              fill="url(#colorWins)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
