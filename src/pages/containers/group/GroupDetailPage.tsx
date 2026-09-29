import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  BuildOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, type MenuProps, Result, Spin, Tabs, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Mono, Pill } from "../../../components/ui";
import { queryKeys } from "../../../lib/queryClient";
import {
  composeAction,
  containerAction,
  getComposeProject,
  listContainerStats,
  listContainers,
} from "../../../services/tauriApi";
import type { ContainerStats, ContainerSummary } from "../../../types/docker";
import { formatBytes } from "../../../types/docker";
import ConfigTab from "./ConfigTab";
import EnvTab from "./EnvTab";
import { useImages, useInspects } from "./hooks";
import InfoTab from "./InfoTab";
import LogsTab from "./LogsTab";
import {
  activeProfiles as activeProfilesOf,
  filesOf,
  groupByService,
  impactOf,
  servicesOf,
  svcState,
  workdirOf,
} from "./model";

const STATS_INTERVAL_MS = 2_000;
const TREND_POINTS = 30;

export default function GroupDetailPage() {
  const { project = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState("info");
  const [logSolo, setLogSolo] = useState<string | null>(null);
  const [trends, setTrends] = useState<Map<string, number[]>>(new Map());

  const containersQuery = useQuery({
    queryKey: queryKeys.containers(true),
    queryFn: () => listContainers(true),
  });

  const containers = useMemo(
    () => (containersQuery.data ?? []).filter((ctr) => ctr.composeProject === project),
    [containersQuery.data, project],
  );

  const workdir = workdirOf(containers[0]);
  const files = useMemo(() => filesOf(containers[0]), [containers]);

  const composeQuery = useQuery({
    queryKey: [...queryKeys.composeProject(workdir ?? ""), project] as const,
    queryFn: () => getComposeProject(workdir as string, files),
    enabled: Boolean(workdir && files.length),
    staleTime: 15_000,
  });
  const config = composeQuery.data;

  const services = useMemo(() => servicesOf(config?.config), [config]);
  const activeProfiles = useMemo(() => activeProfilesOf(services, containers), [services, containers]);
  const byService = useMemo(() => groupByService(containers), [containers]);

  const statsQuery = useQuery({
    queryKey: queryKeys.containerStats(),
    queryFn: () => listContainerStats(true),
    refetchInterval: STATS_INTERVAL_MS,
    enabled: containers.length > 0,
  });

  const inspectById = useInspects(containers);
  const imageById = useImages(inspectById);

  const statsById = useMemo(() => {
    const ids = new Set(containers.map((ctr) => ctr.id));
    const map = new Map<string, ContainerStats>();
    for (const stat of statsQuery.data ?? []) if (ids.has(stat.id)) map.set(stat.id, stat);
    return map;
  }, [statsQuery.data, containers]);

  const states = useMemo(() => {
    const map = new Map<string, string>();
    for (const ctr of containers) map.set(ctr.id, ctr.state);
    return map;
  }, [containers]);

  const serviceStates = useMemo(() => {
    const map = new Map<string, ReturnType<typeof svcState>>();
    for (const svc of services) map.set(svc.name, svcState(svc.name, containers));
    return map;
  }, [services, containers]);

  // Memory trend: session-only ring buffer, no 30-min history exists yet.
  // ponytail: 30 samples max — replace with a backend series if history is added.
  useEffect(() => {
    if (!statsQuery.data?.length) return;
    setTrends((prev) => {
      const next = new Map(prev);
      for (const stat of statsQuery.data) {
        if (!statsById.has(stat.id)) continue;
        const series = [...(next.get(stat.id) ?? []), stat.memoryUsage];
        next.set(stat.id, series.slice(-TREND_POINTS));
      }
      return next;
    });
  }, [statsQuery.data, statsById]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["containers"] });
    void queryClient.invalidateQueries({ queryKey: ["compose-project"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.containerStats() });
    void queryClient.invalidateQueries({ queryKey: ["container-inspect"] });
  };

  const actionMutation = useMutation({
    mutationFn: (request: Parameters<typeof composeAction>[0]) => composeAction(request),
    onError: (err: Error) => message.error(err.message),
  });

  const run = (
    action: string,
    opts: {
      service?: string;
      services?: string[];
      replicas?: number;
      profiles?: string[];
      label?: string;
    } = {},
  ) => {
    if (!workdir) return;
    void actionMutation
      .mutateAsync({
        workdir,
        files,
        action,
        service: opts.service ?? null,
        replicas: opts.replicas ?? null,
        profiles: opts.profiles ?? activeProfiles,
        services: opts.services ?? [],
      })
      .then((result) => {
        if (result.code !== 0) message.error(result.stderr.trim() || `docker compose ${action} failed`);
        else message.success(opts.label ?? `docker compose ${action}`);
        invalidate();
      })
      .catch(() => undefined);
  };

  const act = (ctr: ContainerSummary, verb: "start" | "stop" | "restart") => {
    const service = ctr.composeService;
    if (!service) return;
    if (verb === "start") {
      run("start", { service });
      return;
    }
    const siblingsUp = containers.some(
      (x) => x.composeService === service && x.id !== ctr.id && states.get(x.id) === "running",
    );
    const hits = siblingsUp
      ? []
      : impactOf(service, services).filter((dep) =>
          containers.some((x) => x.composeService === dep.name && states.get(x.id) !== "exited"),
        );
    if (!hits.length) {
      run(verb, { service });
      return;
    }
    const Verb = verb[0].toUpperCase() + verb.slice(1);
    const dialog = modal.confirm({
      title: `${Verb} ${service}?`,
      centered: true,
      width: 520,
      icon: <WarningOutlined style={{ color: "var(--amber)" }} />,
      content: (
        <div>
          <div style={{ marginBottom: 10 }}>
            {hits.length} service{hits.length > 1 ? "s" : ""} depend on <Mono>{service}</Mono>:
          </div>
          <div className="g-impact">
            {hits.map((hit) => (
              <div key={hit.name} className="g-impact-row" style={{ paddingLeft: hit.via ? 22 : 8 }}>
                <Mono>{hit.name}</Mono>
                <span className="dim" style={{ fontSize: 12 }}>
                  {hit.via ? `via ${hit.via}` : `waits for ${service} ${hit.cond}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ),
      okText: `${Verb} ${service} only`,
      okType: verb === "stop" ? "danger" : "default",
      onOk: () => run(verb, { service }),
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          <CancelBtn />
          <OkBtn />
          <Button
            type="primary"
            danger={verb === "stop"}
            onClick={() => {
              run(verb, { service });
              for (const hit of hits) run(verb, { service: hit.name });
              dialog.destroy();
            }}
          >
            {Verb} all {hits.length + 1}
          </Button>
        </>
      ),
    });
  };

  const pause = (ctr: ContainerSummary) => {
    const action = ctr.state === "paused" ? "unpause" : "pause";
    void containerAction(ctr.id, action)
      .then(() => invalidate())
      .catch((err: Error) => message.error(err.message));
  };

  const scale = (service: string, replicas: number) =>
    run("scale", {
      service,
      replicas,
      label: `docker compose up -d --scale ${service}=${replicas} --no-recreate`,
    });

  const toggleProfile = (name: string) => {
    if (activeProfiles.includes(name)) {
      const names = services
        .filter((item) => item.profiles.includes(name))
        .map((item) => item.name);
      if (names.length) {
        // One `rm` for every service in the profile instead of one spawn each.
        run("rm", { services: names, profiles: activeProfiles, label: `profile ${name} off` });
      }
    } else {
      run("up", { profiles: [...activeProfiles, name], label: `docker compose --profile ${name} up -d` });
    }
  };

  const removeOrphans = () => run("remove-orphans", { label: "docker compose up -d --remove-orphans" });

  const down = (volumes: boolean) => {
    modal.confirm({
      title: volumes ? "Down and delete volumes?" : "Take the project down?",
      centered: true,
      okText: volumes ? "Delete everything" : "Down",
      okType: "danger",
      content: (
        <span>
          All <Mono>{containers.length}</Mono> containers and the project networks will be removed.
          {volumes ? " Named volumes are deleted permanently." : " Named volumes are kept."}
        </span>
      ),
      onOk: () => run(volumes ? "down-volumes" : "down"),
    });
  };

  if (containersQuery.isLoading) {
    return (
      <div className="page" style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
        <Spin />
      </div>
    );
  }

  if (!containers.length) {
    return (
      <Result
        status="404"
        title="Project not found"
        subTitle={`No containers are labelled with the compose project "${project}".`}
        extra={<Button onClick={() => navigate("/containers")}>Back to containers</Button>}
      />
    );
  }

  const running = containers.filter((ctr) => ctr.state === "running").length;
  const active = containers.some((ctr) => ctr.state !== "exited");
  const allUp = running === containers.length;
  const health: [string, string] = allUp
    ? ["green", "all running"]
    : running === 0
      ? ["coral", "stopped"]
      : ["amber", "degraded"];
  const pending = actionMutation.isPending;

  const cpu = [...statsById.values()].reduce((sum, stat) => sum + stat.cpuPercent, 0);
  const memory = [...statsById.values()].reduce((sum, stat) => sum + stat.memoryUsage, 0);
  const top = containers.reduce<{ name: string; memory: number } | null>((best, ctr) => {
    const stat = statsById.get(ctr.id);
    if (!stat) return best;
    const name = (ctr.names[0] ?? "").replace(/^\//, "");
    return !best || stat.memoryUsage > best.memory ? { name, memory: stat.memoryUsage } : best;
  }, null);

  const moreItems: MenuProps["items"] = [
    {
      key: "pull",
      icon: <CloudDownloadOutlined />,
      label: "Pull images",
      onClick: () => run("pull", { label: "docker compose pull" }),
    },
    {
      key: "build",
      icon: <BuildOutlined />,
      label: "Build",
      onClick: () => run("build", { label: "docker compose build" }),
    },
    {
      key: "recreate",
      icon: <SyncOutlined />,
      label: "Recreate outdated",
      onClick: () => run("up", { label: "docker compose up -d" }),
    },
    {
      key: "force",
      icon: <SyncOutlined />,
      label: "Force recreate all",
      onClick: () => run("force-recreate", { label: "docker compose up -d --force-recreate" }),
    },
    { type: "divider" },
    {
      key: "cpn",
      icon: <CopyOutlined />,
      label: "Copy project name",
      onClick: () =>
        void navigator.clipboard
          .writeText(config?.config.name ?? project)
          .then(() => message.success("Project name copied")),
    },
    {
      key: "cfg",
      icon: <FileTextOutlined />,
      label: "Copy resolved config",
      onClick: () =>
        config &&
        void navigator.clipboard
          .writeText(config.resolved)
          .then(() => message.success("Resolved config copied")),
    },
    { type: "divider" },
    {
      key: "orph",
      icon: <DisconnectOutlined />,
      disabled: !containers.some((ctr) => !services.some((svc) => svc.name === ctr.composeService)),
      label: "Remove orphans",
      onClick: removeOrphans,
    },
    { key: "down", icon: <DeleteOutlined />, danger: true, label: "Down", onClick: () => down(false) },
    {
      key: "downv",
      icon: <DeleteOutlined />,
      danger: true,
      label: "Down + delete volumes",
      onClick: () => down(true),
    },
  ];

  const openContainer = (id: string, target: string) => navigate(`/containers/${id}?tab=${target}`);

  const tabs = [
    {
      key: "info",
      label: (
        <span>
          <InfoCircleOutlined /> Info
        </span>
      ),
    },
    {
      key: "env",
      label: (
        <span>
          <SettingOutlined /> Environment
        </span>
      ),
    },
    {
      key: "logs",
      label: (
        <span>
          <FileTextOutlined /> Logs
        </span>
      ),
    },
    {
      key: "config",
      label: (
        <span>
          <ApartmentOutlined /> Config
        </span>
      ),
    },
  ];

  const body = !config ? (
    <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
      <Spin />
    </div>
  ) : tab === "info" ? (
    <InfoTab
      config={config}
      containers={containers}
      byService={byService}
      services={services}
      activeProfiles={activeProfiles}
      statsById={statsById}
      trends={trends}
      inspectById={inspectById}
      states={states}
      serviceStates={serviceStates}
      onOpenContainer={openContainer}
      onLogs={(id) => {
        setLogSolo(id);
        setTab("logs");
      }}
      onScale={scale}
      onToggleProfile={toggleProfile}
      act={act}
      pause={pause}
    />
  ) : tab === "env" ? (
    <EnvTab
      containers={containers}
      inspectById={inspectById}
      imageById={imageById}
      states={states}
      onOpenContainer={openContainer}
    />
  ) : tab === "logs" ? (
    <LogsTab key={logSolo ?? "all"} containers={containers} states={states} solo={logSolo} />
  ) : (
    <ConfigTab config={config} />
  );

  return (
    <div>
      <div className="detail-head">
        <div className="detail-head-inner">
          <div className="crumbs">
            <Link to="/containers">Containers</Link>
            <span>/</span>
            <span style={{ color: "var(--fog)" }}>{config?.config.name ?? project}</span>
          </div>

          <div className="head-row">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              aria-label="Back to containers"
              onClick={() => navigate(-1)}
            />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="detail-title">
                <FolderOpenOutlined style={{ color: "var(--fog)", fontSize: 18 }} />
                {config?.config.name ?? project}
                <Pill tone="teal">compose</Pill>
                <Pill tone={health[0]}>{health[1]}</Pill>
              </div>
              <div className="detail-sub">
                <span className="mono">{workdir ?? "—"}</span>
                <span className="dim">·</span>
                <span className="mono dim">
                  {services.length} services · {containers.length} containers
                </span>
                {activeProfiles.length ? (
                  <>
                    <span className="dim">·</span>
                    <span className="mono dim">profiles: {activeProfiles.join(", ")}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="toolbar">
              {!allUp ? (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  disabled={pending}
                  onClick={() => run("up", { label: "docker compose up -d" })}
                >
                  {running === 0 ? "Start" : `Start ${containers.length - running} stopped`}
                </Button>
              ) : null}
              <Button
                icon={<ReloadOutlined />}
                disabled={!active || pending}
                onClick={() => run("restart", { label: "docker compose restart" })}
              >
                Restart
              </Button>
              <Button
                danger
                icon={<PoweroffOutlined />}
                disabled={!active || pending}
                onClick={() => run("stop", { label: "docker compose stop" })}
              >
                Stop
              </Button>
              <Dropdown menu={{ items: moreItems }} trigger={["click"]} placement="bottomRight">
                <Button icon={<MoreOutlined />} aria-label="More actions" />
              </Dropdown>
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="k">Containers</div>
              <div className="v">
                {running}
                <small>/ {containers.length} running</small>
              </div>
              <div className="g-run-bar">
                {containers.map((ctr) => (
                  <Tooltip key={ctr.id} title={`${(ctr.names[0] ?? "").replace(/^\//, "")} · ${ctr.state}`}>
                    <span
                      style={{
                        background: `var(--${ctr.state === "running" ? "green" : ctr.state === "paused" ? "amber" : ctr.state === "exited" ? "coral" : "fog"})`,
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
            </div>
            <div className="stat">
              <div className="k">CPU</div>
              <div className="v">
                {cpu.toFixed(1)}%<small>sum</small>
              </div>
            </div>
            <div className="stat">
              <div className="k">Memory</div>
              <div className="v">
                {formatBytes(memory, 1)}
                {top ? (
                  <small>
                    top: {top.name} {formatBytes(top.memory, 1)}
                  </small>
                ) : null}
              </div>
            </div>
            <div className="stat">
              <div className="k">Volumes</div>
              <div className="v">{Object.keys(config?.config.volumes ?? {}).length}</div>
            </div>
          </div>

          <Tabs
            activeKey={tab}
            onChange={(key) => {
              if (key === "logs") setLogSolo(null);
              setTab(key);
            }}
            items={tabs}
          />
        </div>
      </div>

      <div className="detail-body page" style={{ maxWidth: 1200, margin: "0 auto" }}>
        {body}
      </div>
    </div>
  );
}
