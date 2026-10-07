import { Line } from "@ant-design/plots";
import { useQuery } from "@tanstack/react-query";
import { Empty } from "antd";
import { useMemo } from "react";
import { queryKeys } from "../lib/queryClient";
import { metricsSeries } from "../services/tauriApi";
import type { MetricSample } from "../types/docker";
import { formatBytes, formatRate } from "../types/docker";

const POLL_MS = 2_000;
/** Enough points for a smooth line at card width, few enough to stay cheap. */
const MAX_POINTS = 150;

export const METRIC_RANGES = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
];

type Metric = {
  key: string;
  title: string;
  value: (s: MetricSample) => number | null;
  format: (v: number) => string;
  /** Smallest y-axis top, so a flat or idle line gets clean ticks. */
  floor: number;
};

const KB = 1024;
const bytes = (v: number) => (v > 0 ? formatBytes(v) : "0 B");
const METRICS: Metric[] = [
  { key: "cpu", title: "CPU", value: (s) => s.cpuPercent, format: (v) => `${v.toFixed(1)}%`, floor: 1 },
  { key: "mem", title: "Memory", value: (s) => s.memoryUsage, format: bytes, floor: KB * KB },
  { key: "rx", title: "Network received", value: (s) => s.netRxRate, format: formatRate, floor: KB },
  { key: "tx", title: "Network sent", value: (s) => s.netTxRate, format: formatRate, floor: KB },
  { key: "br", title: "Block read", value: (s) => s.blockReadRate, format: formatRate, floor: KB },
  { key: "bw", title: "Block written", value: (s) => s.blockWriteRate, format: formatRate, floor: KB },
  {
    key: "pids",
    title: "Processes",
    value: (s) => s.pids,
    format: (v) => String(Math.round(v)),
    floor: 5,
  },
];

type Row = { time: Date; name: string; value: number | null };

const clock = (d: Date) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Rows for one metric. A null row is inserted wherever samples are more than
 * 1.5 steps apart (container stopped, app closed) so the line breaks there. */
function rowsFor(metric: Metric, series: { name: string; samples: MetricSample[] }[], stepMs: number): Row[] {
  const rows: Row[] = [];
  for (const { name, samples } of series) {
    samples.forEach((s, i) => {
      const prev = samples[i - 1];
      if (prev && s.ts - prev.ts > stepMs * 1.5) {
        rows.push({ time: new Date(prev.ts + stepMs), name, value: null });
      }
      rows.push({ time: new Date(s.ts), name, value: metric.value(s) });
    });
  }
  return rows;
}

function Chart({
  metric,
  rows,
  names,
  colors,
  total,
  totalLabel,
}: {
  metric: Metric;
  rows: Row[];
  names: string[];
  colors: string[];
  total: number | null;
  totalLabel: string;
}) {
  const peak = rows.reduce((max, row) => (row.value != null && row.value > max ? row.value : max), 0);
  const y = peak < metric.floor ? { domainMin: 0, domainMax: metric.floor } : { domainMin: 0, nice: true };
  return (
    <div className="card mon-card">
      <div className="mon-head">
        <h3 className="section-title">{metric.title}</h3>
        <span className="mono mon-now">
          {total == null ? "—" : metric.format(total)}
          <small>{totalLabel}</small>
        </span>
      </div>
      <Line
        data={rows}
        height={180}
        autoFit
        animate={false}
        xField="time"
        yField="value"
        colorField="name"
        legend={false}
        theme={{ type: "classicDark", view: { viewFill: "transparent" } }}
        scale={{ color: { domain: names, range: colors }, y }}
        style={{ lineWidth: 1.5 }}
        axis={{
          x: {
            title: false,
            labelFormatter: (d: Date) => clock(d).slice(0, 5),
            labelFill: "#8a8f98",
            labelFontSize: 12,
            line: false,
            tick: false,
          },
          y: {
            title: false,
            labelFormatter: (v: number) => metric.format(v),
            labelFill: "#8a8f98",
            labelFontSize: 12,
            grid: true,
            gridStroke: "#23252a",
            gridStrokeOpacity: 1,
            gridLineDash: [0, 0],
            tick: false,
          },
        }}
        tooltip={{
          title: (d: Row) => clock(d.time),
          items: [
            { channel: "y", valueFormatter: (v: number | null) => (v == null ? "—" : metric.format(v)) },
          ],
        }}
      />
    </div>
  );
}

export type ChartEntry = { id: string; name: string; color: string };

/** One chart per metric with a line per entry, polled from the backend sampler.
 * `ids` is what gets fetched; `shown` is what gets drawn, so filtering is instant. */
export default function MetricCharts({
  ids,
  shown,
  minutes,
  totalLabel = "total",
}: {
  ids: string[];
  shown: ChartEntry[];
  minutes: number;
  totalLabel?: string;
}) {
  const query = useQuery({
    queryKey: [...queryKeys.metricsSeries(ids, MAX_POINTS), minutes] as const,
    queryFn: () => metricsSeries(ids, { since: Date.now() - minutes * 60_000, maxPoints: MAX_POINTS }),
    refetchInterval: POLL_MS,
    enabled: ids.length > 0,
    placeholderData: (prev) => prev,
  });

  const series = useMemo(() => {
    const byId = new Map((query.data?.series ?? []).map((entry) => [entry.id, entry.samples]));
    return shown.map((entry) => ({ name: entry.name, samples: byId.get(entry.id) ?? [] }));
  }, [query.data, shown]);
  const stepMs = query.data?.stepMs ?? POLL_MS;
  const names = shown.map((entry) => entry.name);
  const colors = shown.map((entry) => entry.color);

  const charts = useMemo(() => {
    // The headline is "now": a stopped container's last sample is history, not
    // current usage. Allow one bucket plus a couple of sampler ticks of lag.
    const freshSince = Date.now() - stepMs - 2 * POLL_MS;
    const hasSamples = series.some(({ samples }) => samples.length > 0);
    return METRICS.map((metric) => {
      const latest = series
        .map(({ samples }) => samples[samples.length - 1])
        .filter((sample) => sample != null && sample.ts >= freshSince)
        .map((sample) => metric.value(sample))
        .filter((v): v is number => v != null);
      return {
        metric,
        rows: rowsFor(metric, series, stepMs),
        total: latest.length ? latest.reduce((sum, v) => sum + v, 0) : hasSamples ? 0 : null,
      };
    });
  }, [series, stepMs]);

  if (!shown.length) {
    return (
      <div className="card" style={{ padding: 48 }}>
        <Empty description="No containers selected." />
      </div>
    );
  }

  return (
    <div className="mon-grid">
      {charts.map(({ metric, rows, total }) => (
        <Chart
          key={metric.key}
          metric={metric}
          rows={rows}
          names={names}
          colors={colors}
          total={total}
          totalLabel={totalLabel}
        />
      ))}
    </div>
  );
}
