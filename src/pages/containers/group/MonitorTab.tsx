import { Line } from "@ant-design/plots";
import { useQuery } from "@tanstack/react-query";
import { Empty, Segmented } from "antd";
import { useMemo, useState } from "react";
import { queryKeys } from "../../../lib/queryClient";
import { metricsSeries } from "../../../services/tauriApi";
import type { ContainerSummary, MetricSample } from "../../../types/docker";
import { formatBytes, formatRate } from "../../../types/docker";
import { ContainerFilter } from "./components";
import { svcColor } from "./model";

const POLL_MS = 2_000;
/** Enough points for a smooth line at card width, few enough to stay cheap. */
const MAX_POINTS = 150;
const RANGES = [
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
}: {
  metric: Metric;
  rows: Row[];
  names: string[];
  colors: string[];
  total: number | null;
}) {
  const peak = rows.reduce((max, row) => (row.value != null && row.value > max ? row.value : max), 0);
  const y = peak < metric.floor ? { domainMin: 0, domainMax: metric.floor } : { domainMin: 0, nice: true };
  return (
    <div className="card mon-card">
      <div className="mon-head">
        <h3 className="section-title">{metric.title}</h3>
        <span className="mono mon-now">
          {total == null ? "—" : metric.format(total)}
          <small>total</small>
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

export default function MonitorTab({
  containers,
  states,
}: {
  containers: ContainerSummary[];
  states: Map<string, string>;
}) {
  const [minutes, setMinutes] = useState(15);
  const [hidden, setHidden] = useState<string[]>([]);

  const live = useMemo(
    () =>
      containers
        .filter((ctr) => {
          const state = states.get(ctr.id) ?? ctr.state;
          return state === "running" || state === "paused";
        })
        .map((ctr) => {
          const name = (ctr.names[0] ?? ctr.id.slice(0, 12)).replace(/^\//, "");
          const service = ctr.composeService;
          const replicas = containers.filter((x) => x.composeService === service).length;
          // Single-replica services keep the colour they have elsewhere on the page.
          return { ctr, id: ctr.id, name, color: svcColor(service && replicas === 1 ? service : name) };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [containers, states],
  );
  const ids = useMemo(() => live.map((ctr) => ctr.id).sort(), [live]);
  const shown = useMemo(() => live.filter((ctr) => !hidden.includes(ctr.id)), [live, hidden]);
  const infoOf = useMemo(() => new Map(live.map((entry) => [entry.id, entry])), [live]);

  const query = useQuery({
    queryKey: [...queryKeys.metricsSeries(ids, MAX_POINTS), minutes] as const,
    queryFn: () => metricsSeries(ids, { since: Date.now() - minutes * 60_000, maxPoints: MAX_POINTS }),
    refetchInterval: POLL_MS,
    enabled: ids.length > 0,
    placeholderData: (prev) => prev,
  });

  const series = useMemo(() => {
    const byId = new Map((query.data?.series ?? []).map((entry) => [entry.id, entry.samples]));
    return shown.map((ctr) => ({ name: ctr.name, samples: byId.get(ctr.id) ?? [] }));
  }, [query.data, shown]);
  const stepMs = query.data?.stepMs ?? POLL_MS;
  const names = shown.map((ctr) => ctr.name);
  const colors = shown.map((ctr) => ctr.color);

  const charts = useMemo(
    () =>
      METRICS.map((metric) => {
        const latest = series
          .map(({ samples }) => (samples.length ? metric.value(samples[samples.length - 1]) : null))
          .filter((v): v is number => v != null);
        return {
          metric,
          rows: rowsFor(metric, series, stepMs),
          total: latest.length ? latest.reduce((sum, v) => sum + v, 0) : null,
        };
      }),
    [series, stepMs],
  );

  if (!live.length) {
    return (
      <div className="card" style={{ padding: 48 }}>
        <Empty description="No running containers — start the project to see live metrics." />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="toolbar" style={{ gap: 6 }}>
        <ContainerFilter
          containers={live.map((entry) => entry.ctr)}
          hidden={hidden}
          setHidden={setHidden}
          nameOf={(ctr) => infoOf.get(ctr.id)?.name ?? ""}
          colorOf={(ctr) => infoOf.get(ctr.id)?.color ?? "var(--fog)"}
        />
        <span className="spacer" />
        <Segmented
          size="small"
          value={minutes}
          options={RANGES}
          onChange={(value) => setMinutes(value as number)}
        />
      </div>

      {shown.length ? (
        <div className="mon-grid">
          {charts.map(({ metric, rows, total }) => (
            <Chart key={metric.key} metric={metric} rows={rows} names={names} colors={colors} total={total} />
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: 48 }}>
          <Empty description="No containers selected." />
        </div>
      )}
    </div>
  );
}
