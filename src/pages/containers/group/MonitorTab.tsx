import { Empty, Segmented } from "antd";
import { useMemo, useState } from "react";
import MetricCharts, { METRIC_RANGES } from "../../../components/MetricCharts";
import type { ContainerSummary } from "../../../types/docker";
import { ContainerFilter } from "./components";
import { svcColor } from "./model";

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
          options={METRIC_RANGES}
          onChange={(value) => setMinutes(value as number)}
        />
      </div>
      <MetricCharts ids={ids} shown={shown} minutes={minutes} />
    </div>
  );
}
