import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Table,
  Tooltip,
  type TableColumnsType,
} from "antd";
import {
  CaretRightOutlined,
  DeleteOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { formatDistanceToNow } from "date-fns";
import { MetricCard, Mono, RowActions, StateDot } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import { containerAction, getSystemInfo, listContainerStats, listContainers } from "../../services/tauriApi";
import {
  formatBytes,
  portLabel,
  shortId,
  type ContainerStats,
  type ContainerSummary,
} from "../../types/docker";
import ContainerInspectorDrawer from "./components/ContainerInspectorDrawer";
import LiveLogModal from "./components/LiveLogModal";

type ActionKind = "start" | "stop" | "restart" | "kill" | "remove";

type ContainerRow = ContainerSummary & { kind: "container"; key: string };
type ComposeGroupRow = { kind: "group"; key: string; project: string; children: ContainerRow[] };
type Row = ContainerRow | ComposeGroupRow;

const STATS_INTERVAL_MS = 2_000;

export default function ContainerListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [logTarget, setLogTarget] = useState<ContainerSummary | null>(null);
  const [expanded, setExpanded] = useState<React.Key[]>([]);
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
    const ids = selectedIds;
    void Promise.all(ids.map((id) => actionMutation.mutateAsync({ id, action }))).then(
      () => message.success(`${action} applied to ${ids.length} container(s)`),
      () => undefined,
    );
    setSelected([]);
  };

  const confirmBatchRemove = () => {
    modal.confirm({
      title: `Remove ${selectedIds.length} container${selectedIds.length > 1 ? "s" : ""}?`,
      centered: true,
      okText: "Remove",
      okType: "danger",
      content: "Selected containers will be stopped and deleted.",
      onOk: () => runBatch("remove"),
    });
  };

  const columns: TableColumnsType<Row> = [
    {
      title: "Name",
      key: "name",
      render: (_, row) =>
        row.kind === "group" ? (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: "var(--paper)" }}>{row.project}</span>
            <span className="mono dim">{row.children.length} containers</span>
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ display: "inline-flex", height: 20, alignItems: "center" }}>
              <StateDot state={row.state} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--paper)" }}>{row.names[0] ?? shortId(row.id)}</span>
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
        return <span className="mono">{value == null ? "—" : `${value.toFixed(1)}%`}</span>;
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
        return <span className="mono">{value ? formatBytes(value) : "—"}</span>;
      },
    },
    {
      title: "Ports",
      key: "ports",
      render: (_, row) =>
        row.kind === "group" ? (
          <span className="mono dim">
            {row.children.reduce((sum, child) => sum + child.ports.length, 0)} port mappings
          </span>
        ) : row.ports.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {row.ports.map((port) => (
              <span key={portLabel(port)} className="mono dim">
                {portLabel(port)}
              </span>
            ))}
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
      key: "actions",
      width: 56,
      align: "right",
      render: (_, row) => {
        if (row.kind === "group") return null;
        const running = row.state === "running";
        return (
          <RowActions
            groups={[
              [
                {
                  key: "start",
                  label: "Start",
                  icon: <PlayCircleOutlined />,
                  disabled: running,
                  onClick: () => actionMutation.mutate({ id: row.id, action: "start" }),
                },
                {
                  key: "stop",
                  label: "Stop",
                  icon: <PauseCircleOutlined />,
                  disabled: !running,
                  onClick: () => actionMutation.mutate({ id: row.id, action: "stop" }),
                },
                {
                  key: "restart",
                  label: "Restart",
                  icon: <ReloadOutlined />,
                  onClick: () => actionMutation.mutate({ id: row.id, action: "restart" }),
                },
                {
                  key: "kill",
                  label: "Terminate",
                  icon: <StopOutlined />,
                  danger: true,
                  disabled: !running,
                  onClick: () => actionMutation.mutate({ id: row.id, action: "kill" }),
                },
              ],
              [
                {
                  key: "logs",
                  label: "View logs",
                  icon: <FileTextOutlined />,
                  onClick: () => setLogTarget(row),
                },
                {
                  key: "inspect",
                  label: "Inspect",
                  icon: <InfoCircleOutlined />,
                  onClick: () => setInspectId(row.id),
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
                      onOk: () => actionMutation.mutateAsync({ id: row.id, action: "remove" }),
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
          value={stats.data ? formatBytes(totals.memory) : "—"}
          suffix={`/ ${system.data ? formatBytes(system.data.memoryTotal) : "—"}`}
        />
        <MetricCard
          label="CPU"
          value={stats.data ? (totals.cpu / 100).toFixed(1) : "—"}
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
                disabled={!selectedIds.length}
                onClick={() => runBatch("start")}
              />
            </Tooltip>
            <Tooltip title="Stop">
              <Button
                icon={<PauseCircleOutlined />}
                disabled={!selectedIds.length}
                onClick={() => runBatch("stop")}
              />
            </Tooltip>
            <Tooltip title="Restart">
              <Button
                icon={<ReloadOutlined />}
                disabled={!selectedIds.length}
                onClick={() => runBatch("restart")}
              />
            </Tooltip>
            <Popconfirm
              title={`Remove ${selectedIds.length} container(s)?`}
              okText="Remove"
              okType="danger"
              onConfirm={confirmBatchRemove}
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

      <ContainerInspectorDrawer id={inspectId} onClose={() => setInspectId(null)} />
      <LiveLogModal container={logTarget} onClose={() => setLogTarget(null)} />
    </div>
  );
}
