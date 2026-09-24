import { ClearOutlined, CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Popconfirm, Table, type TableColumnsType } from "antd";
import { useMemo, useState } from "react";
import { MetricCard, Mono, Pill, RowActions } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import { listVolumes, pruneVolumes, removeVolume } from "../../services/tauriApi";
import { formatBytes, type VolumeItem } from "../../types/docker";

export default function VolumeListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<React.Key[]>([]);

  const { data, isLoading } = useQuery({ queryKey: queryKeys.volumes(), queryFn: listVolumes });

  const removeMutation = useMutation({
    mutationFn: ({ name, force }: { name: string; force: boolean }) => removeVolume(name, force),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const rows = useMemo(
    () => (data ?? []).filter((v) => v.name.toLowerCase().includes(search.toLowerCase())),
    [data, search],
  );
  const orphans = (data ?? []).filter((v) => !v.inUse);
  const reclaimable = orphans.reduce((sum, v) => sum + v.sizeBytes, 0);

  const deleteVolume = (row: VolumeItem) =>
    modal.confirm({
      title: "Delete volume?",
      centered: true,
      okText: "Delete",
      okType: "danger",
      content: (
        <span>
          Data in <Mono>{row.name}</Mono> will be permanently lost.
        </span>
      ),
      onOk: () => removeMutation.mutateAsync({ name: row.name, force: false }),
    });

  const prune = () =>
    modal.confirm({
      title: "Prune unused volumes",
      centered: true,
      okText: "Prune",
      okType: "danger",
      width: 480,
      content: (
        <div>
          <p style={{ color: "var(--mist)" }}>
            {orphans.length} volume(s) are not attached to any container:
          </p>
          <div className="card subtle mono" style={{ maxHeight: 200, overflow: "auto" }}>
            {orphans.map((o) => (
              <div key={o.name}>{o.name}</div>
            ))}
          </div>
          <p className="dim" style={{ marginBottom: 0, fontSize: 12 }}>
            This permanently deletes data.
          </p>
        </div>
      ),
      onOk: async () => {
        const reclaimed = await pruneVolumes();
        void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
        message.success(`Reclaimed ${formatBytes(reclaimed)}`);
      },
    });

  const deleteSelected = () => {
    const names = (data ?? []).filter((v) => selected.includes(v.name) && !v.inUse).map((v) => v.name);
    void Promise.all(names.map((name) => removeMutation.mutateAsync({ name, force: false }))).then(
      () => message.success(`Deleted ${names.length} volume(s)`),
      () => undefined,
    );
    setSelected([]);
  };

  const columns: TableColumnsType<VolumeItem> = [
    {
      title: "Name",
      dataIndex: "name",
      render: (value: string) => <span style={{ color: "var(--paper)" }}>{value}</span>,
    },
    {
      title: "Driver",
      dataIndex: "driver",
      width: 90,
      render: (value: string) => <Pill tone={value === "local" ? "neutral" : "teal"}>{value}</Pill>,
    },
    {
      title: "Mountpoint",
      dataIndex: "mountpoint",
      render: (value: string) => (
        <span
          className="mono dim"
          style={{
            display: "inline-block",
            maxWidth: 360,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            verticalAlign: "bottom",
          }}
        >
          {value}
        </span>
      ),
    },
    {
      title: "Size",
      dataIndex: "sizeBytes",
      width: 100,
      render: (value: number) => <span className="mono">{formatBytes(value)}</span>,
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      width: 130,
      render: (value: string) => <span className="dim">{value ? value.slice(0, 10) : "—"}</span>,
    },
    {
      title: "In use",
      dataIndex: "inUse",
      width: 140,
      render: (_, row) =>
        row.inUse ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Pill tone="green">mounted</Pill>
            <Mono>{row.refCount} ref</Mono>
          </span>
        ) : (
          <Pill>orphaned</Pill>
        ),
    },
    {
      title: "",
      key: "actions",
      width: 56,
      align: "right",
      render: (_, row) => (
        <RowActions
          groups={[
            [
              {
                key: "copy",
                label: "Copy mountpoint",
                icon: <CopyOutlined />,
                onClick: () => void navigator.clipboard?.writeText(row.mountpoint),
              },
            ],
            [
              {
                key: "delete",
                label: "Delete",
                icon: <DeleteOutlined />,
                danger: true,
                disabled: row.inUse,
                onClick: () => deleteVolume(row),
              },
            ],
          ]}
        />
      ),
    },
  ];

  return (
    <div className="page">
      <div className="metrics">
        <MetricCard
          label="Volumes in use"
          value={(data?.length ?? 0) - orphans.length}
          suffix={`of ${data?.length ?? 0}`}
        />
        <MetricCard
          label="Reclaimable"
          value={formatBytes(reclaimable)}
          suffix={`${orphans.length} orphaned`}
        />
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search volumes"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          <span className="spacer" />
          {selected.length > 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>
              {selected.length} selected
            </span>
          ) : null}
          <Popconfirm
            title={`Delete ${selected.length} volume(s)?`}
            okText="Delete"
            okType="danger"
            onConfirm={deleteSelected}
            disabled={!selected.length}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!selected.length}>
              Delete
            </Button>
          </Popconfirm>
          <Button icon={<ClearOutlined />} onClick={prune}>
            Prune unused{orphans.length ? ` (${orphans.length})` : ""}
          </Button>
        </div>

        <Table
          size="small"
          rowKey="name"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            getCheckboxProps: (row) => ({ disabled: row.inUse }),
          }}
          locale={{ emptyText: <Empty description="No volumes" /> }}
        />
      </div>
    </div>
  );
}
