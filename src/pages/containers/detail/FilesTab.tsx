import {
  ApiOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  HddOutlined,
  LinkOutlined,
  LockOutlined,
  MoreOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  App,
  Button,
  Dropdown,
  Empty,
  Input,
  Spin,
  Switch,
  Table,
  Tooltip,
  Tree,
  type TreeDataNode,
} from "antd";
import { format } from "date-fns";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import CodeView, { detectLanguage } from "../../../components/CodeView";
import { Mono, Pill } from "../../../components/ui";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { useSaveToDownloads } from "../../../hooks/useSaveToDownloads";
import {
  containerChanges,
  listContainerDir,
  readContainerFile,
  saveContainerPath,
  toError,
} from "../../../services/tauriApi";
import { type FileContent, type FsChange, type FsEntry, formatBytes } from "../../../types/docker";
import {
  ancestors,
  classify,
  isSensitive,
  join,
  parentOf,
  resolveLink,
  type Special,
  sortEntries,
} from "./fsPath";
import { containerName, type TabProps } from "./model";

const PAGE = 1_000;
const MAX_PAGE = 20_000;
const MOUNT_TONE: Record<string, string> = { bind: "lav", tmpfs: "amber", volume: "teal" };

type DirState = {
  listing?: { entries: FsEntry[]; truncated: boolean };
  error?: string;
  loading: boolean;
  limit: number;
};

/** What the viewer shows for an opened path after following symlinks. */
type Opened =
  | { kind: "content"; file: FileContent; path: string; chain: string[] }
  | { kind: "special"; special: Exclude<Special, null>; path: string; chain: string[] }
  | { kind: "dir"; path: string; chain: string[] };

/** Read a path, following up to 8 symlinks; stops early at kernel paths. */
async function readResolved(id: string, start: string): Promise<Opened> {
  const chain: string[] = [];
  let path = start;
  for (let hop = 0; hop < 8; hop += 1) {
    const special = classify(path);
    if (special) return { kind: "special", special, path, chain };
    const file = await readContainerFile(id, path);
    if (file.kind === "link" && file.linkTarget) {
      chain.push(path);
      path = resolveLink(path, file.linkTarget);
      continue;
    }
    if (file.kind === "dir") return { kind: "dir", path, chain };
    return { kind: "content", file, path, chain };
  }
  throw new Error(`Too many symlinks starting at ${start}`);
}

