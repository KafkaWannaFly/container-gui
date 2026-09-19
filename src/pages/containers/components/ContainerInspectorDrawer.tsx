import { useQuery } from "@tanstack/react-query";
import { Descriptions, Drawer, Empty, Spin, Table, Tabs } from "antd";
import { Mono, StateTag } from "../../../components/ui";
import { queryKeys } from "../../../lib/queryClient";
import { inspectContainer } from "../../../services/tauriApi";
import { shortId } from "../../../types/docker";

interface Props {
  id: string | null;
  onClose: () => void;
}

const SECRET_PATTERN = /(PASSWORD|SECRET|TOKEN|_KEY|APIKEY)/i;

export default function ContainerInspectorDrawer({ id, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.containerInspect(id ?? ""),
    queryFn: () => inspectContainer(id as string),
    enabled: id != null,
  });

  const env = (data?.Config?.Env ?? []).map((entry) => {
    const eq = entry.indexOf("=");
    const key = eq === -1 ? entry : entry.slice(0, eq);
    const value = eq === -1 ? "" : entry.slice(eq + 1);
    return { key, value: SECRET_PATTERN.test(key) ? "••••••••" : value };
  });

  const networks = Object.entries(data?.NetworkSettings?.Networks ?? {}).map(([name, value]) => ({
    name,
    ip: (value as { IPAddress?: string })?.IPAddress ?? "—",
    gateway: (value as { Gateway?: string })?.Gateway ?? "—",
    mac: (value as { MacAddress?: string })?.MacAddress ?? "—",
  }));

  const mounts = data?.Mounts ?? [];

  return (
    <Drawer
      open={id != null}
      onClose={onClose}
      width={560}
      title={
        data ? (
          <span>
            Container <Mono>{(data.Name ?? "").replace(/^\//, "") || shortId(data.Id)}</Mono>
          </span>
        ) : (
          "Container"
        )
      }
    >
      {isLoading || !data ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
          <Spin />
        </div>
      ) : (
        <Tabs
          items={[
            {
              key: "overview",
              label: "Overview",
              children: (
                <Descriptions
                  column={1}
                  size="small"
                  bordered
                  items={[
                    { key: "name", label: "Name", children: (data.Name ?? "").replace(/^\//, "") || "—" },
                    { key: "id", label: "ID", children: <Mono>{shortId(data.Id)}</Mono> },
                    {
                      key: "state",
                      label: "State",
                      children: <StateTag state={data.State?.Status ?? "unknown"} />,
                    },
                    { key: "image", label: "Image", children: <Mono>{data.Config?.Image ?? "—"}</Mono> },
                    {
                      key: "ports",
                      label: "Ports",
                      children: (
                        <span className="mono">
                          {Object.keys(data.NetworkSettings?.Ports ?? {}).join(", ") || "—"}
                        </span>
                      ),
                    },
                    { key: "created", label: "Created", children: data.Created ?? "—" },
                    { key: "started", label: "Started", children: data.State?.StartedAt ?? "—" },
                    { key: "exit", label: "Exit code", children: data.State?.ExitCode ?? "—" },
                    {
                      key: "restart",
                      label: "Restart policy",
                      children: data.HostConfig?.RestartPolicy?.Name ?? "—",
                    },
                  ]}
                />
              ),
            },
            {
              key: "env",
              label: "Environment",
              children: env.length ? (
                <div
                  className="card subtle mono"
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {env.map((item) => (
                    <div key={item.key}>
                      {item.key}={item.value}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="No environment variables" />
              ),
            },
            {
              key: "mounts",
              label: "Mounts",
              children: (
                <Table
                  size="small"
                  rowKey={(row) => `${row.Source}-${row.Destination}`}
                  pagination={false}
                  dataSource={mounts}
                  locale={{ emptyText: <Empty description="No mounts" /> }}
                  columns={[
                    {
                      title: "Source",
                      dataIndex: "Source",
                      render: (value: string, row) => <Mono>{row.Name || value}</Mono>,
                    },
                    { title: "Target", dataIndex: "Destination", render: (v: string) => <Mono>{v}</Mono> },
                    { title: "Mode", dataIndex: "Mode", width: 70 },
                  ]}
                />
              ),
            },
            {
              key: "networks",
              label: "Networks",
              children: (
                <Table
                  size="small"
                  rowKey="name"
                  pagination={false}
                  dataSource={networks}
                  locale={{ emptyText: <Empty description="No networks" /> }}
                  columns={[
                    { title: "Network", dataIndex: "name" },
                    { title: "IP", dataIndex: "ip", render: (v: string) => <Mono>{v}</Mono> },
                    { title: "Gateway", dataIndex: "gateway", render: (v: string) => <Mono>{v}</Mono> },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
