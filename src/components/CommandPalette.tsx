import {
  BlockOutlined,
  ClearOutlined,
  CodeSandboxOutlined,
  DeleteOutlined,
  HddOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQueryClient } from "@tanstack/react-query";
import { App, Input, type InputRef, Modal } from "antd";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "../lib/queryClient";
import {
  containerAction,
  listContainers,
  listImages,
  listVolumes,
  pruneImages,
  pruneVolumes,
} from "../services/tauriApi";
import { formatBytes, shortId } from "../types/docker";
import { Mono } from "./ui";

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  keywords?: string;
  icon: ReactNode;
  badge?: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

interface CommandPaletteContextValue {
  openPalette: () => void;
  setPageCommands: (commands: PaletteCommand[]) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  openPalette: () => {},
  setPageCommands: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

/**
 * Registers contextual commands (such as actions on selected table rows) while
 * the calling page is mounted.
 */
export function usePageCommands(commands: PaletteCommand[]) {
  const { setPageCommands } = useCommandPalette();
  const latestRef = useRef(commands);
  const sig = commands.map((c) => `${c.id}:${c.badge ?? ""}:${c.disabled ? 1 : 0}`).join("|");

  useEffect(() => {
    latestRef.current = commands;
  });

  useEffect(() => {
    setPageCommands(
      latestRef.current.map((cmd, idx) => ({
        ...cmd,
        action: () => latestRef.current[idx]?.action(),
      })),
    );
  }, [sig, setPageCommands]);

  useEffect(() => () => setPageCommands([]), [setPageCommands]);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pageCommands, setPageCommands] = useState<PaletteCommand[]>([]);
  const inputRef = useRef<InputRef>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal, message } = App.useApp();

  const openPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  useHotkey(
    "F1",
    () => {
      if (open) closePalette();
      else openPalette();
    },
    { requireReset: true },
  );

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus({ cursor: "all" });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const invalidateContainers = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.containersPrefix() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.system() }),
    ]);
  }, [queryClient]);

  const runOnAllContainers = useCallback(
    async (kind: "start" | "stop" | "pause" | "remove") => {
      const containers = await queryClient.fetchQuery({
        queryKey: queryKeys.containers(true),
        queryFn: () => listContainers(true),
      });

      if (kind === "start") {
        const targets = containers.filter((c) => c.state !== "running");
        if (!targets.length) {
          message.info("All containers are already running");
          return;
        }
        await Promise.allSettled(
          targets.map((c) => containerAction(c.id, c.state === "paused" ? "unpause" : "start")),
        );
        await invalidateContainers();
        message.success(`Started ${targets.length} container(s)`);
        return;
      }

      if (kind === "stop") {
        const targets = containers.filter(
          (c) => c.state === "running" || c.state === "paused" || c.state === "restarting",
        );
        if (!targets.length) {
          message.info("No running containers to stop");
          return;
        }
        await Promise.allSettled(targets.map((c) => containerAction(c.id, "stop")));
        await invalidateContainers();
        message.success(`Stopped ${targets.length} container(s)`);
        return;
      }

      if (kind === "pause") {
        const targets = containers.filter((c) => c.state === "running");
        if (!targets.length) {
          message.info("No running containers to pause");
          return;
        }
        await Promise.allSettled(targets.map((c) => containerAction(c.id, "pause")));
        await invalidateContainers();
        message.success(`Paused ${targets.length} container(s)`);
        return;
      }

      if (!containers.length) {
        message.info("No containers to delete");
        return;
      }

      modal.confirm({
        title: `Delete all ${containers.length} container(s)?`,
        centered: true,
        okText: "Delete all",
        okType: "danger",
        content: "All running and stopped containers will be removed. Named volumes are kept.",
        onOk: async () => {
          await Promise.allSettled(containers.map((c) => containerAction(c.id, "remove")));
          await invalidateContainers();
          message.success(`Deleted ${containers.length} container(s)`);
        },
      });
    },
    [invalidateContainers, message, modal, queryClient],
  );

  const pruneUnusedImages = useCallback(async () => {
    const [images, containers] = await Promise.all([
      queryClient.fetchQuery({ queryKey: queryKeys.images(), queryFn: listImages }),
      queryClient.fetchQuery({ queryKey: queryKeys.containers(true), queryFn: () => listContainers(true) }),
    ]);
    const usedIds = new Set(containers.map((c) => c.imageId));
    const unused = images.filter((img) => !usedIds.has(img.id));
    if (!unused.length) {
      message.info("No unused images to prune");
      return;
    }
    modal.confirm({
      title: "Prune unused images?",
      centered: true,
      okText: "Prune",
      okType: "danger",
      width: 480,
      content: (
        <div>
          <p style={{ color: "var(--mist)" }}>
            {unused.length} image(s) are not used by any running or stopped container:
          </p>
          <div className="card subtle mono" style={{ maxHeight: 200, overflow: "auto" }}>
            {unused.map((img) => {
              const tags = img.repoTags.filter((t) => t && !t.startsWith("<none>"));
              return <div key={img.id}>{tags.length ? tags.join(", ") : shortId(img.id)}</div>;
            })}
          </div>
          <p className="dim" style={{ marginBottom: 0, fontSize: 12 }}>
            Running and stopped containers are unaffected.
          </p>
        </div>
      ),
      onOk: async () => {
        const reclaimed = await pruneImages(false);
        void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
        message.success(`Reclaimed ${formatBytes(reclaimed)}`);
      },
    });
  }, [message, modal, queryClient]);

  const pruneUnusedVolumes = useCallback(async () => {
    const volumes = await queryClient.fetchQuery({
      queryKey: queryKeys.volumes(),
      queryFn: listVolumes,
    });
    const orphans = volumes.filter((v) => !v.inUse);
    if (!orphans.length) {
      message.info("No unused volumes to prune");
      return;
    }
    modal.confirm({
      title: "Prune unused volumes?",
      centered: true,
      okText: "Prune",
      okType: "danger",
      width: 480,
      content: (
        <div>
          <p style={{ color: "var(--mist)" }}>
            {orphans.length} volume(s) are not attached to any container:
          </p>
          <div className="card subtle mono" style={{ maxHeight: 200, overflow: "auto" }}>
            {orphans.map((o) => (
              <div key={o.name}>{o.name}</div>
            ))}
          </div>
          <p className="dim" style={{ marginBottom: 0, fontSize: 12 }}>
            This permanently deletes data.
          </p>
        </div>
      ),
      onOk: async () => {
        const reclaimed = await pruneVolumes();
        void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
        message.success(`Reclaimed ${formatBytes(reclaimed)}`);
      },
    });
  }, [message, modal, queryClient]);

  const baseCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "nav.containers",
        group: "Navigation",
        label: "Go to Containers",
        keywords: "navigation page containers list",
        icon: <CodeSandboxOutlined />,
        action: () => navigate("/containers"),
      },
      {
        id: "nav.images",
        group: "Navigation",
        label: "Go to Images",
        keywords: "navigation page images list",
        icon: <BlockOutlined />,
        action: () => navigate("/images"),
      },
      {
        id: "nav.volumes",
        group: "Navigation",
        label: "Go to Volumes",
        keywords: "navigation page volumes list storage",
        icon: <HddOutlined />,
        action: () => navigate("/volumes"),
      },
      {
        id: "nav.settings",
        group: "Navigation",
        label: "Go to Settings",
        keywords: "navigation page settings preferences config",
        icon: <SettingOutlined />,
        action: () => navigate("/settings"),
      },
      {
        id: "containers.start-all",
        group: "Containers",
        label: "Start all containers",
        keywords: "containers start all run up",
        icon: <PlayCircleOutlined />,
        action: () => runOnAllContainers("start"),
      },
      {
        id: "containers.stop-all",
        group: "Containers",
        label: "Stop all containers",
        keywords: "containers stop all halt down",
        icon: <PoweroffOutlined />,
        action: () => runOnAllContainers("stop"),
      },
      {
        id: "containers.pause-all",
        group: "Containers",
        label: "Pause all containers",
        keywords: "containers pause all freeze",
        icon: <PauseCircleOutlined />,
        action: () => runOnAllContainers("pause"),
      },
      {
        id: "containers.delete-all",
        group: "Containers",
        label: "Delete all containers",
        keywords: "containers delete remove all rm",
        icon: <DeleteOutlined />,
        danger: true,
        action: () => runOnAllContainers("remove"),
      },
      {
        id: "prune.images",
        group: "Prune",
        label: "Prune unused images",
        keywords: "prune clean unused dangling images",
        icon: <ClearOutlined />,
        danger: true,
        action: pruneUnusedImages,
      },
      {
        id: "prune.volumes",
        group: "Prune",
        label: "Prune unused volumes",
        keywords: "prune clean unused orphan volumes",
        icon: <ClearOutlined />,
        danger: true,
        action: pruneUnusedVolumes,
      },
    ],
    [navigate, pruneUnusedImages, pruneUnusedVolumes, runOnAllContainers],
  );

  const allCommands = useMemo(() => [...pageCommands, ...baseCommands], [pageCommands, baseCommands]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return allCommands;
    return allCommands.filter((cmd) => {
      const hay = `${cmd.group} ${cmd.label} ${cmd.keywords ?? ""} ${cmd.badge ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [allCommands, query]);

  const enabledIndices = useMemo(() => filtered.flatMap((cmd, i) => (cmd.disabled ? [] : [i])), [filtered]);

  const safeActiveIndex = useMemo(() => {
    if (!enabledIndices.length) return -1;
    if (enabledIndices.includes(activeIndex)) return activeIndex;
    return enabledIndices[0];
  }, [activeIndex, enabledIndices]);

  const runCommand = useCallback(
    (cmd: PaletteCommand) => {
      if (cmd.disabled) return;
      closePalette();
      void Promise.resolve(cmd.action()).catch((err: unknown) => {
        message.error(err instanceof Error ? err.message : String(err));
      });
    },
    [closePalette, message],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!enabledIndices.length) return;
      const pos = enabledIndices.indexOf(safeActiveIndex);
      const next = enabledIndices[(pos + 1) % enabledIndices.length];
      setActiveIndex(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-cmd-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!enabledIndices.length) return;
      const pos = enabledIndices.indexOf(safeActiveIndex);
      const next = enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length];
      setActiveIndex(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-cmd-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[safeActiveIndex];
      if (target) runCommand(target);
    }
  };

  // Group filtered commands while preserving their index in `filtered`.
  const groups = useMemo(() => {
    const map = new Map<string, { cmd: PaletteCommand; index: number }[]>();
    filtered.forEach((cmd, index) => {
      const list = map.get(cmd.group) ?? [];
      list.push({ cmd, index });
      map.set(cmd.group, list);
    });
    return [...map.entries()];
  }, [filtered]);

  const contextValue = useMemo(() => ({ openPalette, setPageCommands }), [openPalette]);

  return (
    <CommandPaletteContext.Provider value={contextValue}>
      {children}
      <Modal
        open={open}
        onCancel={closePalette}
        footer={null}
        closable={false}
        width={540}
        style={{ top: 88 }}
        className="cmd-palette-modal"
        destroyOnHidden
      >
        <div className="cmd-palette">
          <div className="cmd-palette-head">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Type a command or search…"
              prefix={<SearchOutlined style={{ color: "var(--ash)" }} />}
              suffix={<Mono>ESC</Mono>}
              variant="borderless"
            />
          </div>
          <div ref={listRef} className="cmd-palette-list">
            {groups.length === 0 ? (
              <div className="cmd-palette-empty dim">No matching commands</div>
            ) : (
              groups.map(([group, items]) => (
                <div key={group} className="cmd-palette-group">
                  <div className="cmd-palette-group-title">{group}</div>
                  {items.map(({ cmd, index }) => {
                    const active = index === safeActiveIndex;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        disabled={cmd.disabled}
                        data-cmd-index={index}
                        className={`cmd-palette-item${active ? " active" : ""}${cmd.danger ? " danger" : ""}${
                          cmd.disabled ? " disabled" : ""
                        }`}
                        onMouseEnter={() => {
                          if (!cmd.disabled) setActiveIndex(index);
                        }}
                        onClick={() => runCommand(cmd)}
                      >
                        <span className="cmd-palette-icon">{cmd.icon}</span>
                        <span className="cmd-palette-label">{cmd.label}</span>
                        {cmd.badge ? <span className="cmd-palette-badge mono">{cmd.badge}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="cmd-palette-foot dim">
            <span>
              <Mono>↑↓</Mono> navigate
            </span>
            <span>
              <Mono>↵</Mono> run
            </span>
            <span>
              <Mono>F1</Mono> / <Mono>ESC</Mono> close
            </span>
          </div>
        </div>
      </Modal>
    </CommandPaletteContext.Provider>
  );
}
