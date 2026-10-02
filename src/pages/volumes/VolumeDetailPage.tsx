import {
  ArrowLeftOutlined,
  BlockOutlined,
  CopyOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Descriptions, Empty, Result, Spin, Table, Tabs } from "antd";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Section, useSections } from "../../components/Section";
import { MetricCard, Mono, Pill, StateTag } from "../../components/ui";
import { localTime } from "../../lib/format";
import { queryKeys } from "../../lib/queryClient";
import { getVolumeDetail, listVolumes, removeVolume } from "../../services/tauriApi";
import { formatBytes, type VolumeContainer, type VolumeItem } from "../../types/docker";

const OVERVIEW_SECTIONS = ["storage", "options", "labels"] as const;

function KeyValueTable({ rows, empty }: { rows: [string, string][]; empty: string }) {
  return (
    <Table<[string, string]>
      size="small"
      pagination={false}
      rowKey={(row) => row[0]}
      dataSource={rows}
      locale={{ emptyText: <Empty description={empty} /> }}
      columns={[
        { title: "Key", width: 260, render: (_, row) => <Mono>{row[0]}</Mono> },
        {
          title: "Value",
          render: (_, row) => <span className="mono volume-value">{row[1]}</span>,
        },
      ]}
    />
  );
}

export default function VolumeDetailPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal, message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "containers" ? "containers" : "overview";
  const { section } = useSections("volume-detail.overview", OVERVIEW_SECTIONS);

  const detail = useQuery({
    queryKey: queryKeys.volumeDetail(name),
    queryFn: () => getVolumeDetail(name),
    retry: 1,
  });
  const usage = useQuery({ queryKey: queryKeys.volumes(), queryFn: listVolumes });
  const volume = detail.data;
  const summary = usage.data?.find((item) => item.name === name);
  const containers = volume?.containers ?? [];
  const inUse = containers.length > 0 || summary?.inUse === true;
  const busy = detail.isFetching || usage.isFetching;

  const remove = useMutation({
    mutationFn: () => removeVolume(name, false),
    onSuccess: () => {
      queryClient.setQueryData<VolumeItem[]>(queryKeys.volumes(), (previous) =>
        previous?.filter((item) => item.name !== name),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      message.success("Volume deleted");
      navigate("/volumes");
      queryClient.removeQueries({ queryKey: queryKeys.volumeDetail(name), exact: true });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
  };
  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => message.success(`${label} copied`),
      () => message.error("Clipboard unavailable"),
    );
  };
  const copyable = (text: string, label: string) =>
    text ? (
      <button
        type="button"
        className="copyable mono volume-value"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => copy(text, label)}
      >
        {text}
        <CopyOutlined />
      </button>
    ) : (
      <span className="dim">Not reported by the engine</span>
    );

  if (detail.isPending) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 120 }}>
        <Spin aria-label="Loading volume details" />
      </div>
    );
  }

  if (!volume || detail.isError) {
    return (
      <Result
        status="error"
        title="Unable to load volume"
        subTitle={detail.error?.message ?? "The volume may have been removed."}
        extra={[
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate("/volumes")}>
            Back to volumes
          </Button>,
          <Button key="retry" icon={<ReloadOutlined />} loading={busy} onClick={refresh}>
            Retry
          </Button>,
        ]}
      />
    );
  }

  const confirmDelete = () =>
    modal.confirm({
      title: "Delete volume?",
      centered: true,
      okText: "Delete",
      okType: "danger",
      content: (
        <span>
          All data in <Mono>{volume.name}</Mono> will be permanently lost. This cannot be undone.
        </span>
      ),
      onOk: () => remove.mutateAsync(),
    });
  const size = summary ? (summary.sizeBytes === 0 ? "0 B" : formatBytes(summary.sizeBytes)) : "Unknown";
  const labels = Object.entries(volume.labels).sort(([a], [b]) => a.localeCompare(b));
  const options = Object.entries(volume.options).sort(([a], [b]) => a.localeCompare(b));
  const project = volume.labels["com.docker.compose.project"];

  return (
    <div>
      <div className="detail-head">
        <div className="detail-head-inner">
          <div className="crumbs">
            <Link to="/volumes">Volumes</Link>
            <span>/</span>
            <span className="volume-crumb" title={volume.name}>
              {volume.name}
            </span>
          </div>
          <div className="head-row">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              aria-label="Back to volumes"
              onClick={() => navigate("/volumes")}
            />
            <div className="volume-heading">
              <div className="detail-title volume-value">{volume.name}</div>
              <div className="detail-sub">
                <Pill tone={inUse ? "green" : "neutral"}>{inUse ? "In use" : "Unused"}</Pill>
                <Pill tone={volume.driver === "local" ? "neutral" : "teal"}>{volume.driver}</Pill>
                <span className="dim note">
                  {inUse ? "Detach referencing containers before deleting" : "Persistent storage"}
                </span>
              </div>
            </div>
            <div className="toolbar">
              <Button icon={<ReloadOutlined />} loading={busy} onClick={refresh}>
                Refresh
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={remove.isPending}
                disabled={inUse || busy || detail.isError}
                onClick={confirmDelete}
              >
                Delete volume
              </Button>
            </div>
          </div>
          <Tabs
            activeKey={tab}
            onChange={(key) =>
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  next.set("tab", key);
                  return next;
                },
                { replace: true },
              )
            }
            items={[
              { key: "overview", label: "Overview", icon: <InfoCircleOutlined /> },
              {
                key: "containers",
                label: (
                  <>
                    Containers <span className="dim">{containers.length}</span>
                  </>
                ),
                icon: <BlockOutlined />,
              },
            ]}
          />
        </div>
      </div>
      <div className="page detail-body">
        <div className="tab-stack">
          {usage.isError ? (
            <Alert
              type="warning"
              showIcon
              title="Storage usage could not be refreshed"
              description={usage.error.message}
            />
          ) : null}
          {tab === "overview" ? (
            <>
              <div className="metrics">
                <MetricCard label="Stored data" value={size} suffix="reported by Docker" />
                <MetricCard
                  label="Attached containers"
                  value={containers.length}
                  suffix={`${containers.filter((container) => container.state === "running").length} running`}
                />
              </div>
              <Section id="storage" title="Storage" {...section}>
                <Descriptions
                  column={1}
                  size="small"
                  bordered
                  items={[
                    { key: "name", label: "Name", children: copyable(volume.name, "Volume name") },
                    { key: "driver", label: "Driver", children: <Mono>{volume.driver}</Mono> },
                    { key: "scope", label: "Scope", children: <Mono>{volume.scope || "Unknown"}</Mono> },
                    {
                      key: "created",
                      label: "Created",
                      children: <Mono>{localTime(volume.createdAt)}</Mono>,
                    },
                    {
                      key: "mountpoint",
                      label: "Mountpoint",
                      children: copyable(volume.mountpoint, "Mountpoint"),
                    },
                    { key: "size", label: "Size", children: <Mono>{size}</Mono> },
                    {
                      key: "project",
                      label: "Compose project",
                      children: project ? (
                        <Link to={`/containers/group/${encodeURIComponent(project)}`} className="row-link">
                          {project}
                        </Link>
                      ) : (
                        <span className="dim">Not managed by Compose</span>
                      ),
                    },
                  ]}
                />
                <p className="dim note" style={{ marginBottom: 0 }}>
                  The mountpoint is on the Docker engine host, not necessarily this computer.
                </p>
              </Section>
              <Section
                id="options"
                title="Driver options"
                {...section}
                extra={<span className="dim note">{options.length} options</span>}
              >
                <KeyValueTable rows={options} empty="No driver options" />
              </Section>
              <Section
                id="labels"
                title="Labels"
                {...section}
                extra={<span className="dim note">{labels.length} labels</span>}
              >
                <KeyValueTable rows={labels} empty="No labels" />
              </Section>
            </>
          ) : (
            <div className="card">
              <p className="dim note" style={{ marginTop: 0 }}>
                <InfoCircleOutlined /> Running and stopped containers that reference this volume. Remove their
                references before deleting the volume.
              </p>
              <Table<VolumeContainer>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={containers}
                scroll={{ x: 700 }}
                locale={{ emptyText: <Empty description="No containers use this volume" /> }}
                columns={[
                  {
                    title: "Name",
                    render: (_, container) => (
                      <div>
                        <Link to={`/containers/${container.id}`} className="row-link">
                          {container.name}
                        </Link>
                        <div className="mono dim volume-value" style={{ fontSize: 12 }}>
                          {container.image}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "State",
                    width: 130,
                    render: (_, container) => <StateTag state={container.state} />,
                  },
                  {
                    title: "Status",
                    render: (_, container) => <span className="dim">{container.status}</span>,
                  },
                  {
                    title: "Container mount",
                    render: (_, container) => (
                      <div className="volume-mounts">
                        {container.mounts.map((mount) => (
                          <div key={mount.destination} className="volume-mount">
                            <span className="mono volume-value">{mount.destination || "Unknown path"}</span>
                            <Pill tone={mount.readOnly ? "amber" : "neutral"}>
                              {mount.readOnly === null
                                ? "Unknown access"
                                : mount.readOnly
                                  ? "Read-only"
                                  : "Read / write"}
                            </Pill>
                          </div>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
