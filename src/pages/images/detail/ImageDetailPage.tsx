import {
  ArrowLeftOutlined,
  BlockOutlined,
  CopyOutlined,
  DeleteOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Descriptions, type DescriptionsProps, Empty, Result, Spin, Table, Tabs } from "antd";
import { formatDistanceToNow } from "date-fns";
import { type ReactNode, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Section, useSections } from "../../../components/Section";
import { Mono, Pill, StateTag } from "../../../components/ui";
import { localTime } from "../../../lib/format";
import { queryKeys } from "../../../lib/queryClient";
import {
  imageHistory,
  inspectImage,
  listContainers,
  listImages,
  removeImage,
} from "../../../services/tauriApi";
import {
  type ContainerSummary,
  formatBytes,
  type ImageInspect,
  portLabel,
  shortId,
} from "../../../types/docker";
import BuildTab from "./BuildTab";

const TAB_KEYS = ["overview", "build", "containers"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const OVERVIEW_SECTIONS = ["image", "config", "env", "labels"] as const;

const NAMED_ORDER = ["latest", "stable", "mainline"];
const nums = (t: string) => t.match(/\d+(?:\.\d+)*/g)?.flatMap((s) => s.split(".").map(Number)) ?? [];

/** Newer versions first; plain aliases (latest, stable…) in a fixed order. */
function compareTags(a: string, b: string): number {
  const na = nums(a);
  const nb = nums(b);
  if (!na.length && !nb.length) {
    const ia = NAMED_ORDER.findIndex((x) => a.startsWith(x));
    const ib = NAMED_ORDER.findIndex((x) => b.startsWith(x));
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  }
  for (let i = 0; i < Math.max(na.length, nb.length); i += 1) {
    const d = (nb[i] ?? -1) - (na[i] ?? -1);
    if (d !== 0) return d;
  }
  return a.localeCompare(b);
}

function splitRef(ref: string): { repo: string; tag: string } {
  const at = ref.lastIndexOf(":");
  return at > ref.lastIndexOf("/")
    ? { repo: ref.slice(0, at), tag: ref.slice(at + 1) }
    : { repo: ref, tag: "latest" };
}

/** `nginx` → `docker.io/library/nginx`; registry-qualified names are kept. */
function registryPath(repo: string): string {
  const parts = repo.split("/");
  if (parts.length === 1) return `docker.io/library/${repo}`;
  if (parts.length === 2 && !parts[0].includes(".") && !parts[0].includes(":") && parts[0] !== "localhost") {
    return `docker.io/${repo}`;
  }
  return repo;
}

function Dim({ children }: { children: ReactNode }) {
  return <span className="dim">{children}</span>;
}

function argv(args: string[] | null | undefined) {
  return args?.length ? <Mono>{JSON.stringify(args)}</Mono> : <Dim>not set</Dim>;
}

function KeyValueTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: [string, string];
  rows: [string, string][];
}) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey={(r) => r[0]}
      dataSource={rows}
      locale={{ emptyText: <Empty description={`No ${title}`} /> }}
      columns={[
        { title: head[0], width: 260, render: (_, r) => <span className="mono">{r[0]}</span> },
        {
          title: head[1],
          render: (_, r) => (
            <span className="mono dim env-val" title={r[1]}>
              {r[1]}
            </span>
          ),
        },
      ]}
    />
  );
}

