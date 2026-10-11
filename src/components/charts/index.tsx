"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { cn } from "@/components/ui";

/**
 * Charts in BoardUI's dashboard style, on Recharts: rounded bars on a grey
 * track, the chart palette tokens (--color-chart-1…9), a white readout card
 * on hover, and legend dots. Every chart has a text alternative.
 */

export type ChartTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const chartColor = (tone: ChartTone) => `var(--color-chart-${tone}-active)`;

export function LegendDot({ tone, label, value }: { tone: ChartTone | "neutral"; label: string; value?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-body-sm text-muted">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: tone === "neutral" ? "var(--color-chart-neutral)" : chartColor(tone) }} />
      {label}
      {value !== undefined && <span className="font-semibold text-heading tabular-nums">{value}</span>}
    </span>
  );
}

type Series = { key: string; label: string; tone: ChartTone };
type Row = { label: string; title?: string; muted?: boolean } & Record<string, number | string | boolean | undefined>;

function ReadoutCard({ active, payload, series }: { active?: boolean; payload?: Array<{ payload: Row }>; series: Series[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-pop)]">
      <p className="text-label font-semibold text-heading">{row.title ?? row.label}</p>
      <ul className="mt-1 space-y-0.5">
        {series.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4 text-label text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: chartColor(s.tone) }} />{s.label}</span>
            <span className="font-semibold text-heading tabular-nums">{Number(row[s.key] ?? 0).toLocaleString("id-ID")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stacked daily bars (e.g. present + late). `muted` rows (weekends) render grey. */
export function TrendBars({ data, series, height = 200, label }: { data: Row[]; series: Series[]; height?: number; label: string }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
          <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={8} interval="preserveStartEnd" tick={{ fill: "var(--color-text-tertiary)", fontSize: 12 }} />
          <Tooltip cursor={{ fill: "var(--color-chart-track)", radius: 8 } as never} content={<ReadoutCard series={series} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" radius={i === series.length - 1 ? [6, 6, 6, 6] : [0, 0, 6, 6]}
              background={i === 0 ? { fill: "var(--color-chart-track)", radius: 6 } : undefined} animationDuration={700} animationEasing="ease-out">
              {data.map((row) => <Cell key={row.label} fill={row.muted ? "var(--color-chart-neutral)" : chartColor(s.tone)} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with a centred total; slices with a value of 0 are skipped. */
export function DonutChart({ slices, total, caption, size = 168 }: { slices: Array<{ label: string; value: number; tone: ChartTone }>; total: React.ReactNode; caption: string; size?: number }) {
  const visible = slices.filter((s) => s.value > 0);
  const empty = visible.length === 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={`${caption}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={empty ? [{ label: "kosong", value: 1 }] : visible} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={empty ? 0 : 3} cornerRadius={6} stroke="none" isAnimationActive animationDuration={800}>
            {empty ? <Cell fill="var(--color-chart-track)" /> : visible.map((s) => <Cell key={s.label} fill={chartColor(s.tone)} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <span className="text-[1.75rem] font-medium leading-none tracking-[-0.02em] text-heading tabular-nums">{total}</span>
        <span className="mt-1 text-label text-muted">{caption}</span>
      </div>
    </div>
  );
}

/** Horizontal meter that grows into view (KPI averages, progress). */
export function MeterBar({ percent, tone = 6, className }: { percent: number; tone?: ChartTone; className?: string }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-[var(--color-chart-track)]", className)} role="presentation">
      <div className="h-full origin-left rounded-full animate-grow-x" style={{ width: `${value}%`, background: chartColor(tone) }} />
    </div>
  );
}
