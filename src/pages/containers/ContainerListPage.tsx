import {
  CaretRightOutlined,
  DeleteOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  MinusCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Spin,
  Table,
  type TableColumnsType,
  Tooltip,
} from "antd";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CopyButton, MetricCard, Mono, RowActions, StateDot } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import type { ContainerActionKind } from "../../services/tauriApi";
import { containerAction, getSystemInfo, listContainerStats, listContainers } from "../../services/tauriApi";
import {
  type ContainerStats,
  type ContainerSummary,
  formatBytes,
  type PortMapping,
  portLabel,
  portUrl,
  shortId,
} from "../../types/docker";

type ActionKind = ContainerActionKind;

/** Which container states each action is valid for. */
function actionApplies(action: ActionKind, state: string): boolean {
  switch (action) {
    case "start":
      return state === "exited" || state === "created" || state === "dead";
    case "stop":
    case "restart":
    case "kill":
    case "pause":
      return state === "running";
    case "unpause":
      return state === "paused";
    case "remove":
      return true;
  }
}

type ContainerRow = ContainerSummary & { kind: "container"; key: string };
type ComposeGroupRow = { kind: "group"; key: string; project: string; children: ContainerRow[] };
type Row = ContainerRow | ComposeGroupRow;

const STATS_INTERVAL_MS = 2_000;

/** Docker lists a binding once for IPv4 and once for IPv6; show it once. */
function uniquePorts(ports: PortMapping[]): PortMapping[] {
  return ports.filter(
    (port) =>
      port.ip !== "::" ||
      !ports.some((p) => p.ip === "0.0.0.0" && p.publicPort === port.publicPort && p.type === port.type),
  );
}

