import {
  BlockOutlined,
  CodeSandboxOutlined,
  HddOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Result, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CommandPaletteProvider } from "../components/CommandPalette";
import { Glyph } from "../components/ui";
import UpdateNotifier from "../components/UpdateNotifier";
import { useDockerEvents } from "../hooks/useDockerEvents";
import { queryKeys } from "../lib/queryClient";
import { getDockerStatus } from "../services/tauriApi";

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

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    void win.setDecorations(false).catch(() => {});
    const sync = () => {
      void win
        .isMaximized()
        .then((val) => {
          if (!disposed) setMaximized(val);
        })
        .catch(() => {});
    };
    sync();
    const unlistenPromise = win.onResized(sync);
    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <div className="win-controls">
      <button
        type="button"
        className="win-btn"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void win.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M3 3V1.5h5.5V7H7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="1.5"
              y="3"
              width="5.5"
              height="5.5"
              rx="0.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="1.5"
              y="1.5"
              width="7"
              height="7"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-btn close"
        aria-label="Close"
        title="Close"
        onClick={() => void win.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default function MainLayout() {
  const location = useLocation();

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
  // Detail routes (/containers/:id) keep their section's title.
  const section = `/${location.pathname.split("/")[1] ?? ""}`;
  const title = TITLES[section] ?? "Container GUI";
  // Preferences hosts the backend switcher, so it must stay reachable while Docker is down.
  const preferences = section === "/settings";
  const showStandby = standby && !preferences;
  const showSpinner = status == null && !preferences;
  useDockerEvents(preferences);
  // Suppress WebView2's native browser find bar on every route; mounted search inputs
  // register their own `Mod+F` handler via `useSearchHotkey`.
  useHotkey("Mod+F", () => {}, {
    requireReset: true,
    conflictBehavior: "allow",
    stopPropagation: false,
  });
  useEffect(() => {
    // Suppress WebView2's native context menu outside text fields; row menus handle their own.
    const suppress = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]"))
        return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

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
                <Icon style={{ fontSize: 14, color: isActive ? "var(--lime)" : "var(--ash)" }} />
                <span style={{ flex: 1 }}>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      }),
    [],
  );

  return (
    <HotkeysProvider>
      <CommandPaletteProvider>
        <div className="app-shell">
          <UpdateNotifier />
          <aside className="side">
            <div className="brand" data-tauri-drag-region>
              <Glyph />
              <span data-tauri-drag-region>Container GUI</span>
            </div>
            {nav}
          </aside>

          <main className="main">
            <div className="topbar" data-tauri-drag-region>
              <span data-tauri-drag-region style={{ fontSize: 14, fontWeight: 510, color: "var(--paper)" }}>
                {title}
              </span>
              <div className="topbar-right" data-tauri-drag-region>
                <WindowControls />
              </div>
            </div>

            <div className="main-body">
              {showStandby ? (
                <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
                  <Result
                    status="warning"
                    title="Docker Daemon Not Reachable"
                    subTitle={
                      status?.message ??
                      "Start Docker Desktop or check the WSL2 backend. Retrying automatically…"
                    }
                    extra={
                      <Button icon={<ReloadOutlined />} onClick={() => void refetch()}>
                        Retry now
                      </Button>
                    }
                  />
                </div>
              ) : showSpinner ? (
                <div style={{ display: "flex", justifyContent: "center", paddingTop: 120 }}>
                  <Spin />
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>

          <footer className="statusbar">
            <div className="statusbar-item">
              <span
                style={{
                  width: 6,
                  height: 6,
                  flex: "0 0 auto",
                  borderRadius: 99,
                  background:
                    status?.state === "connected"
                      ? "var(--green)"
                      : (status?.state ?? "connecting") === "connecting"
                        ? "var(--amber)"
                        : "var(--coral)",
                }}
              />
              <span className="mono statusbar-endpoint" title={status?.endpoint}>
                {status?.endpoint ?? "connecting…"}
              </span>
              {status?.pingMs != null ? <span className="mono statusbar-ping">{status.pingMs}ms</span> : null}
            </div>
          </footer>
        </div>
      </CommandPaletteProvider>
    </HotkeysProvider>
  );
}
