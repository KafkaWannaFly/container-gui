import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Result, Spin, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CommandPaletteProvider, useCommandPalette } from "../components/CommandPalette";
import {
  BlockOutlined,
  BorderOutlined,
  CloseOutlined,
  CodeSandboxOutlined,
  CommandOutlined,
  HddOutlined,
  MinusOutlined,
  ReloadOutlined,
  RestoreOutlined,
  SettingOutlined,
} from "../components/icons";
import { Glyph } from "../components/ui";
import UpdateNotifier from "../components/UpdateNotifier";
import { useDockerEvents } from "../hooks/useDockerEvents";
import { queryKeys } from "../lib/queryClient";
import { getDockerStatus } from "../services/tauriApi";

const NAV = [
  { key: "/containers", label: "Containers", icon: CodeSandboxOutlined },
  { key: "/images", label: "Images", icon: BlockOutlined },
  { key: "/volumes", label: "Volumes", icon: HddOutlined },
  { key: "/settings", label: "Settings", icon: SettingOutlined },
];

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
      <Button
        type="text"
        className="win-btn"
        aria-label="Minimize"
        title="Minimize"
        icon={<MinusOutlined style={{ fontSize: 10 }} />}
        onClick={() => void win.minimize()}
      />
      <Button
        type="text"
        className="win-btn"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        icon={
          maximized ? (
            <RestoreOutlined style={{ fontSize: 10 }} />
          ) : (
            <BorderOutlined style={{ fontSize: 10 }} />
          )
        }
        onClick={() => void win.toggleMaximize()}
      />
      <Button
        type="text"
        className="win-btn close"
        aria-label="Close"
        title="Close"
        icon={<CloseOutlined style={{ fontSize: 10 }} />}
        onClick={() => void win.close()}
      />
    </div>
  );
}

function CommandButton() {
  const { togglePalette } = useCommandPalette();
  return (
    <Tooltip title="Command palette (F1)">
      <Button
        type="text"
        size="small"
        aria-label="Command palette"
        icon={<CommandOutlined />}
        onClick={togglePalette}
      />
    </Tooltip>
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
  // Preferences hosts the backend switcher, so it must stay reachable while Docker is down.
  const preferences = `/${location.pathname.split("/")[1] ?? ""}` === "/settings";
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
          <header className="topbar" data-tauri-drag-region>
            <div className="topbar-brand" data-tauri-drag-region>
              <Glyph />
            </div>
            <div className="topbar-right" data-tauri-drag-region>
              <CommandButton />
              <WindowControls />
            </div>
          </header>

          <aside className="side">{nav}</aside>

          <main className="main">
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
