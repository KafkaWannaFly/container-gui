import {
  ArrowLeftOutlined,
  BlockOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, type MenuProps, Result, Spin, Tabs, Tooltip } from "antd";
import { formatDistanceToNow } from "date-fns";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Mono, Pill, StateDot } from "../../../components/ui";
import { compactDuration, isZeroTime } from "../../../lib/format";
import { queryKeys } from "../../../lib/queryClient";
import {
  type ContainerActionKind,
  containerAction,
  inspectContainer,
  inspectImage,
  metricsLatest,
} from "../../../services/tauriApi";
import { type ContainerInspect, formatBytes, type MetricSample, shortId } from "../../../types/docker";
import EnvTab from "./EnvTab";
import InfoTab from "./InfoTab";
import LogsTab from "./LogsTab";

// Heavy tabs (xterm, CodeMirror) load on first open.
const ExecTab = lazy(() => import("./ExecTab"));
const FilesTab = lazy(() => import("./FilesTab"));
const ImageTab = lazy(() => import("./ImageTab"));

import { composeOf, containerName, cpuLimit, pidsLimit, type TabProps } from "./model";

const TAB_KEYS = ["info", "image", "env", "logs", "files", "exec"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Latest backend-collected sample while the container runs; null otherwise. */
function useLiveStats(id: string, live: boolean): MetricSample | null {
  const { data } = useQuery({
    queryKey: [...queryKeys.containerStats(), id],
    queryFn: () => metricsLatest([id]),
    refetchInterval: 2_000,
    enabled: live,
  });
  return live ? (data?.[0] ?? null) : null;
}

/** Re-render every `ms` so relative times (uptime) stay current. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

function statusLine(ctr: ContainerInspect): string {
  const state = ctr.State;
  if (state?.Running && !state.Paused && state.StartedAt) {
    return `up ${compactDuration(Date.now() - new Date(state.StartedAt).getTime())}`;
  }
  if (state?.Paused) return "paused";
  if (state?.Status === "created") return "created, never started";
  if (!isZeroTime(state?.FinishedAt)) {
    const ago = formatDistanceToNow(new Date(state?.FinishedAt as string), { addSuffix: true });
    return `exited (${state?.ExitCode ?? 0}) ${ago}`;
  }
  return state?.Status ?? "unknown";
}

function rates(a: number | null | undefined, b: number | null | undefined): string | null {
  if (a == null || b == null) return null;
  const rate = (v: number) => (v > 0 ? `${formatBytes(v)}/s` : "0 B/s");
  return `${rate(a)} · ${rate(b)}`;
}

function HeaderStats({ ctr, stats }: { ctr: ContainerInspect; stats: MetricSample | null }) {
  const cores = cpuLimit(ctr);
  const pids = pidsLimit(ctr);
  const memLimit = ctr.HostConfig?.Memory || stats?.memoryLimit || 0;
  const memPct = stats && memLimit ? ((stats.memoryUsage / memLimit) * 100).toFixed(1) : null;
  // cpuPercent is docker-stats style: 100% = one full core.
  const cpuUsed = stats?.cpuPercent != null ? stats.cpuPercent / 100 : null;
  const cpuCap = cores ?? stats?.onlineCpus ?? 0;
  const cpuPct = cpuUsed !== null && cpuCap ? ((cpuUsed / cpuCap) * 100).toFixed(1) : null;
  const cells: { k: string; v: ReactNode; small?: ReactNode; tip: string }[] = [
    {
      k: "CPU",
      v: cpuUsed !== null ? `${cpuUsed.toFixed(2)} cpus` : "—",
      small: cpuPct ? `${cpuPct}% of ${cores ? cores.toFixed(2) : cpuCap} cpus` : null,
      tip: cores
        ? "CPU cores in use right now, out of the container's CPU limit."
        : "CPU cores in use right now, out of all host cores (no CPU limit set).",
    },
    {
      k: "Memory",
      v: stats ? formatBytes(stats.memoryUsage) : "—",
      small: memPct ? `${memPct}% of ${formatBytes(memLimit)}` : null,
      tip: ctr.HostConfig?.Memory
        ? "Memory in use (excluding file cache), out of the container's memory limit."
        : "Memory in use (excluding file cache), out of total host memory (no memory limit set).",
    },
    {
      k: "Network I/O",
      v: stats ? `${formatBytes(stats.netRx)} / ${formatBytes(stats.netTx)}` : "— / —",
      small: rates(stats?.netRxRate, stats?.netTxRate),
      tip: "Total data received / sent over the network since the container started, and the current rate.",
    },
    {
      k: "Block I/O",
      v: stats ? `${formatBytes(stats.blockRead)} / ${formatBytes(stats.blockWrite)}` : "— / —",
      small: rates(stats?.blockReadRate, stats?.blockWriteRate),
      tip: "Total data read from / written to disk since the container started, and the current rate.",
    },
    {
      k: "PIDs",
      v: stats ? stats.pids : "—",
      small: pids ? `/ ${pids}` : null,
      tip: pids
        ? "Processes and threads running inside the container, out of its PID limit."
        : "Processes and threads running inside the container (no PID limit set).",
    },
    {
      k: "Restarts",
      v: ctr.RestartCount ?? 0,
      small: ctr.HostConfig?.RestartPolicy?.Name || "no",
      tip: "Times Docker has automatically restarted this container, and its restart policy.",
    },
  ];
  return (
    <div className="stats">
      {cells.map((cell) => (
        <Tooltip key={cell.k} title={cell.tip} mouseEnterDelay={0.3}>
          <div className="stat">
            <div className="k">{cell.k}</div>
            <div className="v">
              {cell.v}
              {cell.small ? <small>{cell.small}</small> : null}
            </div>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

/** Menu label with an explanation to the left; the offset clears the item icon. */
function tip(label: string, title: string) {
  return (
    <Tooltip title={title} placement="left" mouseEnterDelay={0.3} align={{ offset: [-40, 0] }}>
      <span style={{ display: "block" }}>{label}</span>
    </Tooltip>
  );
}

export default function ContainerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal, message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState<ContainerActionKind | null>(null);
  useTick(30_000);

  const tabParam = params.get("tab");
  const tab: TabKey = TAB_KEYS.includes(tabParam as TabKey) ? (tabParam as TabKey) : "info";
  const setTab = (key: string) => setParams({ tab: key }, { replace: true });

  const inspect = useQuery({
    queryKey: queryKeys.containerInspect(id),
    queryFn: () => inspectContainer(id),
    retry: 1,
  });
  const ctr = inspect.data;
  const imageRef = ctr?.Image ?? "";
  const image = useQuery({
    queryKey: queryKeys.imageInspect(imageRef),
    queryFn: () => inspectImage(imageRef),
    enabled: imageRef !== "",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const running = !!ctr?.State?.Running && !ctr.State.Paused;
  const paused = !!ctr?.State?.Paused;
  const stats = useLiveStats(id, running);

  const action = useMutation({
    mutationFn: (kind: ContainerActionKind) => containerAction(id, kind),
    onMutate: (kind) => setPending(kind),
    onSettled: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.containerInspect(id) });
      void queryClient.invalidateQueries({ queryKey: ["containers"] });
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

  if (!ctr) {
    return (
      <Result
        status="404"
        title="Container not found"
        subTitle={inspect.error?.message ?? "It may have been removed."}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/containers")}>
            Back to containers
          </Button>
        }
      />
    );
  }

  const name = containerName(ctr);
  const compose = composeOf(ctr);
  const health = ctr.State?.Health?.Status;
  const state = paused ? "paused" : (ctr.State?.Status ?? "unknown");
  const live = running || paused;

  const remove = () =>
    modal.confirm({
      title: "Remove container?",
      centered: true,
      okText: "Remove",
      okType: "danger",
      content: (
        <span>
          <Mono>{name}</Mono> will be stopped and deleted. Named volumes are kept.
        </span>
      ),
      onOk: () =>
        action.mutateAsync("remove").then(() => {
          message.success(`${name} removed`);
          navigate("/containers");
        }),
    });

  const moreItems: MenuProps["items"] = [
    {
      key: "kill",
      icon: <StopOutlined />,
      disabled: !running,
      label: tip(
        "Kill",
        "Sends SIGKILL: processes end immediately with no graceful shutdown. Use it when Stop hangs.",
      ),
      onClick: () => action.mutate("kill"),
    },
    {
      key: "copy-id",
      icon: <CopyOutlined />,
      label: tip(
        "Copy full ID",
        `Copies the 64-character container ID. The header shows the 12-character short form (${shortId(ctr.Id)}).`,
      ),
      onClick: () => onCopy(ctr.Id, "Container ID"),
    },
    {
      key: "inspect",
      icon: <FileTextOutlined />,
      label: tip(
        "Copy inspect JSON",
        "Copies the full docker inspect output: config, state, mounts, networks, env and labels. Env values are not masked.",
      ),
      onClick: () => onCopy(JSON.stringify(ctr, null, 2), "Inspect JSON"),
    },
    { type: "divider" },
    {
      key: "remove",
      icon: <DeleteOutlined />,
      danger: true,
      label: tip("Remove", "Stops and deletes the container. Named volumes are kept."),
      onClick: remove,
    },
  ];

  const tabProps: TabProps = { ctr, image: image.data, onCopy, onOpenTab: setTab };
  const tabs: { key: TabKey; icon: ReactNode; label: string; render: () => ReactNode }[] = [
    { key: "info", icon: <InfoCircleOutlined />, label: "Info", render: () => <InfoTab {...tabProps} /> },
    { key: "image", icon: <BlockOutlined />, label: "Image", render: () => <ImageTab {...tabProps} /> },
    { key: "env", icon: <SettingOutlined />, label: "Environment", render: () => <EnvTab {...tabProps} /> },
    { key: "logs", icon: <FileTextOutlined />, label: "Logs", render: () => <LogsTab {...tabProps} /> },
    { key: "files", icon: <FolderOutlined />, label: "Files", render: () => <FilesTab {...tabProps} /> },
    { key: "exec", icon: <CodeOutlined />, label: "Exec", render: () => <ExecTab {...tabProps} /> },
  ];

  return (
    <div>
      <div className="detail-head">
        <div className="detail-head-inner">
          <div className="crumbs">
            <Link to="/containers">Containers</Link>
            <span>/</span>
            <span style={{ color: "var(--fog)" }}>{name}</span>
          </div>

          <div className="head-row">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              aria-label="Back to containers"
              onClick={() => navigate("/containers")}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="detail-title">
                {pending ? <Spin size="small" /> : <StateDot state={state} size={9} />}
                {name}
                {compose ? (
                  <Pill tone="teal">
                    {compose.service ? `${compose.project}/${compose.service}` : compose.project}
                  </Pill>
                ) : null}
                {health && live ? (
                  <Pill tone={health === "healthy" ? "green" : health === "unhealthy" ? "coral" : "amber"}>
                    {health}
                  </Pill>
                ) : null}
              </div>
              <div className="detail-sub">
                <Mono>{ctr.Config?.Image ?? shortId(ctr.Image ?? "")}</Mono>
                <span className="dim">·</span>
                <button
                  type="button"
                  className="copyable mono"
                  onClick={() => onCopy(ctr.Id, "Container ID")}
                >
                  {shortId(ctr.Id)}
                  <CopyOutlined />
                </button>
                <span className="dim">·</span>
                <span className="mono dim">{statusLine(ctr)}</span>
              </div>
            </div>

            <div className="toolbar">
              {running ? (
                <Button
                  icon={<PauseCircleOutlined />}
                  loading={pending === "pause"}
                  onClick={() => action.mutate("pause")}
                >
                  Pause
                </Button>
              ) : paused ? (
                <Button
                  icon={<PlayCircleOutlined />}
                  loading={pending === "unpause"}
                  onClick={() => action.mutate("unpause")}
                >
                  Unpause
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={pending === "start"}
                  onClick={() => action.mutate("start")}
                >
                  Start
                </Button>
              )}
              <Button
                icon={<ReloadOutlined />}
                disabled={!live}
                loading={pending === "restart"}
                onClick={() => action.mutate("restart")}
              >
                Restart
              </Button>
              <Button
                danger
                icon={<PoweroffOutlined />}
                disabled={!live}
                loading={pending === "stop"}
                onClick={() => action.mutate("stop")}
              >
                Stop
              </Button>
              <Dropdown menu={{ items: moreItems }} trigger={["click"]} placement="bottomRight">
                <Button icon={<MoreOutlined />} aria-label="More actions" />
              </Dropdown>
            </div>
          </div>

          <HeaderStats ctr={ctr} stats={stats} />

          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={tabs.map((t) => ({
              key: t.key,
              label: (
                <span>
                  {t.icon} {t.label}
                </span>
              ),
            }))}
          />
        </div>
      </div>

      <div className="page detail-body">
        <Suspense fallback={<Spin style={{ marginTop: 40 }} />}>
          {tabs.find((t) => t.key === tab)?.render()}
        </Suspense>
      </div>
    </div>
  );
}
