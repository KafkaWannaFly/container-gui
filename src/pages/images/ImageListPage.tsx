import {
  ClearOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  HistoryOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Popconfirm, Table, type TableColumnsType } from "antd";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { MetricCard, Mono, Pill, RowActions } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import { listImages, pruneImages, removeImage } from "../../services/tauriApi";
import { formatBytes, type ImageItem, shortId } from "../../types/docker";
import LayerHistoryModal from "./components/LayerHistoryModal";
import PullImageModal from "./components/PullImageModal";
import TagImageModal from "./components/TagImageModal";

interface Row extends ImageItem {
  repo: string;
  tags: string[];
  dangling: boolean;
  used: boolean;
}

function describe(image: ImageItem): Row {
  const valid = image.repoTags.filter((t) => t && !t.startsWith("<none>"));
  const dangling = valid.length === 0;
  const repo = dangling ? "<none>" : valid[0].split(":")[0];
  const tags = dangling
    ? ["<none>"]
    : valid.map((t) => (t.includes(":") ? t.slice(t.indexOf(":") + 1) : "latest"));
  return { ...image, repo, tags, dangling, used: !dangling };
}

export default function ImageListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [pullOpen, setPullOpen] = useState(false);
  const [historyRef, setHistoryRef] = useState<string | null>(null);
  const [tagTarget, setTagTarget] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({ queryKey: queryKeys.images(), queryFn: listImages });

  const removeMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => removeImage(id, force),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const rows = useMemo(() => (data ?? []).map(describe), [data]);
  const filtered = rows.filter(
    (row) => row.repo.toLowerCase().includes(search.toLowerCase()) || row.tags.join(" ").includes(search),
  );

  const inUse = rows.filter((r) => r.used).length;
  const totalBytes = rows.reduce((sum, r) => sum + r.size, 0);
  const dangling = rows.filter((r) => r.dangling);
  const selectedRows = rows.filter((r) => selected.includes(r.id));

  const deleteSelected = () => {
    void Promise.all(selectedRows.map((r) => removeMutation.mutateAsync({ id: r.id, force: true }))).then(
      () => message.success(`Deleted ${selectedRows.length} image(s)`),
      () => undefined,
    );
    setSelected([]);
  };

  const prune = () => {
    modal.confirm({
      title: "Prune dangling images",
      centered: true,
      okText: "Prune",
      okType: "danger",
      content: `${dangling.length} dangling image(s) will be removed. Running and stopped containers are unaffected.`,
      onOk: async () => {
        const reclaimed = await pruneImages(true);
        void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
        message.success(`Reclaimed ${formatBytes(reclaimed)}`);
      },
    });
  };

  const columns: TableColumnsType<Row> = [
    {
      title: "Repository",
      dataIndex: "repo",
      render: (value: string, row) => (
        <span style={{ color: row.dangling ? "var(--ash)" : "var(--paper)" }}>{value}</span>
      ),
    },
    {
      title: "Tags",
      dataIndex: "tags",
      width: 260,
      render: (_, row) =>
        row.dangling ? (
          <span className="dim">
            <Mono>&lt;none&gt;</Mono>
          </span>
        ) : (
          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
            {row.tags.map((tag) => (
              <Pill key={tag} tone={row.used ? "green" : "neutral"}>
                {tag}
              </Pill>
            ))}
          </span>
        ),
    },
    {
      title: "Image ID",
      dataIndex: "id",
      width: 150,
      render: (value: string) => <Mono>{shortId(value)}</Mono>,
    },
    {
      title: "Size",
      dataIndex: "size",
      width: 110,
      render: (value: number) => <span className="mono">{formatBytes(value)}</span>,
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
      title: "In use",
      key: "used",
      width: 100,
      render: (_, row) =>
        row.used ? (
          <Pill tone="green">
            {row.tags.length} tag{row.tags.length > 1 ? "s" : ""}
          </Pill>
        ) : (
          <Pill>unused</Pill>
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
                key: "history",
                label: "Layer history",
                icon: <HistoryOutlined />,
                onClick: () => setHistoryRef(row.repoTags[0] ?? row.id),
              },
              { key: "tag", label: "Tag image", icon: <TagOutlined />, onClick: () => setTagTarget(row) },
            ],
            [
              {
                key: "delete",
                label: "Delete",
                icon: <DeleteOutlined />,
                danger: true,
                onClick: () =>
                  modal.confirm({
                    title: "Delete image?",
                    centered: true,
                    okText: "Delete",
                    okType: "danger",
                    content: (
                      <span>
                        <Mono>
                          {row.repo}:{row.tags[0]}
                        </Mono>{" "}
                        will be deleted.
                      </span>
                    ),
                    onOk: () => removeMutation.mutateAsync({ id: row.id, force: true }),
                  }),
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
        <MetricCard label="Images in use" value={inUse} suffix={`of ${rows.length}`} />
        <MetricCard label="Total size" value={formatBytes(totalBytes)} />
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search repository or tag"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <span className="spacer" />
          {selected.length > 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>
              {selected.length} selected
            </span>
          ) : null}
          <Popconfirm
            title={`Delete ${selected.length} image(s)?`}
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
            Prune dangling{dangling.length ? ` (${dangling.length})` : ""}
          </Button>
          <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setPullOpen(true)}>
            Pull image
          </Button>
        </div>

        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            getCheckboxProps: (row) => ({ disabled: row.used }),
          }}
          locale={{ emptyText: <Empty description="No images" /> }}
        />
      </div>

      <PullImageModal open={pullOpen} onClose={() => setPullOpen(false)} />
      <LayerHistoryModal reference={historyRef} onClose={() => setHistoryRef(null)} />
      <TagImageModal image={tagTarget} onClose={() => setTagTarget(null)} />
    </div>
  );
}
