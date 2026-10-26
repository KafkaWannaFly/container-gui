import {
  ApiOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { App, Button, Divider, Input, Progress, Select, Switch } from "antd";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { usePersistentState } from "../../hooks/usePersistentState";
import { queryKeys } from "../../lib/queryClient";
import {
  getDockerStatus,
  listDockerContexts,
  switchDockerEndpoint,
  testConnection,
} from "../../services/tauriApi";
import { THEMES, useTheme } from "../../theme/antdTheme";
import type { ConnectionConfig, DockerStatus } from "../../types/docker";

const StringListSchema = z.array(z.string());

const BEHAVIORS: [string, string, string][] = [
  ["autoRefresh", "Live metrics", "Poll container stats every 2s"],
  ["autoScroll", "Follow logs", "Pause auto-scroll when scrolled up"],
  ["confirm", "Confirm destructive actions", "Remove, terminate, prune"],
  ["telemetry", "Anonymous telemetry", "Never sent by default"],
];

function kindFromHost(host: string): ConnectionConfig["kind"] {
  const trimmed = host.trim();
  if (
    trimmed.startsWith("npipe:") ||
    trimmed.startsWith("//./pipe/") ||
    trimmed.startsWith("\\\\.\\pipe\\")
  ) {
    return "npipe";
  }
  if (trimmed.startsWith("unix:") || trimmed.startsWith("/")) return "unix";
  if (trimmed.startsWith("tcp:") || trimmed.startsWith("http") || trimmed.includes(":")) return "tcp";
  return "unix";
}

function UpdateControls() {
  const { status, update, percent, error, checkForUpdate, installUpdate } = useAppUpdater();
  const busy = status === "downloading" || status === "installing";

  return (
    <div className="toolbar" style={{ marginTop: 12 }}>
      {status === "available" && update ? (
        <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void installUpdate()}>
          Install {update.version} & restart
        </Button>
      ) : (
        <Button
          icon={<SyncOutlined />}
          loading={status === "checking"}
          disabled={busy}
          onClick={() => void checkForUpdate()}
        >
          Check for updates
        </Button>
      )}
      {busy ? (
        <Progress
          style={{ width: 220, margin: 0 }}
          size="small"
          percent={percent ?? 0}
          status="active"
          showInfo={percent != null}
        />
      ) : null}
      <span className={status === "error" ? "ping-bad" : "dim"} style={{ fontSize: 12 }}>
        {status === "up-to-date" && "You're on the latest version"}
        {status === "available" && update && `Version ${update.version} is available`}
        {status === "installing" && "Installing… the app will restart"}
        {status === "error" && (error ?? "Update failed")}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { themeId, theme, setThemeId } = useTheme();
  // Form fields fall back to what the backend reports until the user edits them.
  const [valueChoice, setValue] = useState<string | undefined>();
  const [customInput, setCustomInput] = useState("");
  const [customEndpoints, setCustomEndpoints] = usePersistentState("custom-endpoints", StringListSchema, []);
  const [removedEndpoints, setRemovedEndpoints] = usePersistentState(
    "removed-endpoints",
    StringListSchema,
    [],
  );
  const [ping, setPing] = useState<DockerStatus | null>(null);
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    autoRefresh: true,
    autoScroll: true,
    confirm: true,
    telemetry: false,
  });

  const contexts = useQuery({ queryKey: queryKeys.contexts(), queryFn: listDockerContexts });
  const status = useQuery({ queryKey: queryKeys.status(), queryFn: getDockerStatus });
  const appInfo = useQuery({
    queryKey: queryKeys.appInfo(),
    queryFn: async () => ({ version: await getVersion(), tauri: await getTauriVersion() }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const endpoint = status.data?.endpoint;

  const options = useMemo(() => {
    const removed = new Set(removedEndpoints);
    const byHost = new Map<string, { value: string; label: string; name?: string; host: string }>();

    for (const ctx of contexts.data ?? []) {
      if (removed.has(ctx.host)) continue;
      const existing = byHost.get(ctx.host);
      const name = existing?.name ? `${existing.name}, ${ctx.name}` : ctx.name;
      byHost.set(ctx.host, {
        value: ctx.host,
        label: `${name} · ${ctx.host}`,
        name,
        host: ctx.host,
      });
    }

    for (const host of customEndpoints) {
      if (removed.has(host) || byHost.has(host)) continue;
      byHost.set(host, { value: host, label: host, host });
    }

    if (endpoint && !removed.has(endpoint) && !byHost.has(endpoint)) {
      byHost.set(endpoint, { value: endpoint, label: endpoint, host: endpoint });
    }

    return Array.from(byHost.values());
  }, [contexts.data, customEndpoints, removedEndpoints, endpoint]);

  const value =
    valueChoice !== undefined && options.some((o) => o.value === valueChoice)
      ? valueChoice
      : endpoint && !removedEndpoints.includes(endpoint)
        ? endpoint
        : (options[0]?.value ?? "");

  const config = (): ConnectionConfig => ({
    kind: kindFromHost(value),
    value,
  });

  const handleAddEndpoint = () => {
    const next = customInput.trim();
    if (!next) return;
    setRemovedEndpoints((prev) => prev.filter((item) => item !== next));
    setCustomEndpoints((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setValue(next);
    setCustomInput("");
  };

  const handleRemoveEndpoint = (target: string) => {
    setCustomEndpoints((prev) => prev.filter((item) => item !== target));
    setRemovedEndpoints((prev) => (prev.includes(target) ? prev : [...prev, target]));
    if (valueChoice === target) {
      setValue(undefined);
    }
  };

  const handleScanContexts = () => {
    setRemovedEndpoints([]);
    void contexts.refetch();
  };

  const testMutation = useMutation({
    mutationFn: () => testConnection(config()),
    onSuccess: (result) => setPing(result),
    onError: (err: Error) => {
      setPing({ ...(status.data as DockerStatus), state: "error", pingMs: null, message: err.message });
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => switchDockerEndpoint(config()),
    onSuccess: (result) => {
      setPing(result);
      setValue(result.endpoint);
      queryClient.setQueryData(queryKeys.status(), result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.containersPrefix() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      message.success(`Connected to ${result.endpoint}`);
    },
    onError: (err: Error) => message.error(err.message),
  });

  return (
    <div className="page">
      <div className="card">
        <div className="section-title">Docker connection</div>
        <div>
          <div className="label">Endpoint</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              aria-label="Endpoint"
              style={{ flex: 1, minWidth: 0 }}
              loading={contexts.isLoading || status.isLoading}
              value={value || undefined}
              placeholder="Select or add a Docker endpoint"
              onChange={(next) => setValue(next)}
              options={options}
              labelRender={({ value: val }) => {
                const opt = options.find((o) => o.value === val);
                const host = opt?.host ?? String(val);
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {opt?.name ? (
                      <>
                        <span>{opt.name}</span>
                        <span className="dim">·</span>
                      </>
                    ) : null}
                    <span className="mono">{host}</span>
                  </span>
                );
              }}
              optionRender={(option) => {
                const { name, host } = option.data;
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {name ? (
                        <>
                          <span>{name}</span>
                          <span className="dim">·</span>
                        </>
                      ) : null}
                      <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {host}
                      </span>
                    </span>
                    <Button
                      type="text"
                      size="small"
                      aria-label={`Remove ${host}`}
                      icon={<DeleteOutlined />}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveEndpoint(host);
                      }}
                    />
                  </div>
                );
              }}
              popupRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "6px 0" }} />
                  <div style={{ display: "flex", gap: 8, padding: "4px 8px 6px" }}>
                    <Input
                      className="mono"
                      size="small"
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddEndpoint();
                        }
                      }}
                      placeholder="unix:///var/run/docker.sock · npipe:////./pipe/docker_engine · tcp://127.0.0.1:2375"
                    />
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      disabled={!customInput.trim()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleAddEndpoint}
                    >
                      Add
                    </Button>
                  </div>
                </>
              )}
            />
            <Button icon={<ReloadOutlined />} loading={contexts.isFetching} onClick={handleScanContexts}>
              Scan
            </Button>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <Button
            icon={<ApiOutlined />}
            loading={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            Test connection
          </Button>
          <Button
            type="primary"
            icon={<LinkOutlined />}
            loading={applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            Apply & reconnect
          </Button>
          {ping ? (
            <span className={ping.state === "connected" ? "ping-ok" : "ping-bad"} style={{ fontSize: 12 }}>
              {ping.state === "connected"
                ? `Connected · ${ping.pingMs ?? "?"} ms`
                : (ping.message ?? "Connection failed")}
            </span>
          ) : null}
        </div>

        {ping?.state === "connected" ? (
          <div className="card subtle" style={{ marginTop: 12 }}>
            <div className="mono dim" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <span>Engine {ping.engineVersion ?? "—"}</span>
              <span>API {ping.apiVersion ?? "—"}</span>
              <span>OS {ping.os ?? "—"}</span>
              <span>Ping {ping.pingMs ?? "—"}ms</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="section-title">Appearance</div>
        <Divider style={{ margin: "0 0 16px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ color: "var(--bone)" }}>Theme</div>
            <div className="dim" style={{ fontSize: 12 }}>
              {theme.description}
            </div>
          </div>
          <Select
            aria-label="Theme"
            style={{ width: 240 }}
            value={themeId}
            onChange={setThemeId}
            options={THEMES.map((t) => ({
              value: t.id,
              label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    {t.swatches.map((color, idx) => (
                      <span
                        key={color}
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 99,
                          background: color,
                          border: `1px solid ${t.palette.graphite}`,
                          marginLeft: idx === 0 ? 0 : -3,
                          flex: "0 0 auto",
                        }}
                      />
                    ))}
                  </span>
                  <span>{t.name}</span>
                </span>
              ),
            }))}
          />
        </div>
      </div>

      <div className="card">
        <div className="section-title">Behavior</div>
        <Divider style={{ margin: "0 0 16px" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 32px" }}>
          {BEHAVIORS.map(([name, title, desc]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ color: "var(--bone)" }}>{title}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {desc}
                </div>
              </div>
              <Switch
                size="small"
                checked={toggles[name]}
                onChange={(checked) => setToggles((prev) => ({ ...prev, [name]: checked }))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-title">About</div>
        <div className="mono dim" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <span>container-gui {appInfo.data?.version ?? "—"}</span>
          <span>tauri {appInfo.data?.tauri ?? "—"}</span>
          <span>docker engine {status.data?.engineVersion ?? "—"}</span>
        </div>
        <UpdateControls />
      </div>
    </div>
  );
}