export default function ContainerListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const [pending, setPending] = useState<Record<string, ActionKind>>({});
  const seenGroups = useRef<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.containers(true),
    queryFn: () => listContainers(true),
  });

  const liveCount = (data ?? []).filter((c) => c.state === "running" || c.state === "paused").length;

  const stats = useQuery({
    queryKey: queryKeys.containerStats(),
    queryFn: () => listContainerStats(true),
    refetchInterval: STATS_INTERVAL_MS,
    enabled: liveCount > 0,
  });

  const system = useQuery({
    queryKey: queryKeys.system(),
    queryFn: getSystemInfo,
    refetchInterval: 15_000,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ActionKind }) => containerAction(id, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["containers"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const clearPending = (id: string) =>
    setPending((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const runAction = (id: string, action: ActionKind) => {
    setPending((prev) => ({ ...prev, [id]: action }));
    void actionMutation
      .mutateAsync({ id, action })
      .catch(() => undefined)
      .finally(() => clearPending(id));
  };

  const rows = useMemo(() => {
    const list = data ?? [];
    return list.filter((c) => {
      const name = c.names[0] ?? "";
      const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || c.image.includes(search);
      const matchesState = state === "all" || c.state === state;
      return matchesSearch && matchesState;
    });
  }, [data, search, state]);

  const statsById = useMemo(() => {
    const map = new Map<string, ContainerStats>();
    for (const item of stats.data ?? []) map.set(item.id, item);
    return map;
  }, [stats.data]);

  // Compose members collapse into one parent row. Single-member projects
  // stay flat so they don't nest for nothing.
  const tree = useMemo<Row[]>(() => {
    const buckets = new Map<string, ContainerRow[]>();
    const order: ({ type: "container"; row: ContainerRow } | { type: "group"; project: string })[] = [];

    for (const container of rows) {
      const row: ContainerRow = { ...container, kind: "container", key: container.id };
      const project = container.composeProject;
      if (!project) {
        order.push({ type: "container", row });
        continue;
      }
      if (!buckets.has(project)) {
        buckets.set(project, []);
        order.push({ type: "group", project });
      }
      buckets.get(project)?.push(row);
    }

    const result: Row[] = [];
    for (const entry of order) {
      if (entry.type === "container") {
        result.push(entry.row);
        continue;
      }
      const children = buckets.get(entry.project) ?? [];
      if (children.length >= 2) {
        result.push({ kind: "group", key: `compose:${entry.project}`, project: entry.project, children });
      } else {
        result.push(...children);
      }
    }
    return result;
  }, [rows]);

  // Expand newly discovered groups, keep the user's collapse choices.
  useEffect(() => {
    const keys = tree.flatMap((row) => (row.kind === "group" ? [row.key] : []));
    setExpanded((prev) => {
      const kept = prev.filter((key) => keys.includes(String(key)));
      const added = keys.filter((key) => !seenGroups.current.has(key));
      added.forEach((key) => {
        seenGroups.current.add(key);
      });
      return [...kept, ...added];
    });
  }, [tree]);

  // antd tree selection (checkStrictly: false) keeps the group key selected
  // alongside its children; only real container ids may reach the API.
  const containerIds = useMemo(() => new Set((data ?? []).map((c) => c.id)), [data]);
  const selectedIds = useMemo(
    () => selected.map(String).filter((id) => containerIds.has(id)),
    [selected, containerIds],
  );
  const stateById = useMemo(() => new Map((data ?? []).map((c) => [c.id, c.state])), [data]);
  // Batch skips containers the action can't apply to rather than erroring.
  const eligibleIds = (action: ActionKind) =>
    selectedIds.filter((id) => {
      const state = stateById.get(id);
      return state != null && actionApplies(action, state);
    });

  const totals = useMemo(() => {
    let cpu = 0;
    let memory = 0;
    for (const item of stats.data ?? []) {
      cpu += item.cpuPercent;
      memory += item.memoryUsage;
    }
    return { cpu, memory };
  }, [stats.data]);

  const groupTotals = (children: ContainerRow[]) =>
    children.reduce(
      (acc, child) => {
        const item = statsById.get(child.id);
        acc.cpu += item?.cpuPercent ?? 0;
        acc.memory += item?.memoryUsage ?? 0;
        return acc;
      },
      { cpu: 0, memory: 0 },
    );

  const runBatch = (action: ActionKind) => {
    const ids = eligibleIds(action);
    for (const id of ids) runAction(id, action);
    // Remove drops the rows; other actions keep the selection for follow-ups.
    if (action === "remove") setSelected([]);
  };

  const columns: TableColumnsType<Row> = [
    {
      title: "Name",
      key: "name",
      render: (_, row) =>
        row.kind === "group" ? (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
            <Link to={`/containers/group/${encodeURIComponent(row.project)}`} className="row-link">
              {row.project}
            </Link>
            <span className="mono dim">{row.children.length} containers</span>
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span
              style={{
                display: "inline-flex",
                alignSelf: "stretch",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 10,
              }}
            >
              {pending[row.id] ? <Spin size="small" /> : <StateDot state={row.state} />}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Link to={`/containers/${row.id}`} className="row-link">
                {row.names[0] ?? shortId(row.id)}
              </Link>
              <span className="mono">{row.image}</span>
              <span className="mono dim">{shortId(row.id)}</span>
            </div>
          </div>
        ),
    },
    {
      title: "CPU",
      key: "cpu",
      width: 90,
      align: "right",
      render: (_, row) => {
        const value =
          row.kind === "group" ? groupTotals(row.children).cpu : statsById.get(row.id)?.cpuPercent;
        return <span className="mono">{value == null ? "—" : `${(value / 100).toFixed(2)}`}</span>;
      },
    },
    {
      title: "Memory",
      key: "memory",
      width: 110,
      align: "right",
      render: (_, row) => {
        const value =
          row.kind === "group" ? groupTotals(row.children).memory : statsById.get(row.id)?.memoryUsage;
        return <span className="mono">{value ? formatBytes(value, 2) : "—"}</span>;
      },
    },
    {
      title: "Ports",
      key: "ports",
      render: (_, row) =>
        row.kind === "group" ? (
          <span className="mono dim">
            {row.children.reduce((sum, child) => sum + uniquePorts(child.ports).length, 0)} port mappings
          </span>
        ) : row.ports.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {uniquePorts(row.ports).map((port) => {
              if (!port.publicPort || port.type !== "tcp") {
                return (
                  <span key={portLabel(port)} className="mono dim">
                    {portLabel(port)}
                  </span>
                );
              }
              const url = portUrl(port.publicPort, port.privatePort);
              return (
                <span key={portLabel(port)} className="mono dim port-row">
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
        ),
    },
    {
      title: "Created",
      key: "created",
      width: 130,
      render: (_, row) =>
        row.kind === "container" ? (
          <span className="dim">
            {formatDistanceToNow(new Date(row.created * 1000), { addSuffix: true })}
          </span>
        ) : null,
    },
    {
      title: "",
      key: "power",
      width: 48,
      align: "right",
      render: (_, row) => {
        if (row.kind === "group") return null;
        if (pending[row.id]) return <Spin size="small" />;
        if (actionApplies("stop", row.state)) {
          return (
            <Tooltip title="Stop">
              <Button
                type="text"
                size="small"
                aria-label="Stop"
                icon={<MinusCircleOutlined />}
                onClick={() => runAction(row.id, "stop")}
              />
            </Tooltip>
          );
        }
        if (actionApplies("start", row.state)) {
          return (
            <Tooltip title="Start">
              <Button
                type="text"
                size="small"
                aria-label="Start"
                icon={<PlayCircleOutlined />}
                onClick={() => runAction(row.id, "start")}
              />
            </Tooltip>
          );
        }
        return null;
      },
    },
    {
      title: "",
      key: "actions",
      width: 56,
      align: "right",
      render: (_, row) => {
        if (row.kind === "group") return null;
        const paused = row.state === "paused";
        return (
          <RowActions
            groups={[
              [
                {
                  key: "start",
                  label: "Start",
                  icon: <PlayCircleOutlined />,
                  disabled: !actionApplies("start", row.state),
                  onClick: () => runAction(row.id, "start"),
                },
                {
                  key: "stop",
                  label: "Stop",
                  icon: <MinusCircleOutlined />,
                  disabled: !actionApplies("stop", row.state),
                  onClick: () => runAction(row.id, "stop"),
                },
                {
                  key: "restart",
                  label: "Restart",
                  icon: <ReloadOutlined />,
                  disabled: !actionApplies("restart", row.state),
                  onClick: () => runAction(row.id, "restart"),
                },
                {
                  key: "kill",
                  label: "Terminate",
                  icon: <StopOutlined />,
                  danger: true,
                  disabled: !actionApplies("kill", row.state),
                  onClick: () => runAction(row.id, "kill"),
                },
                {
                  key: paused ? "unpause" : "pause",
                  label: paused ? "Resume" : "Pause",
                  icon: paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />,
                  disabled: !actionApplies(paused ? "unpause" : "pause", row.state),
                  onClick: () => runAction(row.id, paused ? "unpause" : "pause"),
                },
              ],
              [
                {
                  key: "logs",
                  label: "View logs",
                  icon: <FileTextOutlined />,
                  onClick: () => navigate(`/containers/${row.id}?tab=logs`),
                },
                {
                  key: "inspect",
                  label: "Details",
                  icon: <InfoCircleOutlined />,
                  onClick: () => navigate(`/containers/${row.id}`),
                },
              ],
              [
                {
                  key: "remove",
                  label: "Remove",
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: () =>
                    modal.confirm({
                      title: "Remove container?",
                      centered: true,
                      okText: "Remove",
                      okType: "danger",
                      content: (
                        <span>
                          <Mono>{row.names[0] ?? shortId(row.id)}</Mono> will be stopped and deleted.
                        </span>
                      ),
                      onOk: () => runAction(row.id, "remove"),
                    }),
                },
              ],
            ]}
          />
        );
      },
    },
  ];

  const runningCount = (data ?? []).filter((c) => c.state === "running").length;

  return (
    <div className="page">
      <div className="metrics">
        <MetricCard label="Running" value={runningCount} suffix={`of ${data?.length ?? 0}`} />
        <MetricCard
          label="Memory"
          value={stats.data ? formatBytes(totals.memory, 2) : "—"}
          suffix={`/ ${system.data ? formatBytes(system.data.memoryTotal, 2) : "—"}`}
        />
        <MetricCard
          label="CPU"
          value={stats.data ? (totals.cpu / 100).toFixed(2) : "—"}
          suffix={`/ ${system.data?.cpus ?? "—"} cpu`}
        />
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search containers"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          <Segmented
            value={state}
            onChange={(value) => setState(String(value))}
            options={[
              { label: "All", value: "all" },
              { label: "Running", value: "running" },
              { label: "Paused", value: "paused" },
              { label: "Exited", value: "exited" },
            ]}
          />
          <span className="spacer" />
          <span
            className="dim"
            style={{
              fontSize: 12,
              minWidth: 76,
              textAlign: "right",
              visibility: selectedIds.length > 0 ? "visible" : "hidden",
            }}
          >
            {selectedIds.length} selected
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Tooltip title="Refresh">
              <Button
                icon={<SyncOutlined />}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["containers"] })}
              />
            </Tooltip>
            <Tooltip title="Start">
              <Button
                icon={<PlayCircleOutlined />}
                disabled={!eligibleIds("start").length}
                onClick={() => runBatch("start")}
              />
            </Tooltip>
            <Tooltip title="Stop">
              <Button
                icon={<MinusCircleOutlined />}
                disabled={!eligibleIds("stop").length}
                onClick={() => runBatch("stop")}
              />
            </Tooltip>
            <Tooltip title="Pause">
              <Button
                icon={<PauseCircleOutlined />}
                disabled={!eligibleIds("pause").length}
                onClick={() => runBatch("pause")}
              />
            </Tooltip>
            <Tooltip title="Restart">
              <Button
                icon={<ReloadOutlined />}
                disabled={!eligibleIds("restart").length}
                onClick={() => runBatch("restart")}
              />
            </Tooltip>
            <Popconfirm
              title={`Remove ${selectedIds.length} container(s)?`}
              okText="Remove"
              okType="danger"
              onConfirm={() => runBatch("remove")}
              disabled={!selectedIds.length}
            >
              <Tooltip title="Remove">
                <Button danger icon={<DeleteOutlined />} disabled={!selectedIds.length} />
              </Tooltip>
            </Popconfirm>
          </div>
        </div>

        <Table<Row>
          size="small"
          rowKey="key"
          loading={isLoading}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected([...keys]),
            checkStrictly: false,
          }}
          expandable={{
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setExpanded([...keys]),
            rowExpandable: (row) => row.kind === "group",
            indentSize: 20,
            expandIcon: ({ expanded: isExpanded, onExpand, record }) =>
              record.kind === "group" ? (
                <CaretRightOutlined
                  onClick={(event) => onExpand(record, event)}
                  style={{
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--fog)",
                    marginRight: 2,
                    transform: isExpanded ? "rotate(90deg)" : "none",
                    transition: "transform 0.15s ease",
                  }}
                />
              ) : null,
          }}
          columns={columns}
          dataSource={tree}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="No containers" /> }}
        />
      </div>
    </div>
  );
}
