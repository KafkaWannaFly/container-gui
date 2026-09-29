import { useMemo, useState } from "react";
import { Mono, StateDot } from "../../../components/ui";
import { type ServiceInfo, type ServiceState, svcColor } from "./model";

const W = 190;
const H = 48;
const GAP_X = 110;
const GAP_Y = 14;
const TOP = 26;

type Node = ServiceInfo & { x: number; y: number };
type Edge = { from: string; to: string; cond: string };

/** Layered dependency graph: dependents on the left, dependencies on the right. */
export default function DependencyGraph({
  services,
  states,
  onPick,
}: {
  services: ServiceInfo[];
  states: Map<string, ServiceState>;
  onPick: (name: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const { nodes, edges, cols, width, height } = useMemo(() => {
    const depth: Record<string, number> = {};
    const d = (name: string): number => {
      if (depth[name] != null) return depth[name];
      const svc = services.find((x) => x.name === name);
      depth[name] = svc?.dependsOn.length ? 1 + Math.max(...svc.dependsOn.map((dep) => d(dep.on))) : 0;
      return depth[name];
    };
    services.forEach((svc) => {
      d(svc.name);
    });
    const maxD = services.length ? Math.max(...Object.values(depth)) : 0;
    const colsOf = Array.from({ length: maxD + 1 }, (_, i) =>
      services.filter((svc) => maxD - depth[svc.name] === i),
    );
    const rows = Math.max(1, ...colsOf.map((col) => col.length));
    const nodesById: Record<string, Node> = {};
    colsOf.forEach((col, ci) => {
      const off = ((rows - col.length) * (H + GAP_Y)) / 2;
      col.forEach((svc, ri) => {
        nodesById[svc.name] = { ...svc, x: ci * (W + GAP_X), y: TOP + off + ri * (H + GAP_Y) };
      });
    });
    const allEdges: Edge[] = services.flatMap((svc) =>
      svc.dependsOn.map((dep) => ({ from: svc.name, to: dep.on, cond: dep.cond })),
    );
    return {
      nodes: nodesById,
      edges: allEdges,
      cols: colsOf,
      width: colsOf.length * W + Math.max(0, colsOf.length - 1) * GAP_X,
      height: TOP + rows * (H + GAP_Y) - GAP_Y,
    };
  }, [services]);

  const related = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    const walk = (node: string, dir: "down" | "up") => {
      for (const edge of edges) {
        const [a, b] = dir === "down" ? [edge.from, edge.to] : [edge.to, edge.from];
        if (a === node && !set.has(b)) {
          set.add(b);
          walk(b, dir);
        }
      }
    };
    walk(hover, "down");
    walk(hover, "up");
    return set;
  }, [hover, edges]);

  const startOrder = [...cols].reverse().map((col) => col.map((svc) => svc.name).join(", "));

  if (!services.length) return <span className="dim fs12">No services in this config.</span>;

  return (
    <div>
      <div className="g-dag-wrap">
        <div className="g-dag" style={{ width, height }}>
          {cols.map((col, ci) => (
            <span
              key={col.map((svc) => svc.name).join("-") || `col-${ci}`}
              className="g-dag-col-h"
              style={{ left: ci * (W + GAP_X) }}
            >
              {ci === cols.length - 1 ? "Starts first" : ci === 0 ? "Starts last" : `#${cols.length - ci}`}
            </span>
          ))}
          <svg width={width} height={height} role="img" aria-label="Service dependency graph">
            <defs>
              <marker
                id="g-arr"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#62666d" />
              </marker>
              <marker
                id="g-arr-on"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#d0d6e0" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const a = nodes[edge.from];
              const b = nodes[edge.to];
              if (!a || !b) return null;
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const x2 = b.x - 2;
              const y2 = b.y + H / 2;
              const on = related ? related.has(edge.from) && related.has(edge.to) : false;
              const dim = related ? !on : false;
              return (
                <g key={`${edge.from}->${edge.to}`} opacity={dim ? 0.25 : 1}>
                  <path
                    d={`M${x1},${y1} C${x1 + 55},${y1} ${x2 - 55},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={on ? "#d0d6e0" : "#383b3f"}
                    strokeWidth="1"
                    strokeDasharray={edge.cond === "started" ? "4 3" : undefined}
                    markerEnd={on ? "url(#g-arr-on)" : "url(#g-arr)"}
                  />
                  {on ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 6}
                      textAnchor="middle"
                      fill="#d0d6e0"
                      fontSize="12"
                      fontFamily="var(--font-mono)"
                    >
                      {edge.cond}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {Object.values(nodes).map((node) => {
            const state = states.get(node.name) ?? "created";
            return (
              <button
                type="button"
                key={node.name}
                className={`g-dag-node${related ? (related.has(node.name) ? " on" : " off") : ""}`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: W,
                  height: H,
                  borderLeft: `2px solid ${svcColor(node.name)}`,
                }}
                onMouseEnter={() => setHover(node.name)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick(node.name)}
              >
                <span className="nm">
                  <StateDot state={state === "partial" ? "restarting" : state} size={7} />
                  {node.name}
                  {node.replicas > 1 ? <span className="mono dim">×{node.replicas}</span> : null}
                  {node.profiles.length ? (
                    <span className="mono dim">· {node.profiles.join(",")}</span>
                  ) : null}
                </span>
                <span className="mono dim">
                  {node.dependsOn.length
                    ? `needs ${node.dependsOn.map((dep) => dep.on).join(", ")}`
                    : "no deps"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          Arrows point to what a service needs · solid = waits for <Mono>healthy</Mono>, dashed = waits for{" "}
          <Mono>started</Mono> · hover a service to trace its chain.
        </span>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          Start order:{" "}
          {startOrder.map((names, i) => (
            <span key={names}>
              {i ? " → " : ""}
              <span className="mono" style={{ color: "var(--mist)" }}>
                {names}
              </span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
