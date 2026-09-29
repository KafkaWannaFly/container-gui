import { Empty, Segmented } from "antd";
import { useMemo, useState } from "react";
import MetricCharts, { METRIC_RANGES } from "../../../components/MetricCharts";
import { svcColor } from "../group/model";
import { composeOf, containerName, type TabProps } from "./model";

export default function MonitorTab({ ctr }: TabProps) {
  const [minutes, setMinutes] = useState(15);
  const live = !!ctr.State?.Running;
  const name = containerName(ctr);
  const service = composeOf(ctr)?.service;
  const ids = useMemo(() => [ctr.Id], [ctr.Id]);
  const shown = useMemo(
    () => [{ id: ctr.Id, name, color: svcColor(service || name) }],
    [ctr.Id, name, service],
  );

  if (!live) {
    return (
      <div className="card" style={{ padding: 48 }}>
        <Empty description="Container is not running — start it to see live metrics." />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="toolbar">
        <span className="spacer" />
        <Segmented
          size="small"
          value={minutes}
          options={METRIC_RANGES}
          onChange={(value) => setMinutes(value as number)}
        />
      </div>
      <MetricCharts ids={ids} shown={shown} minutes={minutes} totalLabel="now" />
    </div>
  );
}