/** Track an element's height for antd's virtual Tree/Table, which need a number. */
function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(Math.max(120, Math.floor(entry.contentRect.height))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

function EntryIcon({ entry }: { entry: FsEntry }) {
  if (entry.kind === "dir") return <FolderOutlined style={{ color: "var(--fog)" }} />;
  if (entry.kind === "link") return <LinkOutlined style={{ color: "var(--teal)" }} />;
  if (entry.kind === "char" || entry.kind === "block" || entry.kind === "fifo" || entry.kind === "socket") {
    return <ApiOutlined style={{ color: "var(--ash)" }} />;
  }
  return <FileTextOutlined style={{ color: "var(--fog)" }} />;
}

function DiffPill({ kind }: { kind: FsChange["kind"] }) {
  const [tone, label, tip] =
    kind === "A"
      ? ["green", "added", "Added since the container was created"]
      : kind === "D"
        ? ["coral", "deleted", "Deleted since the container was created"]
        : ["amber", "changed", "Changed since the container was created"];
  return (
    <Tooltip title={tip}>
      <span>
        <Pill tone={tone}>{label}</Pill>
      </span>
    </Tooltip>
  );
}

function FsNote({
  icon,
  title,
  sub,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="fs-empty">
      <span style={{ fontSize: 22, color: "var(--ash)" }}>{icon}</span>
      <div style={{ color: "var(--bone)" }}>{title}</div>
      {sub ? (
        <div className="dim" style={{ fontSize: 12, maxWidth: 440 }}>
          {sub}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

export default function FilesTab({ ctr, onCopy, onOpenTab }: TabProps) {
  const { message } = App.useApp();
  const id = ctr.Id;
  const running = !!ctr.State?.Running;
  const [cwd, setCwd] = useState("/");
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>(["/"]);
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [q, setQ] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [showHidden, setShowHidden] = usePersistentState("files.hidden", z.boolean(), false);
  const [wrap, setWrap] = usePersistentState("files.wrap", z.boolean(), false);
  const [revealed, setRevealed] = useState(false);
  const [treeRef, treeHeight] = useHeight<HTMLDivElement>();
  const [bodyRef, bodyHeight] = useHeight<HTMLDivElement>();
  const save = useSaveToDownloads();

  const load = useCallback(
    async (path: string, limit = PAGE) => {
      setDirs((d) => ({ ...d, [path]: { ...d[path], loading: true, limit } }));
      try {
        const listing = await listContainerDir(id, path, limit);
        setDirs((d) => ({ ...d, [path]: { listing, loading: false, limit } }));
      } catch (err) {
        setDirs((d) => ({ ...d, [path]: { error: toError(err).message, loading: false, limit } }));
      }
    },
    [id],
  );

  // A fresh start for another container or after it (re)starts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: StartedAt marks a new container process
  useEffect(() => {
    setDirs({});
    if (running) void load("/");
  }, [id, running, ctr.State?.StartedAt, load]);

  // Load the directory being viewed if the tree hasn't already.
  useEffect(() => {
    if (running && !dirs[cwd]) void load(cwd);
  }, [cwd, dirs, running, load]);

  const changes = useQuery({
    queryKey: ["container-changes", id],
    queryFn: () => containerChanges(id),
    staleTime: 30_000,
  });
  const changeMap = useMemo(() => new Map((changes.data ?? []).map((c) => [c.path, c.kind])), [changes.data]);
  const changedDirs = useMemo(() => {
    const set = new Set<string>();
    for (const path of changeMap.keys()) for (const a of ancestors(path).slice(0, -1)) set.add(a);
    return set;
  }, [changeMap]);

  const mounts = ctr.Mounts ?? [];
  const mountAt = (path: string) => mounts.find((m) => m.Destination === path);
  const mountFor = (path: string) =>
    mounts
      .filter((m) => m.Destination && (path === m.Destination || path.startsWith(`${m.Destination}/`)))
      .sort((a, b) => (b.Destination?.length ?? 0) - (a.Destination?.length ?? 0))[0];

  const opened = useQuery({
    queryKey: ["container-file", id, open],
    queryFn: () => readResolved(id, open as string),
    enabled: open != null,
    staleTime: 10_000,
    retry: false,
  });

  // A link that turned out to point at a directory navigates there.
  useEffect(() => {
    if (opened.data?.kind === "dir") {
      setOpen(null);
      go(opened.data.path);
    }
  });

  const expandTo = (path: string) => setExpanded((e) => [...new Set([...e, ...ancestors(path)])]);
  const go = (path: string) => {
    setCwd(path);
    setOpen(null);
    setQ("");
    expandTo(path);
  };
  const visit = (path: string, entry?: FsEntry) => {
    if (entry?.kind === "dir" || path === "/") {
      go(path);
      return;
    }
    setCwd(parentOf(path));
    expandTo(parentOf(path));
    setOpen(path);
    setRevealed(false);
  };

  const refresh = () => {
    setDirs({});
    void changes.refetch();
    if (open) void opened.refetch();
    if (running) for (const path of new Set([cwd, ...expanded])) void load(path);
  };

  const visible = (e: FsEntry) => showHidden || !e.name.startsWith(".");

  /* per-row menu; links act on their target, the wrapper keeps clicks from opening the row */
  const rowMenu = (path: string, entry: FsEntry) => {
    const isDir = entry.kind === "dir";
    const copyContents = async () => {
      try {
        const result = await readResolved(id, path);
        if (result.kind !== "content" || result.file.content == null) {
          message.info("Only text files can be copied");
          return;
        }
        onCopy(result.file.content, entry.name);
      } catch (err) {
        message.error(toError(err).message);
      }
    };
    const download = async () => {
      let target = path;
      let archive = isDir;
      if (entry.kind === "link") {
        const result = await readResolved(id, path).catch(() => null);
        if (!result || result.kind === "special") {
          message.info("Nothing to download at the link target");
          return;
        }
        target = result.path;
        archive = result.kind === "dir";
      }
      await save(() => saveContainerPath(id, target, archive));
    };
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: stops row activation; the button inside is the control
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          menu={{
            items: [
              { key: "path", label: "Copy path", icon: <CopyOutlined /> },
              {
                key: "content",
                label: "Copy contents",
                icon: <FileTextOutlined />,
                disabled: isDir || (entry.kind !== "file" && entry.kind !== "link"),
              },
              {
                key: "download",
                label: isDir ? "Download as .tar" : "Download",
                icon: <DownloadOutlined />,
                disabled: !["file", "dir", "link"].includes(entry.kind),
              },
            ],
            onClick: ({ key }) => {
              if (key === "path") onCopy(path, "Path");
              if (key === "content") void copyContents();
              if (key === "download") void download();
            },
          }}
        >
          <Button
            className="fs-act"
            type="text"
            size="small"
            icon={<MoreOutlined />}
            aria-label={`Actions for ${entry.name}`}
          />
        </Dropdown>
      </span>
    );
  };

  const nameCell = (path: string, entry: FsEntry, inTree: boolean) => {
    const mount = mountAt(path);
    const diff = changeMap.get(path);
    return (
      <span className="fs-name">
        {inTree ? null : <EntryIcon entry={entry} />}
        <span
          className="mono"
          style={{ color: entry.kind === "dir" ? "var(--paper)" : inTree ? "var(--fog)" : "var(--mist)" }}
        >
          {entry.name}
        </span>
        {!inTree && entry.kind === "link" && entry.target ? (
          <span className="mono dim">→ {entry.target}</span>
        ) : null}
        {mount ? <Pill tone={MOUNT_TONE[mount.Type ?? ""] ?? "neutral"}>{mount.Type}</Pill> : null}
        {diff ? (
          inTree ? (
            <span className={`fs-dot d-${diff}`} />
          ) : (
            <DiffPill kind={diff} />
          )
        ) : entry.kind === "dir" && changedDirs.has(path) && inTree ? (
          <span className="fs-dot d-C" />
        ) : null}
      </span>
    );
  };

  const treeData = useMemo(() => {
    const build = (path: string, entry: FsEntry): TreeDataNode & { entry: FsEntry } => {
      const state = dirs[path];
      const kids =
        entry.kind === "dir" && state?.listing
          ? sortEntries(state.listing.entries)
              .filter((e) => showHidden || !e.name.startsWith("."))
              .map((child) => build(join(path, child.name), child))
          : undefined;
      return {
        key: path,
        entry,
        isLeaf: entry.kind !== "dir" || (state?.error != null && !state.listing),
        icon:
          path === "/" ? (
            <HddOutlined />
          ) : entry.kind === "dir" ? (
            ({ expanded: isOpen }: { expanded?: boolean }) =>
              isOpen ? <FolderOpenOutlined /> : <FolderOutlined />
          ) : (
            <EntryIcon entry={entry} />
          ),
        title: path,
        children: kids,
      };
    };
    const root: FsEntry = { name: "/", kind: "dir", size: 0, mode: "", owner: "", mtime: 0, target: null };
    return [build("/", root)];
  }, [dirs, showHidden]);

  const loadedKeys = Object.keys(dirs).filter((k) => dirs[k].listing || dirs[k].error);
  const cwdState = dirs[cwd];
  const allEntries = cwdState?.listing?.entries ?? [];
  const hiddenCount = allEntries.filter((e) => e.name.startsWith(".")).length;
  const rows = sortEntries(allEntries)
    .filter(visible)
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .map((entry) => ({ key: join(cwd, entry.name), path: join(cwd, entry.name), entry }));

  const shownPath = open ?? cwd;
  const segs = shownPath === "/" ? [] : shownPath.slice(1).split("/");
  const mount = mountFor(shownPath);
  const data = opened.data;
  const file = data?.kind === "content" ? data.file : null;
  const linked = data && data.chain.length > 0 ? data : null;
  const lines = useMemo(() => (file?.content ? file.content.replace(/\n$/, "").split("\n") : []), [file]);
  const lang = useMemo(
    () => (file?.content ? detectLanguage(data?.path ?? "", file.content) : null),
    [file, data?.path],
  );
  const masked = !!file?.content && isSensitive(data?.path ?? "") && !revealed;

  // Scroll back to the top when switching what's shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on navigation only
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [cwd, open]);

  const downloadOpened = () => {
    if (data?.kind === "content") void save(() => saveContainerPath(id, data.path, false));
  };

  const cols = [
    {
      title: "Name",
      key: "name",
      render: (_: unknown, r: (typeof rows)[number]) => nameCell(r.path, r.entry, false),
    },
    {
      title: "Size",
      key: "size",
      width: 100,
      align: "right" as const,
      render: (_: unknown, r: (typeof rows)[number]) =>
        r.entry.kind === "dir" ? (
          <span className="dim">—</span>
        ) : (
          <span className="mono dim">
            {formatBytes(r.entry.size) === "—" ? "0 B" : formatBytes(r.entry.size)}
          </span>
        ),
    },
    {
      title: "Permissions",
      key: "mode",
      width: 120,
      render: (_: unknown, r: (typeof rows)[number]) => <span className="mono dim">{r.entry.mode}</span>,
    },
    {
      title: "Owner",
      key: "owner",
      width: 90,
      render: (_: unknown, r: (typeof rows)[number]) => <span className="mono dim">{r.entry.owner}</span>,
    },
    {
      title: "Modified",
      key: "mtime",
      width: 140,
      render: (_: unknown, r: (typeof rows)[number]) => (
        <span className="mono dim">
          {r.entry.mtime ? format(new Date(r.entry.mtime * 1000), "yyyy-MM-dd HH:mm") : "—"}
        </span>
      ),
    },
    {
      title: "",
      key: "act",
      width: 44,
      align: "right" as const,
      render: (_: unknown, r: (typeof rows)[number]) => rowMenu(r.path, r.entry),
    },
  ];

  const listing = () => {
    if (!running) {
      return (
        <FsNote
          icon={<FolderOutlined />}
          title="Browsing needs a running container"
          sub="Directory listings run find/stat inside the container. You can still open a file you know the path of — reading uses the archive API, which works on stopped containers."
        >
          <Input.Search
            placeholder="/etc/nginx/nginx.conf"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onSearch={(value) => value.startsWith("/") && visit(value.trim())}
            enterButton="Open"
            style={{ width: 360 }}
          />
        </FsNote>
      );
    }
    if (classify(cwd) === "virtual" && cwd !== "/") {
      return (
        <FsNote
          icon={<FolderOutlined />}
          title={`${cwd} is a kernel-generated filesystem`}
          sub="Its contents are produced on read and are not listed here. Use the Exec tab to inspect it."
        >
          <Button onClick={() => onOpenTab("exec")}>Open Exec tab</Button>
        </FsNote>
      );
    }
    if (!cwdState || (cwdState.loading && !cwdState.listing)) {
      return (
        <div className="fs-empty">
          <Spin />
        </div>
      );
    }
    if (cwdState.error) {
      const noShell = /executable file not found|no such file or directory.*sh|OCI runtime exec failed/i.test(
        cwdState.error,
      );
      return (
        <FsNote
          icon={<FolderOutlined />}
          title={noShell ? "This image has no shell" : `Could not list ${cwd}`}
          sub={
            noShell
              ? "Listing runs sh, find and stat inside the container, and this image (likely distroless or scratch) does not ship them. Files with a known path can still be opened."
              : cwdState.error
          }
        >
          {noShell ? (
            <Input.Search
              placeholder="/app/config.json"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onSearch={(value) => value.startsWith("/") && visit(value.trim())}
              enterButton="Open"
              style={{ width: 360 }}
            />
          ) : (
            <Button icon={<ReloadOutlined />} onClick={() => void load(cwd, cwdState.limit)}>
              Retry
            </Button>
          )}
        </FsNote>
      );
    }
    return (
      <>
        {cwdState.listing?.truncated ? (
          <div className="fs-trunc">
            Showing the first {cwdState.limit.toLocaleString()} entries of a large directory (unsorted
            sample).
            {cwdState.limit < MAX_PAGE ? (
              <Button
                type="link"
                size="small"
                loading={cwdState.loading}
                onClick={() => void load(cwd, MAX_PAGE)}
              >
                Load up to {MAX_PAGE.toLocaleString()}
              </Button>
            ) : (
              <span> Use the Exec tab for the rest.</span>
            )}
          </div>
        ) : null}
        <Table
          size="small"
          virtual
          scroll={{ y: bodyHeight - 40 - (cwdState.listing?.truncated ? 34 : 0) }}
          columns={cols}
          dataSource={rows}
          pagination={false}
          onRow={(r) => ({
            onClick: () => visit(r.path, r.entry),
            onKeyDown: (e) => e.key === "Enter" && visit(r.path, r.entry),
            tabIndex: 0,
          })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  q
                    ? "No matching entries"
                    : hiddenCount && !showHidden
                      ? `Only hidden files (${hiddenCount})`
                      : "Empty directory"
                }
              />
            ),
          }}
        />
      </>
    );
  };

  const viewer = () => {
    if (opened.isLoading) {
      return (
        <div className="fs-empty">
          <Spin />
        </div>
      );
    }
    if (opened.error) {
      return <FsNote icon={<FileOutlined />} title={`Could not open ${open}`} sub={opened.error.message} />;
    }
    if (!data || data.kind === "dir") return null;
    if (data.kind === "special") {
      if (data.special === "virtual") {
        return (
          <FsNote
            icon={<ApiOutlined />}
            title={`${data.path} is generated by the kernel`}
            sub="It has no stored content to preview. Use the Exec tab to read it live."
          >
            <Button onClick={() => onOpenTab("exec")}>Open Exec tab</Button>
          </FsNote>
        );
      }
      return (
        <FsNote
          icon={<ApiOutlined />}
          title={`${data.path} is the container's ${data.special} stream`}
          sub="Output written here is captured by the Docker logging driver, not stored as a file."
        >
          <Button icon={<FileTextOutlined />} onClick={() => onOpenTab("logs")}>
            Open Logs tab
          </Button>
        </FsNote>
      );
    }
    const f = data.file;
    if (f.kind !== "file") {
      return (
        <FsNote
          icon={<ApiOutlined />}
          title={`${f.kind === "char" || f.kind === "block" ? "Device" : "Special"} file`}
          sub="It has no readable content to preview."
        />
      );
    }
    if (f.binary) {
      return (
        <FsNote
          icon={<FileOutlined />}
          title={`Binary file · ${formatBytes(f.size)}`}
          sub="Preview is only available for text files."
        >
          <Button icon={<DownloadOutlined />} onClick={downloadOpened}>
            Download
          </Button>
        </FsNote>
      );
    }
    if (!f.content) return <FsNote icon={<FileOutlined />} title="Empty file" sub="0 bytes" />;
    if (masked) {
      return (
        <FsNote
          icon={<LockOutlined />}
          title={`${data.path.split("/").pop()} may contain secrets`}
          sub="Contents stay hidden until you reveal them. Download and the row menu still use the real file."
        >
          <Button icon={<EyeOutlined />} onClick={() => setRevealed(true)}>
            Reveal contents
          </Button>
        </FsNote>
      );
    }
    return (
      <div className="fs-code">
        {f.truncated ? (
          <div className="fs-trunc">
            Showing the first {formatBytes(f.content.length)} of {formatBytes(f.size)}.
            <Button type="link" size="small" onClick={downloadOpened}>
              Download the full file
            </Button>
          </div>
        ) : null}
        <div className="fs-code-body">
          <CodeView value={f.content} language={lang} wrap={wrap} />
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="fs">
        <div className="fs-tree" ref={treeRef}>
          {running ? (
            <Tree
              showIcon
              blockNode
              height={treeHeight - 16}
              treeData={treeData}
              expandedKeys={expanded}
              loadedKeys={loadedKeys}
              onExpand={(keys) => setExpanded(keys.map(String))}
              loadData={(node) => load(String(node.key))}
              selectedKeys={[open ?? cwd]}
              onSelect={(_, info) => {
                const node = info.node as unknown as { key: string; entry: FsEntry };
                visit(node.key, node.entry);
              }}
              titleRender={(node) => {
                const n = node as unknown as { key: string; entry: FsEntry };
                return (
                  <span className="fs-tnode">
                    {n.key === "/" ? (
                      <span className="fs-name">
                        <span className="mono" style={{ color: "var(--paper)" }}>
                          /
                        </span>
                      </span>
                    ) : (
                      nameCell(n.key, n.entry, true)
                    )}
                    {n.key === "/" ? null : rowMenu(n.key, n.entry)}
                  </span>
                );
              }}
            />
          ) : (
            <div className="dim" style={{ padding: 10, fontSize: 12 }}>
              Start the container to browse.
            </div>
          )}
        </div>

        <div className="fs-main">
          <div className="fs-bar">
            <div className="fs-crumb mono">
              <button
                type="button"
                className={`seg${shownPath === "/" ? " cur" : ""}`}
                onClick={() => go("/")}
              >
                /
              </button>
              {segs.map((s, i) => {
                const p = `/${segs.slice(0, i + 1).join("/")}`;
                const last = i === segs.length - 1;
                return (
                  <Fragment key={p}>
                    {i > 0 ? <span className="sep">/</span> : null}
                    <button
                      type="button"
                      className={`seg${last ? " cur" : ""}`}
                      onClick={() => !last && go(p)}
                    >
                      {s}
                    </button>
                  </Fragment>
                );
              })}
            </div>

            {open ? (
              <>
                {file?.content ? (
                  <span className="switch-label" style={{ marginRight: 4 }}>
                    <Switch size="small" checked={wrap} onChange={setWrap} />
                    <span className="dim">Wrap</span>
                  </span>
                ) : null}
                {file?.kind === "file" ? (
                  <Button size="small" icon={<DownloadOutlined />} onClick={downloadOpened}>
                    Download
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Input
                  size="small"
                  placeholder="Filter"
                  allowClear
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  prefix={<SearchOutlined style={{ color: "var(--ash)" }} />}
                  style={{ width: 170 }}
                />
                <span className="switch-label">
                  <Switch size="small" checked={showHidden} onChange={setShowHidden} />
                  <span className="dim">Hidden</span>
                </span>
                <Tooltip title="Parent folder">
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    aria-label="Parent folder"
                    disabled={cwd === "/"}
                    onClick={() => go(parentOf(cwd))}
                  />
                </Tooltip>
              </>
            )}
            <Tooltip title="Refresh">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                aria-label="Refresh"
                onClick={refresh}
              />
            </Tooltip>
          </div>

          {linked ? (
            <div className="fs-meta mono">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--teal)" }}>
                <LinkOutlined /> symlink → {data?.path}
              </span>
              {data?.kind === "content" ? (
                <Button type="text" size="small" onClick={() => visit(data.path)}>
                  Go to {data.path}
                </Button>
              ) : null}
            </div>
          ) : null}
          {file ? (
            <div className="fs-meta mono">
              <span>{file.mode}</span>
              <span>{formatBytes(file.size) === "—" ? "0 B" : formatBytes(file.size)}</span>
              {file.content ? <span>{lines.length.toLocaleString()} lines</span> : null}
              {file.mtime ? (
                <span>modified {format(new Date(file.mtime * 1000), "yyyy-MM-dd HH:mm")}</span>
              ) : null}
              {lang ? <span>{lang}</span> : null}
              {changeMap.get(data?.path ?? "") ? (
                <DiffPill kind={changeMap.get(data?.path ?? "") as FsChange["kind"]} />
              ) : null}
              {mount ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Pill tone={MOUNT_TONE[mount.Type ?? ""] ?? "neutral"}>{mount.Type}</Pill>
                  {mount.Type === "volume" ? mount.Name : mount.Source || mount.Destination} (
                  {mount.RW === false ? "ro" : "rw"})
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="fs-body" ref={bodyRef}>
            {open ? viewer() : listing()}
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          <Mono>
            docker cp {linked ? "-L " : ""}
            {containerName(ctr)}:{shownPath} .
          </Mono>
        </span>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          Read-only ·{" "}
          {changes.data ? `${changes.data.length} paths differ from the image` : "checking changes…"}
        </span>
      </div>
    </div>
  );
}
