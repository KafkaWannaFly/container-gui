import { ClearOutlined, CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMount } from "ahooks";
import { App, Button, Empty, Input, Popconfirm, Spin, Table, type TableColumnsType, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePageCommands } from "../../components/CommandPalette";
import { MetricCard, Mono, Pill, RowActions, StateDot } from "../../components/ui";
import { useSearchHotkey } from "../../hooks/useSearchHotkey";
import { queryKeys } from "../../lib/queryClient";
import { listVolumes, pruneVolumes, refreshVolumeSizes, removeVolume } from "../../services/tauriApi";
import { formatBytes, middleEllipsis, type VolumeItem } from "../../types/docker";

const MAX_NAME_LEN = 30;
const MAX_MOUNT_LEN = 38;

export default function VolumeListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const searchRef = useSearchHotkey();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<React.Key[]>([]);

  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({ queryKey: queryKeys.volumes(), queryFn: listVolumes });

  // Sizes come from the cache right away; each visit re-measures in the background.
  const refresh = useMutation({
    mutationFn: refreshVolumeSizes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.volumes() }),
    onError: (err: Error) => message.error(err.message),
  });
  useMount(() => refresh.mutate());

  const removeMutation = useMutation({
    mutationFn: ({ name, force }: { name: string; force: boolean }) => removeVolume(name, force),
    onSuccess: async (_, { name }) => {
      // Drop the row right away so it doesn't linger until the refetch lands.
      queryClient.setQueryData<VolumeItem[]>(queryKeys.volumes(), (old) =>
        old?.filter((v) => v.name !== name),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const removeName = (name: string) => {
    setPending((prev) => new Set(prev).add(name));
    return removeMutation.mutateAsync({ name, force: false }).finally(() =>
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      }),
    );
  };

  const rows = useMemo(
    () => (data ?? []).filter((v) => v.name.toLowerCase().includes(search.toLowerCase())),
    [data, search],
  );
  const orphans = (data ?? []).filter((v) => !v.inUse);
  const reclaimable = orphans.reduce((sum, v) => sum + (v.sizeBytes ?? 0), 0);
  const unmeasured = orphans.filter((v) => v.sizeBytes === null).length;

  const deleteVolume = (row: VolumeItem) =>
    modal.confirm({
      title: "Delete volume?",
      centered: true,
      okText: "Delete",
      okType: "danger",
      content: (
        <span>
          Data in <Mono>{middleEllipsis(row.name, MAX_NAME_LEN)}</Mono> will be permanently lost.
        </span>
      ),
      onOk: () => {
        void removeName(row.name).catch(() => undefined);
      },
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
              <div key={o.name} title={o.name}>
                {middleEllipsis(o.name, MAX_NAME_LEN)}
              </div>
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
    void Promise.all(names.map((name) => removeName(name))).then(
      () => message.success(`Deleted ${names.length} volume(s)`),
      () => undefined,
    );
    setSelected([]);
  };

  usePageCommands([
    {
      id: "volumes.delete-selected",
      group: "Selected",
      label: "Delete selected volumes",
      keywords: "delete remove selected volumes",
      icon: <DeleteOutlined />,
      danger: true,
      badge: `${selected.length} selected`,
      disabled: !selected.length,
      action: () => {
        modal.confirm({
          title: `Delete ${selected.length} selected volume(s)?`,
          centered: true,
          okText: "Delete",
          okType: "danger",
          content: "All data in the selected volumes will be permanently lost.",
          onOk: deleteSelected,
        });
      },
    },
  ]);

  const columns: TableColumnsType<VolumeItem> = [
    {
      title: "Name",
      dataIndex: "name",
      render: (value: string, row) => {
        const short = middleEllipsis(value, MAX_NAME_LEN);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 10,
              }}
            >
              {pending.has(value) ? (
                <Spin size="small" />
              ) : row.inUse ? (
                <StateDot state="running" label={`Mounted by ${row.refCount} container(s)`} />
              ) : (
                <StateDot state="orphaned" label="Orphaned" />
              )}
            </span>
            <Tooltip title={short !== value ? value : undefined}>
              <Link
                to={`/volumes/${encodeURIComponent(value)}`}
                className="row-link"
                style={{ whiteSpace: "nowrap" }}
              >
                {short}
              </Link>
            </Tooltip>
          </div>
        );
      },
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
      render: (value: string) => {
        const short = middleEllipsis(value, MAX_MOUNT_LEN);
        return (
          <Tooltip title={short !== value ? value : undefined}>
            <span className="mono dim" style={{ whiteSpace: "nowrap" }}>
              {short}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "Size",
      dataIndex: "sizeBytes",
      width: 100,
      render: (value: number | null, row) => {
        if (value === null) {
          return refresh.isPending ? <Spin size="small" /> : <span className="dim">—</span>;
        }
        const measured = row.sizeMeasuredAt
          ? `Measured ${new Date(row.sizeMeasuredAt).toLocaleString()}`
          : undefined;
        return (
          <span className="mono" title={measured} style={{ whiteSpace: "nowrap" }}>
            {value === 0 ? "0 B" : formatBytes(value)}
          </span>
        );
      },
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      width: 130,
      render: (value: string) => (
        <span className="dim" style={{ whiteSpace: "nowrap" }}>
          {value ? value.slice(0, 10) : "—"}
        </span>
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
                disabled: row.inUse || pending.has(row.name),
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
          suffix={
            unmeasured
              ? `${orphans.length} orphaned · ${unmeasured} unmeasured`
              : `${orphans.length} orphaned`
          }
        />
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Input
            ref={searchRef}
            placeholder="Search volumes"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          <span className="spacer" />
          {refresh.isPending ? (
            <span className="dim" style={{ fontSize: 12 }}>
              Measuring sizes…
            </span>
          ) : null}
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
