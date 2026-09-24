import {
  CodeOutlined,
  CopyOutlined,
  DisconnectOutlined,
  EnterOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button, Empty, Input, Result, Select, Spin, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Mono, StateDot } from "../../../components/ui";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { type ExecSession, execProbe, startExec } from "../../../services/tauriApi";
import { cheatSheet } from "./cheatsheet";
import { containerName, type TabProps } from "./model";

const TERM_THEME = {
  background: "#08090a",
  foreground: "#d0d6e0",
  cursor: "#e4f222",
  selectionBackground: "#383b3f",
  black: "#23252a",
  brightBlack: "#62666d",
  red: "#eb5757",
  green: "#27a644",
  yellow: "#d9a441",
  blue: "#6366f1",
  magenta: "#8b5cf6",
  cyan: "#02b8cc",
  white: "#d0d6e0",
  brightWhite: "#ffffff",
};

export default function ExecTab({ ctr, onCopy }: TabProps) {
  const id = ctr.Id;
  const running = !!ctr.State?.Running && !ctr.State.Paused;
  const [shell, setShell] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "attached" | "ended">("idle");
  const [showSheet, setShowSheet] = usePersistentState("exec.cheatsheet", z.boolean(), true);
  const [filter, setFilter] = useState("");
  const [session, setSession] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const execRef = useRef<ExecSession | null>(null);

  const probe = useQuery({
    queryKey: ["exec-probe", id],
    queryFn: () => execProbe(id),
    enabled: running,
    retry: false,
  });
  const shells = probe.data?.shells ?? [];
  const users = useMemo(() => {
    const configured = ctr.Config?.User || "root";
    return [...new Set([configured, ...(probe.data?.users ?? [])])];
  }, [ctr.Config?.User, probe.data?.users]);
  const activeShell = shell ?? shells[0] ?? null;
  const activeUser = user ?? users[0];

  // One xterm per session; the exec is started with the terminal's size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `session` restarts on Reconnect; shell/user apply to the next session
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !running || !activeShell) return;
    const term = new Terminal({
      theme: TERM_THEME,
      fontFamily: '"Paper Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    const exec = startExec(
      id,
      {
        cmd: [activeShell, "-l"],
        user: activeUser,
        tty: true,
        cols: term.cols,
        rows: term.rows,
        // Level-1 setup: colour, a readable prompt, history that survives
        // reconnects (kept in the container's /tmp).
        env: ["COLORTERM=truecolor", "PS1=\\u@\\h:\\w\\$ ", "HISTFILE=/tmp/.cgui_history"],
      },
      (event) => {
        if (event.kind === "output") term.write(event.data);
        else {
          term.write(
            `\r\n\x1b[36m[session ended${event.code != null ? `, exit ${event.code}` : ""}${event.error ? `: ${event.error}` : ""}]\x1b[0m\r\n`,
          );
          setStatus("ended");
        }
      },
    );
    execRef.current = exec;
    setStatus("attached");
    const input = term.onData((data) => exec.write(data));
    const resize = term.onResize(({ cols, rows }) => exec.resize(cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    term.focus();

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      exec.close();
      term.dispose();
      termRef.current = null;
      execRef.current = null;
    };
  }, [id, running, activeShell != null, session]);

  const disconnect = () => {
    execRef.current?.close();
    termRef.current?.write("\r\n\x1b[36m[disconnected]\x1b[0m\r\n");
    setStatus("ended");
  };

  const insert = (cmd: string) => {
    execRef.current?.write(cmd);
    termRef.current?.focus();
  };

  const groups = useMemo(() => {
    const needle = filter.toLowerCase();
    return cheatSheet(probe.data?.osId ?? "")
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (c) => !needle || c.cmd.toLowerCase().includes(needle) || c.desc.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.items.length);
  }, [filter, probe.data?.osId]);

  if (!running) {
    return (
      <div className="card">
        <Result
          icon={<CodeOutlined style={{ color: "var(--ash)" }} />}
          title="Exec needs a running container"
          subTitle="Start or unpause the container to open a shell inside it."
        />
      </div>
    );
  }
  if (probe.isLoading) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Spin />
      </div>
    );
  }
  if (!activeShell) {
    return (
      <div className="card">
        <Result
          status="warning"
          title="No shell in this container"
          subTitle={
            probe.error?.message ??
            "The image ships no /bin/sh (likely distroless or scratch), so there is nothing to attach to."
          }
        />
      </div>
    );
  }

  const shellLabel = (s: string) => s.split("/").pop() ?? s;

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <span className="label" style={{ margin: 0 }}>
          Shell
        </span>
        <Select
          value={activeShell}
          onChange={(v) => {
            setShell(v);
            setSession((n) => n + 1);
          }}
          style={{ width: 130 }}
          options={shells.map((s) => ({ value: s, label: s }))}
        />
        <span className="label" style={{ margin: "0 0 0 8px" }}>
          User
        </span>
        <Select
          value={activeUser}
          onChange={(v) => {
            setUser(v);
            setSession((n) => n + 1);
          }}
          style={{ width: 130 }}
          options={users.map((u) => ({ value: u, label: u }))}
        />
        {probe.data?.osName ? (
          <span className="dim" style={{ fontSize: 12 }}>
            {probe.data.osName}
          </span>
        ) : null}
        <span className="spacer" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <StateDot state={status === "attached" ? "running" : "exited"} size={7} />
          <span className="mono dim">{status === "attached" ? "attached" : "detached"}</span>
        </span>
        {status === "attached" ? (
          <Button danger icon={<DisconnectOutlined />} onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <Button type="primary" icon={<CodeOutlined />} onClick={() => setSession((n) => n + 1)}>
            Reconnect
          </Button>
        )}
        <Tooltip title={showSheet ? "Hide cheat sheet" : "Show cheat sheet"}>
          <Button
            aria-label="Toggle cheat sheet"
            icon={showSheet ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setShowSheet(!showSheet)}
          />
        </Tooltip>
      </div>

      <div className={`exec-wrap${showSheet ? " with-sheet" : ""}`}>
        <div className="term-host" ref={hostRef} />
        {showSheet ? (
          <aside className="sheet">
            <Input
              size="small"
              allowClear
              placeholder="Filter commands"
              prefix={<SearchOutlined style={{ color: "var(--ash)" }} />}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="sheet-body">
              {groups.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No matching commands" />
              ) : (
                groups.map((g) => (
                  <div key={g.title} className="sheet-group">
                    <div className="sheet-title">{g.title}</div>
                    {g.items.map((c) => {
                      const shortcut = g.title === "Shortcuts";
                      return (
                        <div key={c.cmd} className="sheet-item">
                          <div className="sheet-cmd">
                            <Mono>{c.cmd}</Mono>
                            {shortcut ? null : (
                              <span className="sheet-actions">
                                <Tooltip title="Type into the terminal (not run)">
                                  <Button
                                    type="text"
                                    size="small"
                                    aria-label={`Insert ${c.cmd}`}
                                    icon={<EnterOutlined />}
                                    disabled={status !== "attached"}
                                    onClick={() => insert(c.cmd)}
                                  />
                                </Tooltip>
                                <Tooltip title="Copy">
                                  <Button
                                    type="text"
                                    size="small"
                                    aria-label={`Copy ${c.cmd}`}
                                    icon={<CopyOutlined />}
                                    onClick={() => onCopy(c.cmd, "Command")}
                                  />
                                </Tooltip>
                              </span>
                            )}
                          </div>
                          <div className="sheet-desc">{c.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : null}
      </div>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          <Mono>
            docker exec -it{activeUser !== (ctr.Config?.User || "root") ? ` -u ${activeUser}` : ""}{" "}
            {containerName(ctr)} {shellLabel(activeShell)}
          </Mono>
        </span>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          Changes you make inside the container are lost when it is recreated.
        </span>
      </div>
    </div>
  );
}
