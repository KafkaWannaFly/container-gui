import {
  ClearOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  ExpandAltOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  ShrinkOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Popconfirm, Spin, Table, type TableColumnsType, Tooltip } from "antd";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAnimatedTree } from "../../components/AnimatedTree";
import { MetricCard, Mono, Pill, RowActions, StateDot } from "../../components/ui";
import { queryKeys } from "../../lib/queryClient";
import { listContainers, listImages, pruneImages, removeImage } from "../../services/tauriApi";
import { formatBytes, type ImageItem, shortId } from "../../types/docker";
import LayerHistoryModal from "./components/LayerHistoryModal";
import PullImageModal from "./components/PullImageModal";
import TagImageModal from "./components/TagImageModal";

interface Row {
  key: string;
  isGroup: boolean;
  id: string;
  repo: string;
  tag: string;
  // Reference passed to Docker when deleting: `repo:tag` for tagged versions, image ID otherwise.
  ref: string;
  size: number;
  created: number;
  dangling: boolean;
  sharedWith: number;
  count: number;
  children?: Row[];
}

function splitRef(ref: string): { repo: string; tag: string } {
  const idx = ref.lastIndexOf(":");
  const slash = ref.lastIndexOf("/");
  if (idx > slash) return { repo: ref.slice(0, idx), tag: ref.slice(idx + 1) };
  return { repo: ref, tag: "latest" };
}

function buildGroups(images: ImageItem[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const image of images) {
    const valid = image.repoTags.filter((t) => t && !t.startsWith("<none>"));
    if (valid.length === 0) {
      const list = groups.get("<none>") ?? [];
      list.push({
        key: image.id,
        isGroup: false,
        id: image.id,
        repo: "<none>",
        tag: "<none>",
        ref: image.id,
        size: image.size,
        created: image.created,
        dangling: true,
        sharedWith: 0,
        count: 1,
      });
      groups.set("<none>", list);
      continue;
    }
    for (const ref of valid) {
      const { repo, tag } = splitRef(ref);
      const list = groups.get(repo) ?? [];
      list.push({
        key: `${image.id}::${ref}`,
        isGroup: false,
        id: image.id,
        repo,
        tag,
        ref,
        size: image.size,
        created: image.created,
        dangling: false,
        sharedWith: valid.length - 1,
        count: 1,
      });
      groups.set(repo, list);
    }
  }
  return [...groups.entries()]
    .map(([repo, children]): Row => {
      children.sort((a, b) => b.created - a.created);
      // A repository with a single version stays a plain row, like a standalone container.
      if (children.length === 1) return children[0];
      const newest = children[0];
      return {
        key: `group::${repo}`,
        isGroup: true,
        id: newest.id,
        repo,
        tag: "",
        ref: "",
        size: 0,
        created: newest.created,
        dangling: repo === "<none>",
        sharedWith: 0,
        count: children.length,
        children,
      };
    })
    .sort((a, b) => Number(a.dangling) - Number(b.dangling) || a.repo.localeCompare(b.repo));
}

function UsageDot({ usage }: { usage?: { total: number; running: number } }) {
  if (usage?.running) {
    return <StateDot state="running" label={`In use by ${usage.running} running container(s)`} />;
  }
  if (usage?.total) {
    return (
      <StateDot state="in-use" color="var(--amber)" label={`Used by ${usage.total} stopped container(s)`} />
    );
  }
  return <StateDot state="unused" label="Unused" />;
}

