import {
  CodeOutlined,
  FileTextOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  MinusOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Descriptions, Dropdown, type MenuProps, Table, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { CopyButton, Mono, Pill, StateDot } from "../../../components/ui";
import { compactDuration } from "../../../lib/format";
import type {
  ComposeProject,
  ContainerInspect,
  ContainerStats,
  ContainerSummary,
} from "../../../types/docker";
import { formatBytes, formatRate, portUrl } from "../../../types/docker";
import { Section, useSections } from "./components";
import DependencyGraph from "./DependencyGraph";
import { impactOf, type ServiceInfo, type ServiceState, svcColor } from "./model";

const SECTIONS = ["general", "services", "deps", "networks", "volumes"];

/** Two stacked rates, e.g. ↓ received over ↑ sent. */
function RatePair({ a, b, labels }: { a: number | null; b: number | null; labels: [string, string] }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        fontSize: 12,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <span>
        <span className="dim">{labels[0]}</span> {formatRate(a)}
      </span>
      <span>
        <span className="dim">{labels[1]}</span> {formatRate(b)}
      </span>
    </span>
  );
}

export default function InfoTab({
  config,
  containers,
  byService,
  services,
  activeProfiles,
  statsById,
  inspectById,
  states,
  serviceStates,
  onOpenContainer,
  onLogs,
  onScale,
  onToggleProfile,
  act,
  pause,
}: {
  config: ComposeProject;
  containers: ContainerSummary[];
  byService: Map<string, ContainerSummary[]>;
  services: ServiceInfo[];
  activeProfiles: string[];
  statsById: Map<string, ContainerStats>;
  inspectById: Map<string, ContainerInspect>;
  states: Map<string, string>;
  serviceStates: Map<string, ServiceState>;
  onOpenContainer: (id: string, tab: string) => void;
  onLogs: (id: string) => void;
  onScale: (service: string, replicas: number) => void;
  onToggleProfile: (name: string) => void;
  act: (ctr: ContainerSummary, verb: "start" | "stop" | "restart") => void;
  pause: (ctr: ContainerSummary) => void;
}) {
  const { closed, onToggle, button } = useSections(SECTIONS);
  const [flash, setFlash] = useState<string | null>(null);

  const nameOf = (ctr: ContainerSummary) => (ctr.names[0] ?? ctr.id.slice(0, 12)).replace(/^\//, "");
  const created = containers.reduce(
    (min, ctr) => (min == null || ctr.created < min ? ctr.created : min),
    undefined as number | undefined,
  );

  const running = (ctr: ContainerSummary) => states.get(ctr.id) === "running";
  const replicas = (service: string) => byService.get(service)?.length ?? 0;
  const serviceNameSet = useMemo(() => new Set(services.map((svc) => svc.name)), [services]);

  const general = [
    {
      key: "project",
      label: "Project",
      children: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Pill tone="teal">{config.config.name ?? config.project}</Pill>
          <span className="dim" style={{ fontSize: 12 }}>
            from <Mono>name:</Mono> in compose.yaml
          </span>
        </span>
      ),
    },
    {
      key: "workdir",
      label: "Working directory",
      children: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="mono">{config.workdir}</span>
          <CopyButton text={config.workdir} what="Path" />
        </span>
      ),
    },
    {
      key: "files",
      label: "Compose files",
      children: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {config.files
            .filter((file) => file.name !== ".env")
            .map((file, i) => (
              <span key={file.path} style={{ display: "inline-flex", gap: 6 }}>
                {i > 0 ? <span className="dim">+</span> : null}
                <span className="mono" style={{ color: "var(--mist)" }}>
                  {file.name}
                </span>
              </span>
            ))}
          <span className="dim" style={{ fontSize: 12 }}>
            merged in this order
          </span>
        </span>
      ),
    },
    {
      key: "env",
      label: "Env file",
      children: config.files.some((file) => file.name === ".env") ? (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Mono>.env</Mono>
          <span className="dim" style={{ fontSize: 12 }}>
            used for interpolation
          </span>
        </span>
      ) : (
        <span className="dim">—</span>
      ),
    },
    {
      key: "profiles",
      label: "Profiles",
      children: (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {services
            .flatMap((svc) => svc.profiles)
            .filter((profile, i, all) => all.indexOf(profile) === i)
            .map((profile) => (
              <span key={profile} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Button
                  size="small"
                  type={activeProfiles.includes(profile) ? "primary" : "default"}
                  icon={activeProfiles.includes(profile) ? <PoweroffOutlined /> : <PlayCircleOutlined />}
                  onClick={() => onToggleProfile(profile)}
                >
                  {activeProfiles.includes(profile) ? `Disable ${profile}` : `Enable ${profile}`}
                </Button>
                <Mono>{profile}</Mono>
                <span className="dim" style={{ fontSize: 12 }}>
                  {services
                    .filter((svc) => svc.profiles.includes(profile))
                    .map((svc) => svc.name)
                    .join(", ")}
                </span>
              </span>
            ))}
          {services.some((svc) => svc.profiles.length) ? (
            <span className="dim" style={{ fontSize: 12 }}>
              Services without a profile always run.
            </span>
          ) : (
            <span className="dim">—</span>
          )}
        </div>
      ),
    },
    {
      key: "created",
      label: "Created",
      children: (
        <span>
          <Mono>{created ? new Date(created * 1000).toLocaleString() : "—"}</Mono>
        </span>
      ),
    },
    {
      key: "compose",
      label: "Compose",
      children: (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Mono>docker compose {config.composeVersion}</Mono>
          <span className="dim" style={{ fontSize: 12 }}>
            config hash <span className="mono">{config.configHash}</span>
          </span>
        </span>
      ),
    },
  ];

  const svcColumns = [
    {
      title: "",
      key: "dot",
      width: 30,
      render: (_: unknown, ctr: ContainerSummary) => <StateDot state={states.get(ctr.id) ?? ctr.state} />,
    },
    {
      title: "Service",
      key: "service",
      width: 270,
      render: (_: unknown, ctr: ContainerSummary) => {
        const service = ctr.composeService ?? "";
        const info = services.find((svc) => svc.name === service);
        const isFirst = byService.get(service)?.[0]?.id === ctr.id;
        const orphan = !serviceNameSet.has(service);
        const count = replicas(service);
        const ordinal = (byService.get(service)?.indexOf(ctr) ?? -1) + 1;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 3, height: 12, borderRadius: 2, background: svcColor(service) }} />
              <span style={{ color: orphan ? "var(--fog)" : "var(--paper)" }}>{service || "—"}</span>
              {count > 1 ? <span className="mono dim">#{ordinal}</span> : null}
              {info?.scalable && isFirst ? (
                <span className="g-stepper">
                  <Button
                    type="text"
                    size="small"
                    icon={<MinusOutlined />}
                    disabled={count <= 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onScale(service, count - 1);
                    }}
                  />
                  <span className="mono">×{count}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    disabled={count >= 6}
                    onClick={(event) => {
                      event.stopPropagation();
                      onScale(service, count + 1);
                    }}
                  />
                </span>
              ) : null}
              {info?.profiles.length ? <Pill tone="neutral">profile: {info.profiles.join(",")}</Pill> : null}
              {orphan ? (
                <Tooltip title="Not defined in any compose file anymore">
                  <span>
                    <Pill tone="neutral">orphan</Pill>
                  </span>
                </Tooltip>
              ) : null}
            </span>
            <span className="mono dim">{nameOf(ctr)}</span>
            <span className="mono">{ctr.image}</span>
          </div>
        );
      },
    },
    {
      title: "Ports",
      key: "ports",
      width: 170,
      render: (_: unknown, ctr: ContainerSummary) => {
        const published = [
          ...new Map(
            ctr.ports.filter((port) => port.publicPort).map((port) => [port.publicPort, port] as const),
          ).values(),
        ];
        return published.length ? (
          <div style={{ display: "flex", flexDirection: "column", whiteSpace: "nowrap" }}>
            {published.map((port) => {
              const url = portUrl(port.publicPort ?? 0, port.privatePort);
              return (
                <span
                  key={`${port.publicPort}->${port.privatePort}/${port.type}`}
                  className="mono dim port-row"
                >
                  <Tooltip title={`Open ${url} in the browser`}>
                    <button type="button" className="port-link" onClick={() => void openUrl(url)}>
                      localhost:{port.publicPort}
                    </button>
                  </Tooltip>
                  {" → "}
                  {port.privatePort}/{port.type}
                  <CopyButton text={url} what="URL" />
                </span>
              );
            })}
          </div>
        ) : (
          <span className="dim">—</span>
        );
      },
    },
    {
      title: "CPU",
      key: "cpu",
      width: 74,
      render: (_: unknown, ctr: ContainerSummary) => {
        const stat = running(ctr) ? statsById.get(ctr.id) : undefined;
        return (
          <span className="mono">{stat?.cpuPercent != null ? `${stat.cpuPercent.toFixed(1)}%` : "—"}</span>
        );
      },
    },
    {
      title: "Memory",
      key: "mem",
      width: 96,
      render: (_: unknown, ctr: ContainerSummary) => {
        const stats = running(ctr) ? statsById.get(ctr.id) : undefined;
        return (
          <span className="mono" style={{ whiteSpace: "nowrap" }}>
            {stats ? formatBytes(stats.memoryUsage, 1) : "—"}
          </span>
        );
      },
    },
    {
      title: "Network I/O",
      key: "net",
      width: 132,
      render: (_: unknown, ctr: ContainerSummary) => {
        const stats = running(ctr) ? statsById.get(ctr.id) : undefined;
        if (!stats) return <span className="dim">—</span>;
        return <RatePair a={stats.netRxRate} b={stats.netTxRate} labels={["↓", "↑"]} />;
      },
    },
    {
      title: "Block I/O",
      key: "block",
      width: 120,
      render: (_: unknown, ctr: ContainerSummary) => {
        const stats = running(ctr) ? statsById.get(ctr.id) : undefined;
        if (!stats) return <span className="dim">—</span>;
        return <RatePair a={stats.blockReadRate} b={stats.blockWriteRate} labels={["R", "W"]} />;
      },
    },
    {
      title: "Status",
      key: "status",
      width: 150,
      render: (_: unknown, ctr: ContainerSummary) => {
        const state = states.get(ctr.id) ?? ctr.state;
        const inspect = inspectById.get(ctr.id);
        const started = inspect?.State?.StartedAt;
        const exit = inspect?.State?.ExitCode;
        return (
          <span
            className="fs12"
            style={state === "exited" ? { color: "var(--coral)" } : { color: "var(--fog)" }}
          >
            {state === "running" && started && !started.startsWith("0001")
              ? `up ${compactDuration(Date.now() - new Date(started).getTime())}`
              : state === "paused"
                ? "paused"
                : state === "exited"
                  ? `exited${exit != null ? ` (${exit})` : ""}`
                  : state}
            {inspect?.RestartCount ? <span className="dim"> · {inspect.RestartCount}↻</span> : null}
          </span>
        );
      },
    },
    {
      title: "",
      key: "act",
      width: 96,
      align: "right" as const,
      render: (_: unknown, ctr: ContainerSummary) => {
        if (!serviceNameSet.has(ctr.composeService ?? "")) return null;
        const state = states.get(ctr.id) ?? ctr.state;
        const items: MenuProps["items"] = [
          { key: "lg", icon: <FileTextOutlined />, label: "Logs", onClick: () => onLogs(ctr.id) },
          {
            key: "fs",
            icon: <FolderOutlined />,
            label: "Files",
            onClick: () => onOpenContainer(ctr.id, "files"),
          },
          {
            key: "ex",
            icon: <CodeOutlined />,
            label: "Exec",
            disabled: state !== "running",
            onClick: () => onOpenContainer(ctr.id, "exec"),
          },
          { type: "divider" },
          {
            key: "rs",
            icon: <ReloadOutlined />,
            label: "Restart",
            disabled: state !== "running",
            onClick: () => act(ctr, "restart"),
          },
          state === "paused"
            ? { key: "unpause", icon: <PlayCircleOutlined />, label: "Resume", onClick: () => pause(ctr) }
            : {
                key: "pause",
                icon: <PauseCircleOutlined />,
                label: "Pause",
                disabled: state !== "running",
                onClick: () => pause(ctr),
              },
          {
            key: "op",
            icon: <InfoCircleOutlined />,
            label: "Open container",
            onClick: () => onOpenContainer(ctr.id, "info"),
          },
        ];
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: row action cluster wraps buttons
          // biome-ignore lint/a11y/useKeyWithClickEvents: row action cluster wraps buttons
          <span
            className="row-act"
            style={{ display: "inline-flex", alignItems: "center", gap: 0 }}
            onClick={(event) => event.stopPropagation()}
          >
            {state === "running" ? (
              <Tooltip title="Stop">
                <Button
                  color="danger"
                  variant="text"
                  size="small"
                  aria-label="Stop"
                  icon={<PoweroffOutlined />}
                  onClick={() => act(ctr, "stop")}
                />
              </Tooltip>
            ) : state === "exited" || state === "created" || state === "dead" ? (
              <Tooltip title="Start">
                <Button
                  color="primary"
                  variant="text"
                  size="small"
                  aria-label="Start"
                  icon={<PlayCircleOutlined />}
                  onClick={() => act(ctr, "start")}
                />
              </Tooltip>
            ) : null}
            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items }}>
              <Button type="text" size="small" icon={<MoreOutlined />} aria-label="More" />
            </Dropdown>
          </span>
        );
      },
    },
  ];

  const inactive = services.filter(
    (svc) => svc.profiles.length && !svc.profiles.some((p) => activeProfiles.includes(p)),
  );

  const svcChips = (names: string[]) => (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {names.map((name) => (
        <span
          key={name}
          className="g-svc-chip"
          style={{ color: svcColor(name), borderColor: svcColor(name) }}
        >
          {name}
        </span>
      ))}
    </span>
  );

  const volumes = useMemo(
    () =>
      services.flatMap((svc) =>
        (svc.config.volumes ?? []).map((volume) => ({
          key: `${svc.name}-${volume.source}-${volume.target}`,
          type: volume.type,
          name: volume.source ?? "",
          target: volume.target ?? "",
          ro: Boolean(volume.read_only),
          service: svc.name,
        })),
      ),
    [services],
  );

  const networkRows = useMemo(() => {
    const networks = config.config.networks ?? {};
    return Object.entries(networks).map(([key, network]) => ({
      key,
      name: network.name ?? key,
      external: Boolean(network.external),
      services: services.filter((svc) => key in (svc.config.networks ?? {})).map((svc) => svc.name),
    }));
  }, [config, services]);

  return (
    <div className="tab-stack" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="toolbar">
        <span className="spacer" />
        {button}
      </div>

      <Section id="general" title="General" closed={closed} onToggle={onToggle}>
        <Descriptions column={1} size="small" bordered items={general} />
      </Section>

      <Section
        id="services"
        title="Services"
        closed={closed}
        onToggle={onToggle}
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            {services.length} services · {containers.length} containers · click a row to open it
          </span>
        }
      >
        <Table<ContainerSummary>
          className="svc-table"
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={containers}
          columns={svcColumns}
          rowClassName={(ctr) => (flash === ctr.composeService ? "g-flash" : "")}
          onRow={(ctr) => ({ onClick: () => onOpenContainer(ctr.id, "info") })}
        />
        {inactive.length ? (
          <div className="g-inactive">
            <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
              Defined but not running — profile off
            </div>
            {inactive.map((svc) => (
              <div key={svc.name} className="g-inactive-row">
                <span style={{ width: 3, height: 12, borderRadius: 2, background: svcColor(svc.name) }} />
                <span className="muted">{svc.name}</span>
                <Pill tone="neutral">profile: {svc.profiles.join(",")}</Pill>
                <span style={{ flex: 1 }} />
                <Button
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={() => onToggleProfile(svc.profiles[0])}
                >
                  Enable {svc.profiles[0]}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <Section id="deps" title="Dependencies" closed={closed} onToggle={onToggle}>
        <DependencyGraph
          services={services}
          states={serviceStates}
          onPick={(name) => {
            setFlash(name);
            setTimeout(() => setFlash(null), 1200);
          }}
        />
      </Section>

      <Section id="networks" title="Networks" closed={closed} onToggle={onToggle}>
        <Table
          size="small"
          pagination={false}
          dataSource={networkRows}
          columns={[
            {
              title: "Network",
              dataIndex: "name",
              render: (value: string, row) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--paper)" }}>{value}</span>
                  {row.external ? <Pill tone="lav">external</Pill> : null}
                </span>
              ),
            },
            { title: "Attached", dataIndex: "services", render: (value: string[]) => svcChips(value) },
          ]}
        />
      </Section>

      <Section id="volumes" title="Volumes & mounts" closed={closed} onToggle={onToggle}>
        <Table
          size="small"
          pagination={false}
          dataSource={volumes}
          columns={[
            {
              title: "Source",
              dataIndex: "name",
              render: (value: string, row) => (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Pill tone={row.type === "bind" ? "lav" : "teal"}>{row.type}</Pill>
                    <Mono>{value}</Mono>
                    {row.ro ? <Pill tone="neutral">ro</Pill> : null}
                  </span>
                  <span className="mono dim">{row.target}</span>
                </span>
              ),
            },
            { title: "Used by", dataIndex: "service", render: (value: string) => svcChips([value]) },
          ]}
        />
      </Section>

      <div className="dim" style={{ fontSize: 12 }}>
        {services.length} services · {runningCount(containers, states)} running of {containers.length}
        {activeProfiles.length ? ` · profiles: ${activeProfiles.join(", ")}` : ""}
      </div>
    </div>
  );
}

function runningCount(containers: ContainerSummary[], states: Map<string, string>) {
  return containers.filter((ctr) => states.get(ctr.id) === "running").length;
}

/* Kept for future use: impact list is rendered by the page's stop/restart confirmation. */
export function dependentsOf(service: string, services: ServiceInfo[]) {
  return impactOf(service, services);
}
