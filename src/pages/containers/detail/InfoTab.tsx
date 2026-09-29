import { CopyOutlined, ExportOutlined } from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Descriptions, type DescriptionsProps, Table } from "antd";
import { formatDistanceToNow } from "date-fns";
import { CollapseAllButton, Section, useSections } from "../../../components/Section";
import { CopyButton, Mono, Pill, StateDot } from "../../../components/ui";
import { compactDuration, isZeroTime, localTime, nsDuration, shellJoin } from "../../../lib/format";
import { formatBytes, type NetworkEndpoint, portUrl, shortId } from "../../../types/docker";
import { composeOf, cpuLimit, pidsLimit, platformOf, type TabProps } from "./model";

const INFO_SECTIONS = ["general", "health", "limits", "ports", "mounts", "networks", "labels"] as const;
const MOUNT_TONE: Record<string, string> = { bind: "lav", tmpfs: "amber", volume: "teal" };

type PortRow = { key: string; host: string | null; container: string; proto: string; url: string | null };

function portRows(ports: Record<string, { HostIp?: string | null; HostPort?: string | null }[] | null>) {
  const rows: PortRow[] = [];
  for (const [spec, bindings] of Object.entries(ports)) {
    const [port, proto = "tcp"] = spec.split("/");
    if (!bindings?.length) {
      rows.push({ key: spec, host: null, container: spec, proto, url: null });
      continue;
    }
    for (const binding of bindings) {
      const ip = binding.HostIp || "0.0.0.0";
      const hostPort = binding.HostPort ?? "";
      // Docker lists IPv4 and IPv6 bindings separately; one URL is enough.
      if (ip === "::" && bindings.some((b) => b.HostIp === "0.0.0.0" && b.HostPort === hostPort)) continue;
      rows.push({
        key: `${spec}-${ip}-${hostPort}`,
        host: ip.includes(":") ? `[${ip}]:${hostPort}` : `${ip}:${hostPort}`,
        container: spec,
        proto,
        url: proto === "tcp" ? portUrl(hostPort, port) : null,
      });
    }
  }
  return rows;
}

