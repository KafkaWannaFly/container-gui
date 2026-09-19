import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Popconfirm, Segmented, Table, type TableColumnsType } from "antd";
import {
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
import { MetricCard, Mono, RowActions, StateDot, StateTag } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import { containerAction, listContainers } from "../../services/tauriApi";
import { portLabel, shortId, type ContainerSummary } from "../../types/docker";
import ContainerInspectorDrawer from "./components/ContainerInspectorDrawer";
import LiveLogModal from "./components/LiveLogModal";

type ActionKind = "start" | "stop" | "restart" | "kill" | "remove";

export default function ContainerListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [logTarget, setLogTarget] = useState<ContainerSummary | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.containers(true),
    queryFn: () => listContainers(true),
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

  const runningCount = (data ?? []).filter((c) => c.state === "running").length;
  const pausedCount = (data ?? []).filter((c) => c.state === "paused").length;
  const exitedCount = (data ?? []).filter((c) => c.state === "exited").length;

  const runBatch = (action: ActionKind) => {
    const ids = selected.map(String);
    void Promise.all(ids.map((id) => actionMutation.mutateAsync({ id, action }))).then(
      () => message.success(`${action} applied to ${ids.length} container(s)`),
      () => undefined,
    );
    setSelected([]);
  };

  const confirmBatchRemove = () => {
    modal.confirm({
      title: `Remove ${selected.length} container${selected.length > 1 ? "s" : ""}?`,
      centered: true,
      okText: "Remove",
      okType: "danger",
      content: "Selected containers will be stopped and deleted.",
      onOk: () => runBatch("remove"),
    });
  };

  const columns: TableColumnsType<ContainerSummary> = [
    {
      title: "",
      dataIndex: "state",
      width: 30,
      render: (_, row) => <StateDot state={row.state} />,
    },
    {
      title: "Name",
      dataIndex: "names",
      render: (_, row) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ color: "var(--paper)" }}>{row.names[0] ?? shortId(row.id)}</span>
          <span className="mono">{row.image}</span>
          <span className="mono dim">{shortId(row.id)}</span>
        </div>
      ),
    },
    {
      title: "State",
      dataIndex: "state",
      width: 110,
      render: (_, row) => <StateTag state={row.state} />,
    },
    {
      title: "Ports",
      dataIndex: "ports",
      render: (_, row) =>
        row.ports.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {row.ports.map((p) => (
              <span key={`${p.privatePort}-${p.publicPort}`} className="mono dim">
                {portLabel(p)}
              </span>
            ))}
          </div>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      title: "Created",
      dataIndex: "created",
      width: 130,
      render: (value: number) => (
        <span className="dim">{formatDistanceToNow(new Date(value * 1000), { addSuffix: true })}</span>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 56,
      align: "right",
      render: (_, row) => {
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
                { key: "logs", label: "View logs", icon: <FileTextOutlined />, onClick: () => setLogTarget(row) },
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

  return (
    <div className="page">
      <div className="metrics">
        <MetricCard label="Running" value={runningCount} suffix={`of ${data?.length ?? 0}`} />
        <MetricCard label="Paused" value={pausedCount} />
        <MetricCard label="Exited" value={exitedCount} />
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
          {selected.length > 0 ? <span className="dim" style={{ fontSize: 12 }}>{selected.length} selected</span> : null}
          <Button
            icon={<SyncOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["containers"] })}
          >
            Refresh
          </Button>
          <Button icon={<PlayCircleOutlined />} disabled={!selected.length} onClick={() => runBatch("start")}>
            Start
          </Button>
          <Button icon={<PauseCircleOutlined />} disabled={!selected.length} onClick={() => runBatch("stop")}>
            Stop
          </Button>
          <Button icon={<ReloadOutlined />} disabled={!selected.length} onClick={() => runBatch("restart")}>
            Restart
          </Button>
          <Popconfirm
            title={`Remove ${selected.length} container(s)?`}
            okText="Remove"
            okType="danger"
            onConfirm={confirmBatchRemove}
            disabled={!selected.length}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!selected.length}>
              Remove
            </Button>
          </Popconfirm>
        </div>

        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="No containers" /> }}
        />
      </div>

      <ContainerInspectorDrawer id={inspectId} onClose={() => setInspectId(null)} />

      <LiveLogModal container={logTarget} onClose={() => setLogTarget(null)} />
    </div>
  );
}
