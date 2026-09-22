import { useMemo } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Result, Spin } from "antd";
import {
  CodeSandboxOutlined,
  BlockOutlined,
  HddOutlined,
  SettingOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Glyph } from "../components/ui";
import { queryKeys } from "../lib/queryClient";
import { getDockerStatus } from "../services/tauriApi";
import { useDockerEvents } from "../hooks/useDockerEvents";

const NAV = [
  { key: "/containers", label: "Containers", icon: CodeSandboxOutlined },
  { key: "/images", label: "Images", icon: BlockOutlined },
  { key: "/volumes", label: "Volumes", icon: HddOutlined },
  { key: "/settings", label: "Preferences", icon: SettingOutlined },
];

const TITLES: Record<string, string> = {
  "/containers": "Containers",
  "/images": "Images",
  "/volumes": "Volumes",
  "/settings": "Preferences",
};

function ConnectionBadge() {
  const { data } = useQuery({
    queryKey: queryKeys.status(),
    queryFn: getDockerStatus,
    refetchInterval: 10_000,
  });
  const state = data?.state ?? "connecting";
  const color =
    state === "connected" ? "var(--green)" : state === "connecting" ? "var(--amber)" : "var(--coral)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color }} />
      <span className="mono dim">{data?.endpoint ?? "connecting…"}</span>
      {data?.kind ? <span className="mono dim">· {data.kind}</span> : null}
      {data?.pingMs != null ? <span className="mono dim">· {data.pingMs}ms</span> : null}
    </span>
  );
}

export default function MainLayout() {
  const location = useLocation();
  useDockerEvents();

  const {
    data: status,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.status(),
    queryFn: getDockerStatus,
    refetchInterval: 10_000,
  });

  const standby = isError || (status != null && status.state === "standby");
  const title = TITLES[location.pathname] ?? "Container GUI";

  const nav = useMemo(
    () =>
      NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.key}
            to={item.key}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            {({ isActive }) => (
              <>
                <Icon style={{ fontSize: 14, color: isActive ? "#e4f222" : "#62666d" }} />
                <span style={{ flex: 1 }}>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      }),
    [],
  );

  return (
    <div className="app-shell">
      <aside className="side">
        <div className="brand">
          <Glyph />
          Container GUI
        </div>
        {nav}
        <div className="side-foot">
          <span className="mono">{status?.kind ?? "—"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: status?.state === "connected" ? "var(--green)" : "var(--coral)",
              }}
            />
            <span className="mono">{status?.pingMs != null ? `${status.pingMs}ms` : "n/a"}</span>
          </span>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span style={{ fontSize: 14, fontWeight: 510, color: "var(--paper)" }}>{title}</span>
          <ConnectionBadge />
        </div>

        {standby ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
            <Result
              status="warning"
              title="Docker Daemon Not Reachable"
              subTitle={
                status?.message ?? "Start Docker Desktop or check the WSL2 backend. Retrying automatically…"
              }
              extra={
                <Button icon={<ReloadOutlined />} onClick={() => void refetch()}>
                  Retry now
                </Button>
              }
            />
          </div>
        ) : status == null ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 120 }}>
            <Spin />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