export default function InfoTab({ ctr, image, onCopy }: TabProps) {
  const { section, allClosed, toggleAll } = useSections("info.sections", INFO_SECTIONS);
  const compose = composeOf(ctr);
  const config = ctr.Config;
  const state = ctr.State;
  const started = state?.StartedAt;

  const general: DescriptionsProps["items"] = [
    {
      key: "id",
      label: "Container ID",
      children: (
        <button type="button" className="copyable mono" onClick={() => onCopy(ctr.Id, "Container ID")}>
          {shortId(ctr.Id)}
          <CopyOutlined />
        </button>
      ),
    },
    {
      key: "image",
      label: "Image",
      children: (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Mono>{config?.Image}</Mono>
          <span className="mono dim">{shortId(ctr.Image ?? "")}</span>
        </span>
      ),
    },
    { key: "cmd", label: "Command", children: <Mono>{shellJoin(config?.Cmd) || "—"}</Mono> },
    { key: "ep", label: "Entrypoint", children: <Mono>{shellJoin(config?.Entrypoint) || "—"}</Mono> },
    {
      key: "user",
      label: "User / Workdir",
      children: (
        <span>
          <Mono>{config?.User || "root"}</Mono> <span className="dim">·</span>{" "}
          <Mono>{config?.WorkingDir || "/"}</Mono>
        </span>
      ),
    },
    { key: "platform", label: "Platform", children: <Mono>{platformOf(ctr, image)}</Mono> },
    { key: "created", label: "Created", children: <Mono>{localTime(ctr.Created)}</Mono> },
    {
      key: "started",
      label: "Started",
      children: isZeroTime(started) ? (
        <span className="dim">never</span>
      ) : (
        <span>
          <Mono>{localTime(started)}</Mono>{" "}
          {state?.Running ? (
            <span className="dim">
              (up {compactDuration(Date.now() - new Date(started as string).getTime())})
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "restart",
      label: "Restart policy",
      children: (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Pill>{ctr.HostConfig?.RestartPolicy?.Name || "no"}</Pill>
          <span className="dim" style={{ fontSize: 12 }}>
            {ctr.RestartCount ?? 0} restart{ctr.RestartCount === 1 ? "" : "s"}
          </span>
        </span>
      ),
    },
    ...(compose
      ? [
          {
            key: "compose",
            label: "Compose",
            children: (
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Pill tone="teal">{compose.project}</Pill>
                {compose.service ? (
                  <>
                    <span className="dim">/</span>
                    <Mono>{compose.service}</Mono>
                  </>
                ) : null}
                {compose.files ? <span className="mono dim">{compose.files}</span> : null}
              </span>
            ),
          },
        ]
      : []),
  ];

  const healthState = state?.Health;
  const check = config?.Healthcheck;
  const lastRun = healthState?.Log?.[healthState.Log.length - 1];
  const healthTone =
    healthState?.Status === "healthy" ? "running" : healthState?.Status === "unhealthy" ? "exited" : "paused";
  const health: DescriptionsProps["items"] = healthState
    ? [
        {
          key: "status",
          label: "Status",
          children: (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <StateDot state={healthTone} size={8} />
              {healthState.Status}
              {healthState.FailingStreak ? (
                <span className="dim">· {healthState.FailingStreak} failing in a row</span>
              ) : null}
            </span>
          ),
        },
        { key: "test", label: "Test", children: <Mono>{shellJoin(check?.Test) || "—"}</Mono> },
        {
          key: "interval",
          label: "Interval / timeout",
          children: (
            <Mono>
              {nsDuration(check?.Interval)} / {nsDuration(check?.Timeout)} · {check?.Retries ?? 3} retries
            </Mono>
          ),
        },
        {
          key: "last",
          label: "Last check",
          children: lastRun?.End ? (
            <span className="dim">
              {formatDistanceToNow(new Date(lastRun.End), { addSuffix: true })} · exit {lastRun.ExitCode}
              {lastRun.Output?.trim() ? (
                <span className="mono" style={{ display: "block", marginTop: 4 }}>
                  {lastRun.Output.trim().slice(0, 300)}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="dim">not run yet</span>
          ),
        },
      ]
    : [];

  const cores = cpuLimit(ctr);
  const memory = ctr.HostConfig?.Memory;
  const pids = pidsLimit(ctr);
  const unlimited = <span className="dim">unlimited</span>;
  const limits: DescriptionsProps["items"] = [
    { key: "cpu", label: "CPU limit", children: cores ? <Mono>{cores.toFixed(2)} cpus</Mono> : unlimited },
    { key: "mem", label: "Memory limit", children: memory ? <Mono>{formatBytes(memory)}</Mono> : unlimited },
    { key: "pids", label: "PID limit", children: pids ? <Mono>{pids}</Mono> : unlimited },
    {
      key: "rootfs",
      label: "Root filesystem",
      children: <Pill>{ctr.HostConfig?.ReadonlyRootfs ? "read-only" : "writable"}</Pill>,
    },
  ];

  const ports = portRows(ctr.NetworkSettings?.Ports ?? {});
  const mounts = (ctr.Mounts ?? []).map((m, i) => ({
    key: `${m.Destination}-${i}`,
    type: m.Type ?? "",
    source: m.Type === "volume" ? m.Name : m.Source,
    target: m.Destination ?? "",
    mode: m.RW === false ? "ro" : "rw",
  }));
  const networks = Object.entries(ctr.NetworkSettings?.Networks ?? {}).map(
    ([name, n]: [string, NetworkEndpoint]) => ({
      key: name,
      name,
      ip: n.IPAddress ? `${n.IPAddress}/${n.IPPrefixLen}` : "",
      gateway: n.Gateway ?? "",
      mac: n.MacAddress ?? "",
      aliases: [...new Set([...(n.DNSNames ?? []), ...(n.Aliases ?? [])])]
        .filter((alias) => !ctr.Id.startsWith(alias))
        .join(", "),
    }),
  );
  const labels = Object.entries(config?.Labels ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ key: k, k, v }));

  const dash = <span className="dim">—</span>;

  return (
    <div className="tab-stack">
      <div className="toolbar">
        <span className="spacer" />
        <CollapseAllButton allClosed={allClosed} onClick={toggleAll} />
      </div>

      <Section id="general" title="General" {...section}>
        <Descriptions column={1} size="small" bordered items={general} />
      </Section>

      <Section id="health" title="Health check" {...section}>
        {health.length ? (
          <Descriptions column={1} size="small" bordered items={health} />
        ) : (
          <span className="dim">No health check configured for this container.</span>
        )}
      </Section>

      <Section id="limits" title="Resource limits" {...section}>
        <Descriptions column={1} size="small" bordered items={limits} />
      </Section>

      <Section
        id="ports"
        title="Ports"
        {...section}
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            {ports.filter((p) => p.host).length} published
          </span>
        }
      >
        <Table
          size="small"
          pagination={false}
          dataSource={ports}
          locale={{ emptyText: "No exposed ports" }}
          columns={[
            {
              title: "Host",
              dataIndex: "host",
              width: 190,
              render: (v: string | null) =>
                v ? <Mono>{v}</Mono> : <span className="dim">not published</span>,
            },
            { title: "", key: "arrow", width: 30, render: () => <span className="dim">→</span> },
            {
              title: "Container",
              dataIndex: "container",
              width: 130,
              render: (v: string) => <Mono>{v}</Mono>,
            },
            { title: "Protocol", dataIndex: "proto", width: 100, render: (v: string) => <Pill>{v}</Pill> },
            {
              title: "",
              key: "open",
              align: "right",
              render: (_: unknown, row: PortRow) =>
                row.url ? (
                  <>
                    <CopyButton text={row.url} what="URL" />
                    <Button
                      type="text"
                      size="small"
                      icon={<ExportOutlined />}
                      onClick={() => void openUrl(row.url as string)}
                    >
                      Open
                    </Button>
                  </>
                ) : row.host ? (
                  <CopyButton text={row.host} what="Address" />
                ) : null,
            },
          ]}
        />
      </Section>

      <Section id="mounts" title="Mounts" {...section}>
        <Table
          size="small"
          pagination={false}
          dataSource={mounts}
          locale={{ emptyText: "No mounts" }}
          columns={[
            {
              title: "Type",
              dataIndex: "type",
              width: 90,
              render: (v: string) => <Pill tone={MOUNT_TONE[v] ?? "neutral"}>{v}</Pill>,
            },
            { title: "Source", dataIndex: "source", render: (v?: string) => (v ? <Mono>{v}</Mono> : dash) },
            { title: "Target", dataIndex: "target", render: (v: string) => <Mono>{v}</Mono> },
            {
              title: "Mode",
              dataIndex: "mode",
              width: 70,
              render: (v: string) => <Pill tone={v === "ro" ? "neutral" : "green"}>{v}</Pill>,
            },
          ]}
        />
      </Section>

      <Section id="networks" title="Networks" {...section}>
        <Table
          size="small"
          pagination={false}
          dataSource={networks}
          locale={{ emptyText: `Network mode: ${ctr.HostConfig?.NetworkMode ?? "none"}` }}
          columns={[
            {
              title: "Network",
              dataIndex: "name",
              render: (v: string) => <span style={{ color: "var(--paper)" }}>{v}</span>,
            },
            {
              title: "IP address",
              dataIndex: "ip",
              width: 150,
              render: (v: string) => (v ? <Mono>{v}</Mono> : dash),
            },
            {
              title: "Gateway",
              dataIndex: "gateway",
              width: 130,
              render: (v: string) => (v ? <span className="mono dim">{v}</span> : dash),
            },
            {
              title: "MAC",
              dataIndex: "mac",
              width: 160,
              render: (v: string) => (v ? <span className="mono dim">{v}</span> : dash),
            },
            {
              title: "Aliases",
              dataIndex: "aliases",
              render: (v: string) => (v ? <span className="mono dim">{v}</span> : dash),
            },
          ]}
        />
      </Section>

      <Section
        id="labels"
        title="Labels"
        {...section}
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            {labels.length}
          </span>
        }
      >
        <Table
          size="small"
          pagination={false}
          showHeader={false}
          dataSource={labels}
          locale={{ emptyText: "No labels" }}
          columns={[
            {
              title: "Key",
              dataIndex: "k",
              width: 330,
              render: (v: string) => <span className="mono dim">{v}</span>,
            },
            { title: "Value", dataIndex: "v", render: (v: string) => <Mono>{v}</Mono> },
          ]}
        />
      </Section>
    </div>
  );
}