function OverviewTab({
  image,
  tag,
  repo,
  layerCount,
  withContent,
  onCopy,
}: {
  image: ImageInspect;
  tag: string;
  repo: string;
  layerCount: number;
  withContent: number;
  onCopy: (text: string, what: string) => void;
}) {
  const { section } = useSections("image-detail.overview", OVERVIEW_SECTIONS);
  const config = image.Config;
  const digests = image.RepoDigests ?? [];
  const manifest = (digests.find((d) => d.startsWith(`${repo}@`)) ?? digests[0])?.split("@")[1];
  const pullRef = manifest ? `${repo}:${tag}@${manifest}` : "";
  const platform = [image.Os, image.Architecture, image.Variant].filter(Boolean).join("/") || "—";
  const env = (config?.Env ?? []).map((e): [string, string] => {
    const at = e.indexOf("=");
    return at < 0 ? [e, ""] : [e.slice(0, at), e.slice(at + 1)];
  });
  const labels = Object.entries(config?.Labels ?? {});
  const ports = Object.keys(config?.ExposedPorts ?? {});
  const created = image.Created ? new Date(image.Created) : null;

  const copyable = (text: string, shown: string, what: string) => (
    <button type="button" className="copyable mono" onClick={() => onCopy(text, what)}>
      {shown}
      <CopyOutlined />
    </button>
  );

  const summary: DescriptionsProps["items"] = [
    { key: "id", label: "Image ID", children: copyable(image.Id, image.Id.slice(0, 26), "Image ID") },
    {
      key: "digest",
      label: "Digest",
      children: pullRef ? (
        copyable(pullRef, pullRef.length > 60 ? `${pullRef.slice(0, 60)}…` : pullRef, "Digest")
      ) : (
        <Dim>none — never pushed to or pulled from a registry</Dim>
      ),
    },
    {
      key: "source",
      label: "Source",
      children: manifest ? (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Pill tone="teal">pulled</Pill>
          <Mono>
            {registryPath(repo)}:{tag}
          </Mono>
        </span>
      ) : (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Pill tone="lav">local build</Pill>
          <span className="dim" style={{ fontSize: 12 }}>
            the original Dockerfile lives in its build context, not in the image
          </span>
        </span>
      ),
    },
    {
      key: "created",
      label: "Created",
      children: (
        <span>
          <Mono>{localTime(image.Created)}</Mono>
          {created ? (
            <span className="dim" style={{ fontSize: 12 }}>
              {" "}
              · {formatDistanceToNow(created, { addSuffix: true })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "size",
      label: "Size",
      children: (
        <span>
          <Mono>{image.Size ? formatBytes(image.Size) : "—"}</Mono>
          {layerCount ? (
            <span className="dim" style={{ fontSize: 12 }}>
              {" "}
              · {layerCount} layers, {withContent} with content
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "platform", label: "Platform", children: <Mono>{platform}</Mono> },
  ];

  const configItems: DescriptionsProps["items"] = [
    { key: "entry", label: "Entrypoint", children: argv(config?.Entrypoint) },
    { key: "cmd", label: "Command", children: argv(config?.Cmd) },
    {
      key: "wd",
      label: "Working dir",
      children: config?.WorkingDir ? <Mono>{config.WorkingDir}</Mono> : <Mono>/</Mono>,
    },
    {
      key: "user",
      label: "User",
      children: config?.User ? <Mono>{config.User}</Mono> : <Dim>not set · runs as root</Dim>,
    },
    { key: "shell", label: "Shell", children: argv(config?.Shell) },
    {
      key: "ports",
      label: "Exposed ports",
      children: ports.length ? <Mono>{ports.join(", ")}</Mono> : <Dim>none</Dim>,
    },
    {
      key: "signal",
      label: "Stop signal",
      children: config?.StopSignal ? <Mono>{config.StopSignal}</Mono> : <Mono>SIGTERM</Mono>,
    },
  ];

  return (
    <div className="tab-stack">
      <Section id="image" title="Image" {...section}>
        <Descriptions column={1} size="small" bordered items={summary} />
      </Section>
      <Section id="config" title="Configuration" {...section}>
        <Descriptions column={1} size="small" bordered items={configItems} />
      </Section>
      <Section
        id="env"
        title="Environment"
        {...section}
        extra={
          <span className="dim note">
            {env.length} variable{env.length === 1 ? "" : "s"}
          </span>
        }
      >
        <KeyValueTable title="variables" head={["Variable", "Value"]} rows={env} />
      </Section>
      <Section
        id="labels"
        title="Labels"
        {...section}
        extra={
          <span className="dim note">
            {labels.length} label{labels.length === 1 ? "" : "s"}
          </span>
        }
      >
        <KeyValueTable title="labels" head={["Key", "Value"]} rows={labels} />
      </Section>
    </div>
  );
}

function ContainersTab({ containers }: { containers: ContainerSummary[] }) {
  return (
    <div className="tab-stack">
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <span className="dim note">
            <InfoCircleOutlined /> Containers created from any tag of this image.
          </span>
        </div>
        <Table<ContainerSummary>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={containers}
          locale={{ emptyText: <Empty description="No containers use this image" /> }}
          columns={[
            {
              title: "Name",
              render: (_, c) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>
                    <Link to={`/containers/${c.id}`} className="row-link">
                      {c.names[0] ?? shortId(c.id)}
                    </Link>
                    {c.composeProject ? (
                      <span style={{ marginLeft: 8 }}>
                        <Pill tone="teal">
                          {c.composeService ? `${c.composeProject}/${c.composeService}` : c.composeProject}
                        </Pill>
                      </span>
                    ) : null}
                  </span>
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    {c.image}
                  </span>
                </div>
              ),
            },
            { title: "State", width: 130, render: (_, c) => <StateTag state={c.state} /> },
            { title: "Status", width: 210, render: (_, c) => <span className="mono dim">{c.status}</span> },
            {
              title: "Ports",
              width: 200,
              render: (_, c) =>
                c.ports.length ? (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {c.ports.map((p) => (
                      <span key={portLabel(p)} className="mono dim">
                        {portLabel(p)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="mono dim">—</span>
                ),
            },
            {
              title: "Created",
              width: 130,
              render: (_, c) => (
                <span className="dim">
                  {formatDistanceToNow(new Date(c.created * 1000), { addSuffix: true })}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

export default function ImageDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal, message } = App.useApp();
  const [params, setParams] = useSearchParams();

  const tabParam = params.get("tab");
  const tab: TabKey = TAB_KEYS.includes(tabParam as TabKey) ? (tabParam as TabKey) : "overview";
  const setTab = (key: string) => setParams({ tab: key }, { replace: true });

  const inspect = useQuery({
    queryKey: queryKeys.imageInspect(id),
    queryFn: () => inspectImage(id),
    retry: 1,
  });
  const list = useQuery({ queryKey: queryKeys.images(), queryFn: listImages });
  const allContainers = useQuery({
    queryKey: queryKeys.containers(true),
    queryFn: () => listContainers(true),
  });

  const image = inspect.data;
  const summary = list.data?.find((i) => i.id === id);
  const refs = useMemo(
    () => (summary?.repoTags ?? image?.RepoTags ?? []).filter((t) => t && !t.startsWith("<none>")),
    [summary, image],
  );
  const repo = refs.length ? splitRef(refs[0]).repo : "<none>";
  const tags = useMemo(() => refs.map((r) => splitRef(r).tag), [refs]);
  const sortedTags = useMemo(() => [...tags].sort(compareTags), [tags]);
  const tag = sortedTags.find((t) => t === "latest") ?? sortedTags[0];

  const containers = useMemo(() => {
    const names = new Set(refs.flatMap((r) => (r.includes(":") ? [r] : [`${r}:latest`])));
    const bare = shortId(id);
    return (allContainers.data ?? []).filter(
      (c) => names.has(c.image.includes(":") ? c.image : `${c.image}:latest`) || shortId(c.image) === bare,
    );
  }, [allContainers.data, refs, id]);
  const usedTags = useMemo(() => {
    const names = new Set(containers.map((c) => c.image));
    return new Set(tags.filter((t) => names.has(`${repo}:${t}`) || (t === "latest" && names.has(repo))));
  }, [containers, tags, repo]);

  const historyRef = tag ? `${repo}:${tag}` : id;
  const history = useQuery({
    queryKey: queryKeys.imageHistory(historyRef),
    queryFn: () => imageHistory(historyRef),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: inspect.isSuccess,
  });
  const layerCount = history.data?.length ?? 0;
  const withContent = (history.data ?? []).filter((l) => l.size > 0).length;

  const remove = useMutation({
    mutationFn: () => removeImage(id, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      message.success("Image deleted");
      navigate("/images");
    },
    onError: (err: Error) => message.error(err.message),
  });

  const onCopy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(
      () => message.success(`${what} copied`),
      () => message.error("Clipboard unavailable"),
    );
  };

  if (inspect.isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 120 }}>
        <Spin />
      </div>
    );
  }

  if (!image) {
    return (
      <Result
        status="404"
        title="Image not found"
        subTitle={inspect.error?.message ?? "It may have been removed."}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/images")}>
            Back to images
          </Button>
        }
      />
    );
  }

  const title = repo === "<none>" || !tag ? shortId(image.Id) : `${repo}:${tag}`;

  const confirmDelete = () =>
    modal.confirm({
      title: "Delete image?",
      centered: true,
      okText: "Delete",
      okType: "danger",
      content: (
        <span>
          <Mono>{title}</Mono>
          {tags.length > 1 ? ` and all ${tags.length} of its tags` : ""} will be deleted.
          {containers.length ? ` ${containers.length} container(s) still reference it.` : ""}
        </span>
      ),
      onOk: () => remove.mutateAsync(),
    });

  const tabItems: { key: TabKey; icon: ReactNode; label: string; count?: number }[] = [
    { key: "overview", icon: <InfoCircleOutlined />, label: "Overview" },
    { key: "build", icon: <HistoryOutlined />, label: "Build", count: layerCount },
    { key: "containers", icon: <BlockOutlined />, label: "Containers", count: containers.length },
  ];

  return (
    <div>
      <div className="detail-head">
        <div className="detail-head-inner">
          <div className="crumbs">
            <Link to="/images">Images</Link>
            <span>/</span>
            <span style={{ color: "var(--fog)" }}>{title}</span>
          </div>

          <div className="head-row">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              aria-label="Back to images"
              onClick={() => navigate("/images")}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="detail-title">{title}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                {tags.length
                  ? `${tags.length} tag${tags.length === 1 ? "" : "s"} alias this image`
                  : "Dangling image — no tags"}
              </div>
            </div>

            <div className="toolbar">
              <Button danger icon={<DeleteOutlined />} loading={remove.isPending} onClick={confirmDelete}>
                Delete image
              </Button>
            </div>
          </div>

          {sortedTags.length ? (
            <div className="tag-row" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {sortedTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="tag-pill"
                  title={`Copy ${repo}:${t}`}
                  aria-label={`Copy ${repo}:${t}`}
                  onClick={() =>
                    void navigator.clipboard.writeText(`${repo}:${t}`).then(
                      () => message.success("Image reference copied"),
                      () => message.error("Clipboard unavailable"),
                    )
                  }
                >
                  <Pill tone={usedTags.has(t) ? "green" : "neutral"}>
                    {t}
                    <CopyOutlined className="tag-pill-icon" />
                  </Pill>
                </button>
              ))}
            </div>
          ) : null}

          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={tabItems.map((t) => ({
              key: t.key,
              label: (
                <span>
                  {t.icon} {t.label}
                  {t.count !== undefined ? <span className="dim"> {t.count}</span> : null}
                </span>
              ),
            }))}
          />
        </div>
      </div>

      <div className="page detail-body">
        {tab === "overview" ? (
          <OverviewTab
            image={image}
            tag={tag ?? "latest"}
            repo={repo}
            layerCount={layerCount}
            withContent={withContent}
            onCopy={onCopy}
          />
        ) : tab === "build" ? (
          <BuildTab
            name={tag ? `${repo}:${tag}` : shortId(image.Id)}
            layers={history.data}
            loading={history.isLoading}
            error={history.error?.message}
            image={image}
            onCopy={onCopy}
          />
        ) : (
          <ContainersTab containers={containers} />
        )}
      </div>
    </div>
  );
}
