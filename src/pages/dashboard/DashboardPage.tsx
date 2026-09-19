import { useQuery } from "@tanstack/react-query";
import { Descriptions, Spin } from "antd";
import { MetricCard } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import { getSystemInfo, listContainers, listImages, listVolumes } from "../../services/tauriApi";
import { formatBytes, shortId } from "../../types/docker";

export default function DashboardPage() {
  const containers = useQuery({ queryKey: queryKeys.containers(), queryFn: () => listContainers(true) });
  const images = useQuery({ queryKey: queryKeys.images(), queryFn: listImages });
  const volumes = useQuery({ queryKey: queryKeys.volumes(), queryFn: listVolumes });
  const system = useQuery({ queryKey: queryKeys.system(), queryFn: getSystemInfo, refetchInterval: 15_000 });

  const list = containers.data ?? [];
  const running = list.filter((c) => c.state === "running").length;
  const stopped = list.length - running;

  const imageList = images.data ?? [];
  const imageBytes = imageList.reduce((sum, i) => sum + i.size, 0);
  const imageInUse = imageList.filter((i) => i.repoTags.some((t) => t && t !== "<none>:<none>")).length;

  const volumeList = volumes.data ?? [];
  const orphaned = volumeList.filter((v) => !v.inUse);
  const reclaimable = orphaned.reduce((sum, v) => sum + v.sizeBytes, 0);

  const loading = containers.isLoading || images.isLoading || volumes.isLoading;

  return (
    <div className="page">
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
          <Spin />
        </div>
      ) : (
        <>
          <div className="metrics">
            <MetricCard label="Running containers" value={running} suffix={`of ${list.length}`} />
            <MetricCard label="Stopped containers" value={stopped} />
            <MetricCard label="Images" value={imageInUse} suffix={`of ${imageList.length}`} />
            <MetricCard label="Image size" value={formatBytes(imageBytes)} />
            <MetricCard
              label="Volumes"
              value={volumeList.length - orphaned.length}
              suffix={`of ${volumeList.length}`}
            />
            <MetricCard
              label="Reclaimable"
              value={formatBytes(reclaimable)}
              suffix={`${orphaned.length} orphaned`}
            />
          </div>

          <div className="card">
            <div className="section-title">Engine health</div>
            {system.data ? (
              <Descriptions
                column={{ xs: 1, sm: 2, md: 4 }}
                size="small"
                items={[
                  { key: "v", label: "Docker version", children: system.data.dockerVersion },
                  { key: "api", label: "API version", children: system.data.apiVersion },
                  { key: "os", label: "OS", children: `${system.data.os} / ${system.data.arch}` },
                  { key: "k", label: "Kernel", children: system.data.kernelVersion || "—" },
                  { key: "r", label: "Running", children: system.data.containersRunning },
                  { key: "s", label: "Stopped", children: system.data.containersStopped },
                  { key: "c", label: "CPUs", children: system.data.cpus },
                  { key: "m", label: "Memory", children: formatBytes(system.data.memoryTotal) },
                  { key: "p", label: "Ping", children: `${system.data.pingMs} ms` },
                ]}
              />
            ) : (
              <span className="dim">Engine information unavailable.</span>
            )}
          </div>

          <div className="card">
            <div className="section-title">Recently created containers</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...list]
                .sort((a, b) => b.created - a.created)
                .slice(0, 6)
                .map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span className="mono dim" style={{ width: 96 }}>
                      {shortId(c.id)}
                    </span>
                    <span style={{ color: "var(--paper)" }}>{c.names[0] ?? c.id.slice(0, 12)}</span>
                    <span className="mono dim">{c.image}</span>
                  </div>
                ))}
              {list.length === 0 ? <span className="dim">No containers.</span> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
