import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Divider, Input, Select, Switch } from "antd";
import { ApiOutlined, LinkOutlined } from "@ant-design/icons";
import { queryKeys } from "../../lib/queryClient";
import {
  listDockerContexts,
  switchDockerEndpoint,
  testConnection,
  getDockerStatus,
} from "../../services/tauriApi";
import type { ConnectionConfig, DockerStatus } from "../../types/docker";

const KIND_OPTIONS = [
  { value: "context", label: "Context default" },
  { value: "unix", label: "Unix socket" },
  { value: "npipe", label: "Named pipe" },
  { value: "tcp", label: "TCP" },
];

const BEHAVIORS: [string, string, string][] = [
  ["autoRefresh", "Live metrics", "Poll container stats every 2s"],
  ["autoScroll", "Follow logs", "Pause auto-scroll when scrolled up"],
  ["confirm", "Confirm destructive actions", "Remove, terminate, prune"],
  ["telemetry", "Anonymous telemetry", "Never sent by default"],
];

function kindFromHost(host: string): ConnectionConfig["kind"] {
  if (host.startsWith("npipe:")) return "npipe";
  if (host.startsWith("tcp:") || host.startsWith("http")) return "tcp";
  return "unix";
}

export default function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [context, setContext] = useState<string | undefined>();
  const [kind, setKind] = useState<string>("context");
  const [value, setValue] = useState("");
  const [ping, setPing] = useState<DockerStatus | null>(null);
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    autoRefresh: true,
    autoScroll: true,
    confirm: true,
    telemetry: false,
  });

  const contexts = useQuery({ queryKey: queryKeys.contexts(), queryFn: listDockerContexts });
  const status = useQuery({ queryKey: queryKeys.status(), queryFn: getDockerStatus });

  useEffect(() => {
    if (contexts.data?.length && !context) {
      const def = contexts.data.find((c) => c.name === "default") ?? contexts.data[0];
      setContext(def.name);
      setValue(def.host);
    }
  }, [contexts.data, context]);

  const config = (): ConnectionConfig => {
    if (kind !== "context") return { kind: kind as ConnectionConfig["kind"], value };
    const selected = contexts.data?.find((c) => c.name === context);
    const host = selected?.host ?? "";
    return { kind: kindFromHost(host), value: host };
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
      queryClient.setQueryData(queryKeys.status(), result);
      void queryClient.invalidateQueries({ queryKey: ["containers"] });
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
        <div className="frame">
          <div className="grow">
            <div className="label">Detected context</div>
            <Select
              style={{ width: "100%" }}
              loading={contexts.isLoading}
              value={context}
              onChange={(next) => {
                setContext(next);
                const host = contexts.data?.find((c) => c.name === next)?.host;
                if (host) {
                  setKind("context");
                  setValue(host);
                }
              }}
              options={(contexts.data ?? []).map((c) => ({ value: c.name, label: `${c.name} · ${c.host}` }))}
            />
          </div>
          <div style={{ width: 150 }}>
            <div className="label">Docker host</div>
            <Select style={{ width: "100%" }} value={kind} onChange={setKind} options={KIND_OPTIONS} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="label">Endpoint</div>
          <Input
            className="mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="unix:///var/run/docker.sock · npipe:////./pipe/docker_engine · tcp://127.0.0.1:2375"
          />
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
          <span>container-gui 0.1.0</span>
          <span>tauri 2.11</span>
          <span>docker engine {status.data?.engineVersion ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
