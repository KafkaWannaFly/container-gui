import { Spin } from "antd";
import { type ComponentProps, lazy, Suspense } from "react";

// The charting stack (@ant-design/plots → AntV G2, html2canvas, lodash) is
// ~40% of the JS bundle. Lazy-loading keeps it out of the startup chunk so
// the app parses and paints faster; it only loads when a Monitor tab opens.
// Keep light exports (like METRIC_RANGES) here, never in MetricChartsImpl,
// or a static import of them would pull the whole stack back in.
const MetricChartsImpl = lazy(() => import("./MetricChartsImpl"));

export const METRIC_RANGES = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
];

export default function MetricCharts(props: ComponentProps<typeof MetricChartsImpl>) {
  return (
    <Suspense fallback={<Spin style={{ marginTop: 40 }} />}>
      <MetricChartsImpl {...props} />
    </Suspense>
  );
}