export default function ImageListPage() {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const seenGroups = useRef<Set<string>>(new Set());
  const [pullOpen, setPullOpen] = useState(false);
  const [historyRef, setHistoryRef] = useState<string | null>(null);
  const [tagTarget, setTagTarget] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({ queryKey: queryKeys.images(), queryFn: listImages });
  const containers = useQuery({
    queryKey: queryKeys.containers(true),
    queryFn: () => listContainers(true),
  });

  const usageByImage = useMemo(() => {
    const map = new Map<string, { total: number; running: number }>();
    for (const c of containers.data ?? []) {
      const entry = map.get(c.imageId) ?? { total: 0, running: 0 };
      entry.total += 1;
      if (c.state === "running" || c.state === "paused") entry.running += 1;
      map.set(c.imageId, entry);
    }
    return map;
  }, [containers.data]);

  const [pending, setPending] = useState<Set<string>>(new Set());

  const removeMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => removeImage(id, force),
    onSuccess: async (_, { id }) => {
      // Drop the deleted ref right away so the row doesn't linger until the refetch lands.
      queryClient.setQueryData<ImageItem[]>(queryKeys.images(), (old) =>
        old?.flatMap((image) => {
          if (image.id === id) return [];
          if (!image.repoTags.includes(id)) return [image];
          const repoTags = image.repoTags.filter((t) => t !== id);
          return repoTags.some((t) => t && !t.startsWith("<none>")) ? [{ ...image, repoTags }] : [];
        }),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.images() });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const removeRef = (ref: string) => {
    setPending((prev) => new Set(prev).add(ref));
    return removeMutation.mutateAsync({ id: ref, force: true }).finally(() =>
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(ref);
        return next;
      }),
    );
  };

  const flatten = (rows: Row[]) => rows.flatMap((r) => (r.isGroup ? (r.children ?? []) : [r]));
  const images = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => buildGroups(images), [images]);
  const needle = search.toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return groups;
    return groups.flatMap((row): Row[] => {
      if (row.repo.toLowerCase().includes(needle)) return [row];
      if (!row.isGroup) return row.tag.toLowerCase().includes(needle) ? [row] : [];
      const children = (row.children ?? []).filter((c) => c.tag.toLowerCase().includes(needle));
      return children.length ? [{ ...row, children, count: children.length }] : [];
    });
  }, [groups, needle]);

  // Expand newly discovered groups, keep the user's collapse choices.
  // `seenGroups` changes outside the updater: StrictMode runs updaters twice.
  useEffect(() => {
    const keys = groups.filter((r) => r.isGroup).map((r) => r.key);
    const added = keys.filter((key) => !seenGroups.current.has(key));
    for (const key of added) seenGroups.current.add(key);
    setExpanded((prev) => [...prev.filter((key) => keys.includes(String(key))), ...added]);
  }, [groups]);

  const treeTable = useAnimatedTree({
    data: filtered,
    expanded,
    setExpanded,
    isGroup: (row) => !!row.isGroup,
  });

  const leaves = flatten(groups);
  const inUse = images.filter((i) => i.repoTags.some((t) => t && !t.startsWith("<none>"))).length;
  const totalBytes = images.reduce((sum, i) => sum + i.size, 0);
  const dangling = leaves.filter((r) => r.dangling);
  const selectedRows = leaves.filter((r) => selected.includes(r.key));

  const deleteSelected = () => {
    void Promise.all(selectedRows.map((r) => removeRef(r.ref))).then(
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
      title: "Name",
      key: "name",
      render: (_, row) =>
        row.isGroup ? (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
            <span className="row-link" style={row.dangling ? { color: "var(--ash)" } : undefined}>
              {row.repo}
            </span>
            <span className="mono dim">
              {row.count} {row.dangling ? "image" : "version"}
              {row.count > 1 ? "s" : ""}
            </span>
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
              {pending.has(row.ref) ? <Spin size="small" /> : <UsageDot usage={usageByImage.get(row.id)} />}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Link
                to={`/images/${encodeURIComponent(row.id)}`}
                className="row-link"
                style={row.dangling ? { color: "var(--ash)" } : undefined}
              >
                {row.dangling ? "<none>" : `${row.repo}:${row.tag}`}
              </Link>
              <span className="mono dim">{shortId(row.id)}</span>
            </div>
          </div>
        ),
    },
    {
      title: "Tags",
      key: "tags",
      width: 80,
      render: (_, row) => {
        if (row.isGroup) return <span className="dim">—</span>;
        const count = row.dangling ? 0 : row.sharedWith + 1;
        return <span className={count ? "mono" : "mono dim"}>{count}</span>;
      },
    },
    {
      title: "Containers",
      key: "containers",
      width: 160,
      render: (_, row) => {
        if (row.isGroup) return <span className="dim">—</span>;
        const usage = usageByImage.get(row.id);
        if (!usage) return <span className="mono dim">0</span>;
        return (
          <span className="mono" style={{ whiteSpace: "nowrap" }}>
            {usage.total}
            {usage.running ? <span className="dim"> ({usage.running} running)</span> : null}
          </span>
        );
      },
    },
    {
      title: "Size",
      dataIndex: "size",
      width: 110,
      render: (value: number, row) =>
        row.isGroup ? <span className="dim">—</span> : <span className="mono">{formatBytes(value)}</span>,
    },
    {
      title: "Created",
      dataIndex: "created",
      width: 170,
      render: (value: number) => (
        <span className="dim" style={{ whiteSpace: "nowrap" }}>
          {formatDistanceToNow(new Date(value * 1000), { addSuffix: true })}
        </span>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 56,
      align: "right",
      render: (_, row) =>
        row.isGroup ? null : (
          <RowActions
            groups={[
              [
                {
                  key: "details",
                  label: "Details",
                  icon: <InfoCircleOutlined />,
                  onClick: () => navigate(`/images/${encodeURIComponent(row.id)}`),
                },
                {
                  key: "history",
                  label: "Layer history",
                  icon: <HistoryOutlined />,
                  onClick: () => setHistoryRef(row.ref),
                },
                { key: "tag", label: "Tag image", icon: <TagOutlined />, onClick: () => setTagTarget(row) },
              ],
              [
                {
                  key: "delete",
                  label: "Delete",
                  icon: <DeleteOutlined />,
                  danger: true,
                  disabled: pending.has(row.ref),
                  onClick: () =>
                    modal.confirm({
                      title: "Delete image?",
                      centered: true,
                      okText: "Delete",
                      okType: "danger",
                      content: (
                        <span>
                          <Mono>{row.dangling ? shortId(row.id) : row.ref}</Mono> will be deleted
                          {row.sharedWith > 0 ? "; the image stays because it has other tags." : "."}
                        </span>
                      ),
                      onOk: () => {
                        void removeRef(row.ref).catch(() => undefined);
                      },
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
        <MetricCard label="Images in use" value={inUse} suffix={`of ${images.length}`} />
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
          <Tooltip title={treeTable.allExpanded ? "Collapse all" : "Expand all"}>
            <Button
              icon={treeTable.allExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
              disabled={!treeTable.hasGroups}
              onClick={treeTable.toggleAll}
            />
          </Tooltip>
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
            Prune dangling
            {dangling.length ? (
              <span style={{ marginLeft: 6 }}>
                <Pill>{dangling.length}</Pill>
              </span>
            ) : null}
          </Button>
          <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setPullOpen(true)}>
            Pull image
          </Button>
        </div>

        <Table
          size="small"
          rowKey="key"
          loading={isLoading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          expandable={treeTable.expandable}
          components={treeTable.components}
          onRow={treeTable.onRow}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            checkStrictly: false,
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
