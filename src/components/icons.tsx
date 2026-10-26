import { addCollection, Icon } from "@iconify/react";
import { type ComponentType, type CSSProperties, type HTMLAttributes, useSyncExternalStore } from "react";
import { type IconPackId, useTheme } from "../theme/antdTheme";
import type { FsEntry } from "../types/docker";

type IconSpec = string | { icon: string; color?: string };

const loadedPacks = new Set<IconPackId>();
const loadingPromises = new Map<IconPackId, Promise<void>>();
const packListeners = new Set<() => void>();

function subscribePackStore(listener: () => void) {
  packListeners.add(listener);
  return () => {
    packListeners.delete(listener);
  };
}

export function ensureIconPackLoaded(pack: IconPackId): Promise<void> {
  if (loadedPacks.has(pack)) return Promise.resolve();
  const existing = loadingPromises.get(pack);
  if (existing) return existing;
  const loader =
    pack === "vscode-icons"
      ? import("virtual:iconify-pack/vscode-icons")
      : pack === "catppuccin"
        ? import("virtual:iconify-pack/catppuccin")
        : pack === "material-icon-theme"
          ? import("virtual:iconify-pack/material-icon-theme")
          : pack === "fluent-color"
            ? import("virtual:iconify-pack/fluent-color")
            : pack === "icon-park"
              ? import("virtual:iconify-pack/icon-park")
              : pack === "streamline-color"
                ? import("virtual:iconify-pack/streamline-color")
                : import("virtual:iconify-pack/lucide");
  const promise = loader.then((mod) => {
    for (const collection of mod.default) {
      addCollection(collection);
    }
    loadedPacks.add(pack);
    for (const listener of packListeners) {
      listener();
    }
  });
  loadingPromises.set(pack, promise);
  return promise;
}

function useIconPackReady(pack: IconPackId): boolean {
  const ready = useSyncExternalStore(subscribePackStore, () => loadedPacks.has(pack));
  if (!ready) {
    void ensureIconPackLoaded(pack);
  }
  return ready;
}

const ICON_MAP = {
  ApartmentOutlined: {
    "vscode-icons": "vscode-icons:file-type-docker2",
    catppuccin: "catppuccin:workflow",
    "material-icon-theme": "material-icon-theme:tree",
    "fluent-color": "fluent-color:org-20",
    "icon-park": "icon-park:network-tree",
    "streamline-color": "streamline-color:hierarchy-2-flat",
    lucide: "lucide:network",
  },
  ApiOutlined: {
    "vscode-icons": "codicon:plug",
    catppuccin: { icon: "lucide:plug", color: "var(--ctp-teal)" },
    "material-icon-theme": { icon: "codicon:plug", color: "#26a69a" },
    "fluent-color": "icon-park:api",
    "icon-park": "icon-park:api",
    "streamline-color": "streamline-color:electric-cord-1-flat",
    lucide: "lucide:plug",
  },
  ArrowLeftOutlined: {
    "vscode-icons": "codicon:arrow-left",
    catppuccin: { icon: "lucide:arrow-left", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:arrow-left",
    "fluent-color": "icon-park:arrow-left",
    "icon-park": "icon-park:arrow-left",
    "streamline-color": "icon-park:arrow-left",
    lucide: "lucide:arrow-left",
  },
  ArrowUpOutlined: {
    "vscode-icons": "codicon:arrow-up",
    catppuccin: { icon: "lucide:arrow-up", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:arrow-up",
    "fluent-color": "icon-park:arrow-up",
    "icon-park": "icon-park:arrow-up",
    "streamline-color": "icon-park:arrow-up",
    lucide: "lucide:arrow-up",
  },
  BlockOutlined: {
    "vscode-icons": "vscode-icons:folder-type-images",
    catppuccin: "catppuccin:image",
    "material-icon-theme": "material-icon-theme:image",
    "fluent-color": "fluent-color:layer-diagonal-person-20",
    "icon-park": "icon-park:layers",
    "streamline-color": "streamline-color:archive-box-flat",
    lucide: "lucide:layers",
  },
  BuildOutlined: {
    "vscode-icons": { icon: "codicon:tools", color: "#e8ab53" },
    catppuccin: "catppuccin:rocket",
    "material-icon-theme": "material-icon-theme:rocket",
    "fluent-color": "fluent-color:wrench-20",
    "icon-park": "icon-park:tool",
    "streamline-color": "streamline-color:wrench-flat",
    lucide: "lucide:hammer",
  },
  CaretRightOutlined: {
    "vscode-icons": "codicon:triangle-right",
    catppuccin: { icon: "lucide:chevron-right", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:triangle-right",
    "fluent-color": "icon-park:right-one",
    "icon-park": "icon-park:right-one",
    "streamline-color": "streamline-color:next",
    lucide: "lucide:chevron-right",
  },
  CheckCircleOutlined: {
    "vscode-icons": { icon: "codicon:pass", color: "#89d185" },
    catppuccin: "catppuccin:todo",
    "material-icon-theme": "material-icon-theme:todo",
    "fluent-color": "fluent-color:checkmark-circle-20",
    "icon-park": "icon-park:check-one",
    "streamline-color": "streamline-color:check-flat",
    lucide: "lucide:circle-check",
  },
  CheckOutlined: {
    "vscode-icons": "codicon:check",
    catppuccin: { icon: "lucide:check", color: "var(--ctp-green)" },
    "material-icon-theme": { icon: "codicon:check", color: "#66bb6a" },
    "fluent-color": "fluent-color:checkmark-circle-20",
    "icon-park": "icon-park:check",
    "streamline-color": "streamline-color:check-flat",
    lucide: "lucide:check",
  },
  ClearOutlined: {
    "vscode-icons": "codicon:clear-all",
    catppuccin: { icon: "lucide:brush-cleaning", color: "var(--ctp-mauve)" },
    "material-icon-theme": { icon: "codicon:clear-all", color: "#ab47bc" },
    "fluent-color": "fluent-color:paint-brush-20",
    "icon-park": "icon-park:clear",
    "streamline-color": "streamline-color:recycle-1-flat",
    lucide: "lucide:brush-cleaning",
  },
  CloudDownloadOutlined: {
    "vscode-icons": { icon: "codicon:cloud-download", color: "#75beff" },
    catppuccin: { icon: "lucide:cloud-download", color: "var(--ctp-teal)" },
    "material-icon-theme": { icon: "codicon:cloud-download", color: "#29b6f6" },
    "fluent-color": "fluent-color:cloud-20",
    "icon-park": "icon-park:cloud-storage",
    "streamline-color": "streamline-color:cloud-flat",
    lucide: "lucide:cloud-download",
  },
  CodeOutlined: {
    "vscode-icons": "vscode-icons:file-type-shell",
    catppuccin: "catppuccin:bash",
    "material-icon-theme": "material-icon-theme:console",
    "fluent-color": "fluent-color:code-block-20",
    "icon-park": "icon-park:terminal",
    "streamline-color": "streamline-color:command-flat",
    lucide: "lucide:terminal",
  },
  CodeSandboxOutlined: {
    "vscode-icons": "vscode-icons:file-type-docker",
    catppuccin: "catppuccin:docker",
    "material-icon-theme": "material-icon-theme:docker",
    "fluent-color": "fluent-color:apps-20",
    "icon-park": "icon-park:cube-three",
    "streamline-color": "streamline-color:container-flat",
    lucide: "lucide:box",
  },
  ColumnHeightOutlined: {
    "vscode-icons": "codicon:unfold",
    catppuccin: { icon: "lucide:chevrons-up-down", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:unfold",
    "fluent-color": "icon-park:expand-down",
    "icon-park": "icon-park:expand-down",
    "streamline-color": "streamline-color:expand-flat",
    lucide: "lucide:chevrons-up-down",
  },
  CopyOutlined: {
    "vscode-icons": "codicon:copy",
    catppuccin: { icon: "lucide:copy", color: "var(--ctp-blue)" },
    "material-icon-theme": { icon: "codicon:copy", color: "#42a5f5" },
    "fluent-color": "fluent-color:clipboard-20",
    "icon-park": "icon-park:copy",
    "streamline-color": "streamline-color:clipboard-check-flat",
    lucide: "lucide:copy",
  },
  DeleteOutlined: {
    "vscode-icons": "codicon:trash",
    catppuccin: { icon: "lucide:trash-2", color: "var(--ctp-red)" },
    "material-icon-theme": { icon: "codicon:trash", color: "#ef5350" },
    "fluent-color": "fluent-color:dismiss-circle-20",
    "icon-park": "icon-park:delete",
    "streamline-color": "streamline-color:delete-1-flat",
    lucide: "lucide:trash-2",
  },
  DisconnectOutlined: {
    "vscode-icons": { icon: "codicon:debug-disconnect", color: "#f48771" },
    catppuccin: { icon: "lucide:unplug", color: "var(--ctp-peach)" },
    "material-icon-theme": { icon: "codicon:debug-disconnect", color: "#ffa726" },
    "fluent-color": "icon-park:unlink",
    "icon-park": "icon-park:unlink",
    "streamline-color": "streamline-color:broken-link-2-flat",
    lucide: "lucide:unplug",
  },
  DownOutlined: {
    "vscode-icons": "codicon:chevron-down",
    catppuccin: { icon: "lucide:chevron-down", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:chevron-down",
    "fluent-color": "icon-park:down",
    "icon-park": "icon-park:down",
    "streamline-color": "icon-park:down",
    lucide: "lucide:chevron-down",
  },
  DownloadOutlined: {
    "vscode-icons": "codicon:desktop-download",
    catppuccin: { icon: "lucide:download", color: "var(--ctp-teal)" },
    "material-icon-theme": { icon: "codicon:desktop-download", color: "#26a69a" },
    "fluent-color": "icon-park:download",
    "icon-park": "icon-park:download",
    "streamline-color": "streamline-color:download-circle-flat",
    lucide: "lucide:download",
  },
  EnterOutlined: {
    "vscode-icons": "codicon:newline",
    catppuccin: { icon: "lucide:corner-down-left", color: "var(--ctp-peach)" },
    "material-icon-theme": { icon: "codicon:newline", color: "#ffa726" },
    "fluent-color": "icon-park:enter-key",
    "icon-park": "icon-park:enter-key",
    "streamline-color": "streamline-color:return-2-flat",
    lucide: "lucide:corner-down-left",
  },
  ExpandAltOutlined: {
    "vscode-icons": "codicon:screen-full",
    catppuccin: { icon: "lucide:maximize-2", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:screen-full",
    "fluent-color": "icon-park:full-screen",
    "icon-park": "icon-park:full-screen",
    "streamline-color": "streamline-color:expand-flat",
    lucide: "lucide:maximize-2",
  },
  ExportOutlined: {
    "vscode-icons": "codicon:link-external",
    catppuccin: { icon: "lucide:external-link", color: "var(--ctp-teal)" },
    "material-icon-theme": { icon: "codicon:link-external", color: "#26a69a" },
    "fluent-color": "icon-park:share",
    "icon-park": "icon-park:share",
    "streamline-color": "streamline-color:share-link-flat",
    lucide: "lucide:external-link",
  },
  EyeInvisibleOutlined: {
    "vscode-icons": "codicon:eye-closed",
    catppuccin: { icon: "lucide:eye-off", color: "var(--ctp-mauve)" },
    "material-icon-theme": { icon: "codicon:eye-closed", color: "#ab47bc" },
    "fluent-color": "icon-park:preview-close",
    "icon-park": "icon-park:preview-close",
    "streamline-color": "streamline-color:invisible-1-flat",
    lucide: "lucide:eye-off",
  },
  EyeOutlined: {
    "vscode-icons": "codicon:eye",
    catppuccin: { icon: "lucide:eye", color: "var(--ctp-mauve)" },
    "material-icon-theme": { icon: "codicon:eye", color: "#ab47bc" },
    "fluent-color": "icon-park:preview-open",
    "icon-park": "icon-park:preview-open",
    "streamline-color": "streamline-color:eye-optic-flat",
    lucide: "lucide:eye",
  },
  FileOutlined: {
    "vscode-icons": "vscode-icons:default-file",
    catppuccin: "catppuccin:file",
    "material-icon-theme": "material-icon-theme:document",
    "fluent-color": "fluent-color:document-20",
    "icon-park": "icon-park:file-addition",
    "streamline-color": "streamline-color:new-file-flat",
    lucide: "lucide:file",
  },
  FileTextOutlined: {
    "vscode-icons": "vscode-icons:file-type-log",
    catppuccin: "catppuccin:log",
    "material-icon-theme": "material-icon-theme:log",
    "fluent-color": "fluent-color:document-text-20",
    "icon-park": "icon-park:file-text",
    "streamline-color": "streamline-color:new-file-flat",
    lucide: "lucide:file-text",
  },
  FolderOpenOutlined: {
    "vscode-icons": "vscode-icons:default-folder-opened",
    catppuccin: "catppuccin:folder-open",
    "material-icon-theme": "material-icon-theme:folder-base-open",
    "fluent-color": "fluent-color:document-folder-20",
    "icon-park": "icon-park:folder-open",
    "streamline-color": "streamline-color:folder-check-flat",
    lucide: "lucide:folder-open",
  },
  FolderOutlined: {
    "vscode-icons": "vscode-icons:default-folder",
    catppuccin: "catppuccin:folder",
    "material-icon-theme": "material-icon-theme:folder-base",
    "fluent-color": "fluent-color:document-folder-20",
    "icon-park": "icon-park:folder-close",
    "streamline-color": "streamline-color:folder-check-flat",
    lucide: "lucide:folder",
  },
  HddOutlined: {
    "vscode-icons": "vscode-icons:file-type-db",
    catppuccin: "catppuccin:database",
    "material-icon-theme": "material-icon-theme:database",
    "fluent-color": "fluent-color:database-20",
    "icon-park": "icon-park:hard-disk",
    "streamline-color": "streamline-color:database-flat",
    lucide: "lucide:hard-drive",
  },
  HistoryOutlined: {
    "vscode-icons": "codicon:history",
    catppuccin: { icon: "lucide:history", color: "var(--ctp-yellow)" },
    "material-icon-theme": { icon: "codicon:history", color: "#ffca28" },
    "fluent-color": "fluent-color:history-20",
    "icon-park": "icon-park:history",
    "streamline-color": "streamline-color:circle-clock-flat",
    lucide: "lucide:history",
  },
  InfoCircleOutlined: {
    "vscode-icons": { icon: "codicon:info", color: "#75beff" },
    catppuccin: { icon: "lucide:info", color: "var(--ctp-blue)" },
    "material-icon-theme": { icon: "codicon:info", color: "#42a5f5" },
    "fluent-color": "fluent-color:question-circle-20",
    "icon-park": "icon-park:info",
    "streamline-color": "streamline-color:information-circle-flat",
    lucide: "lucide:info",
  },
  LineChartOutlined: {
    "vscode-icons": { icon: "codicon:graph-line", color: "#75beff" },
    catppuccin: { icon: "lucide:chart-line", color: "var(--ctp-mauve)" },
    "material-icon-theme": { icon: "codicon:graph-line", color: "#ab47bc" },
    "fluent-color": "fluent-color:data-line-20",
    "icon-park": "icon-park:chart-line",
    "streamline-color": "streamline-color:graph-flat",
    lucide: "lucide:chart-line",
  },
  LinkOutlined: {
    "vscode-icons": "codicon:link",
    catppuccin: "catppuccin:url",
    "material-icon-theme": "material-icon-theme:url",
    "fluent-color": "fluent-color:link-20",
    "icon-park": "icon-park:link",
    "streamline-color": "streamline-color:link-chain-flat",
    lucide: "lucide:link",
  },
  LockOutlined: {
    "vscode-icons": "codicon:lock",
    catppuccin: "catppuccin:lock",
    "material-icon-theme": "material-icon-theme:lock",
    "fluent-color": "fluent-color:lock-closed-20",
    "icon-park": "icon-park:lock",
    "streamline-color": "streamline-color:key-flat",
    lucide: "lucide:lock",
  },
  MenuFoldOutlined: {
    "vscode-icons": "codicon:layout-sidebar-right-off",
    catppuccin: { icon: "lucide:panel-right-close", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:layout-sidebar-right-off",
    "fluent-color": "icon-park:menu-fold",
    "icon-park": "icon-park:menu-fold",
    "streamline-color": "streamline-color:layout-window-1-flat",
    lucide: "lucide:panel-right-close",
  },
  MenuUnfoldOutlined: {
    "vscode-icons": "codicon:layout-sidebar-right",
    catppuccin: { icon: "lucide:panel-right-open", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:layout-sidebar-right",
    "fluent-color": "icon-park:menu-unfold",
    "icon-park": "icon-park:menu-unfold",
    "streamline-color": "streamline-color:layout-window-2-flat",
    lucide: "lucide:panel-right-open",
  },
  MinusCircleOutlined: {
    "vscode-icons": { icon: "codicon:stop-circle", color: "#f48771" },
    catppuccin: { icon: "lucide:circle-stop", color: "var(--ctp-red)" },
    "material-icon-theme": { icon: "codicon:stop-circle", color: "#ef5350" },
    "fluent-color": "fluent-color:error-circle-20",
    "icon-park": "icon-park:reduce-one",
    "streamline-color": "streamline-color:button-stop-flat",
    lucide: "lucide:circle-stop",
  },
  MinusOutlined: {
    "vscode-icons": "codicon:remove",
    catppuccin: { icon: "lucide:minus", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:remove",
    "fluent-color": "icon-park:minus",
    "icon-park": "icon-park:minus",
    "streamline-color": "icon-park:minus",
    lucide: "lucide:minus",
  },
  MoreOutlined: {
    "vscode-icons": "codicon:kebab-vertical",
    catppuccin: { icon: "lucide:ellipsis-vertical", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:kebab-vertical",
    "fluent-color": "icon-park:more-one",
    "icon-park": "icon-park:more-one",
    "streamline-color": "streamline-color:horizontal-menu-circle-flat",
    lucide: "lucide:ellipsis-vertical",
  },
  PauseCircleOutlined: {
    "vscode-icons": { icon: "codicon:debug-pause", color: "#cca700" },
    catppuccin: { icon: "lucide:circle-pause", color: "var(--ctp-yellow)" },
    "material-icon-theme": { icon: "codicon:debug-pause", color: "#ffca28" },
    "fluent-color": "icon-park:pause-one",
    "icon-park": "icon-park:pause-one",
    "streamline-color": "streamline-color:button-pause-2-flat",
    lucide: "lucide:circle-pause",
  },
  PlayCircleOutlined: {
    "vscode-icons": { icon: "codicon:play-circle", color: "#89d185" },
    catppuccin: { icon: "lucide:circle-play", color: "var(--ctp-green)" },
    "material-icon-theme": { icon: "codicon:play-circle", color: "#66bb6a" },
    "fluent-color": "fluent-color:fast-forward-circle-24",
    "icon-park": "icon-park:play",
    "streamline-color": "streamline-color:button-play-flat",
    lucide: "lucide:circle-play",
  },
  PlusOutlined: {
    "vscode-icons": "codicon:add",
    catppuccin: { icon: "lucide:plus", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:add",
    "fluent-color": "fluent-color:add-circle-20",
    "icon-park": "icon-park:plus",
    "streamline-color": "streamline-color:add-1-flat",
    lucide: "lucide:plus",
  },
  PoweroffOutlined: {
    "vscode-icons": { icon: "codicon:debug-stop", color: "#f48771" },
    catppuccin: { icon: "lucide:power", color: "var(--ctp-red)" },
    "material-icon-theme": { icon: "codicon:debug-stop", color: "#ef5350" },
    "fluent-color": "icon-park:power",
    "icon-park": "icon-park:power",
    "streamline-color": "streamline-color:button-power-1-flat",
    lucide: "lucide:power",
  },
  ReloadOutlined: {
    "vscode-icons": "codicon:refresh",
    catppuccin: { icon: "lucide:rotate-cw", color: "var(--ctp-blue)" },
    "material-icon-theme": { icon: "codicon:refresh", color: "#42a5f5" },
    "fluent-color": "fluent-color:arrow-sync-20",
    "icon-park": "icon-park:refresh",
    "streamline-color": "streamline-color:arrow-reload-horizontal-1-flat",
    lucide: "lucide:rotate-cw",
  },
  RightOutlined: {
    "vscode-icons": "codicon:chevron-right",
    catppuccin: { icon: "lucide:chevron-right", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:chevron-right",
    "fluent-color": "icon-park:right",
    "icon-park": "icon-park:right",
    "streamline-color": "streamline-color:next",
    lucide: "lucide:chevron-right",
  },
  SearchOutlined: {
    "vscode-icons": "codicon:search",
    catppuccin: "catppuccin:search",
    "material-icon-theme": "material-icon-theme:search",
    "fluent-color": "fluent-color:search-visual-20",
    "icon-park": "icon-park:search",
    "streamline-color": "streamline-color:magnifying-glass-flat",
    lucide: "lucide:search",
  },
  SettingOutlined: {
    "vscode-icons": "vscode-icons:file-type-config",
    catppuccin: "catppuccin:config",
    "material-icon-theme": "material-icon-theme:settings",
    "fluent-color": "fluent-color:settings-20",
    "icon-park": "icon-park:setting-two",
    "streamline-color": "streamline-color:cog-flat",
    lucide: "lucide:settings",
  },
  ShrinkOutlined: {
    "vscode-icons": "codicon:screen-normal",
    catppuccin: { icon: "lucide:minimize-2", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:screen-normal",
    "fluent-color": "icon-park:off-screen",
    "icon-park": "icon-park:off-screen",
    "streamline-color": "streamline-color:arrow-shrink-flat",
    lucide: "lucide:minimize-2",
  },
  StopOutlined: {
    "vscode-icons": { icon: "codicon:circle-slash", color: "#f48771" },
    catppuccin: { icon: "lucide:ban", color: "var(--ctp-red)" },
    "material-icon-theme": { icon: "codicon:circle-slash", color: "#ef5350" },
    "fluent-color": "fluent-color:dismiss-circle-20",
    "icon-park": "icon-park:forbid",
    "streamline-color": "streamline-color:button-stop-flat",
    lucide: "lucide:ban",
  },
  SyncOutlined: {
    "vscode-icons": "codicon:sync",
    catppuccin: { icon: "lucide:refresh-cw", color: "var(--ctp-blue)" },
    "material-icon-theme": { icon: "codicon:sync", color: "#42a5f5" },
    "fluent-color": "fluent-color:arrow-sync-20",
    "icon-park": "icon-park:sync",
    "streamline-color": "streamline-color:arrow-reload-horizontal-2-flat",
    lucide: "lucide:refresh-cw",
  },
  TableOutlined: {
    "vscode-icons": "codicon:table",
    catppuccin: { icon: "lucide:table", color: "var(--ctp-teal)" },
    "material-icon-theme": "material-icon-theme:table",
    "fluent-color": "fluent-color:table-20",
    "icon-park": "icon-park:table-file",
    "streamline-color": "icon-park:table-file",
    lucide: "lucide:table",
  },
  TagOutlined: {
    "vscode-icons": "codicon:tag",
    catppuccin: { icon: "lucide:tag", color: "var(--ctp-mauve)" },
    "material-icon-theme": { icon: "codicon:tag", color: "#ab47bc" },
    "fluent-color": "fluent-color:bookmark-20",
    "icon-park": "icon-park:tag-one",
    "streamline-color": "streamline-color:tag-flat",
    lucide: "lucide:tag",
  },
  VerticalAlignBottomOutlined: {
    "vscode-icons": "codicon:fold-down",
    catppuccin: { icon: "lucide:arrow-down-to-line", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:fold-down",
    "fluent-color": "icon-park:to-bottom",
    "icon-park": "icon-park:to-bottom",
    "streamline-color": "icon-park:to-bottom",
    lucide: "lucide:arrow-down-to-line",
  },
  VerticalAlignMiddleOutlined: {
    "vscode-icons": "codicon:fold",
    catppuccin: { icon: "lucide:chevrons-down-up", color: "var(--ctp-text)" },
    "material-icon-theme": "codicon:fold",
    "fluent-color": "icon-park:collapse-text-input",
    "icon-park": "icon-park:collapse-text-input",
    "streamline-color": "icon-park:collapse-text-input",
    lucide: "lucide:chevrons-down-up",
  },
  WarningOutlined: {
    "vscode-icons": { icon: "codicon:warning", color: "#cca700" },
    catppuccin: { icon: "lucide:triangle-alert", color: "var(--ctp-yellow)" },
    "material-icon-theme": { icon: "codicon:warning", color: "#ffca28" },
    "fluent-color": "fluent-color:warning-20",
    "icon-park": "icon-park:attention",
    "streamline-color": "streamline-color:dangerous-zone-sign-flat",
    lucide: "lucide:triangle-alert",
  },
} satisfies Record<string, Record<IconPackId, IconSpec>>;

type IconName = keyof typeof ICON_MAP;

export interface AppIconProps extends HTMLAttributes<HTMLSpanElement> {
  rotate?: number;
  spin?: boolean;
  packOverride?: IconPackId;
}

function IconifySpan({
  spec,
  rotate,
  spin,
  style,
  className,
  ...rest
}: Omit<AppIconProps, "packOverride"> & { spec: IconSpec }) {
  const { icon, color } = typeof spec === "string" ? { icon: spec, color: undefined } : spec;
  const resolvedColor = color !== undefined && style?.color !== "var(--lime)" ? color : style?.color;
  const mergedStyle: CSSProperties | undefined =
    rotate !== undefined || resolvedColor !== undefined
      ? {
          ...style,
          color: resolvedColor,
          transform:
            rotate !== undefined
              ? [style?.transform, `rotate(${rotate}deg)`].filter(Boolean).join(" ")
              : style?.transform,
        }
      : style;
  const cls = ["anticon", spin ? "anticon-spin" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span aria-hidden={rest["aria-label"] ? undefined : true} className={cls} style={mergedStyle} {...rest}>
      <Icon icon={icon} width="1em" height="1em" aria-hidden="true" />
    </span>
  );
}

function createPackIcon(name: IconName): ComponentType<AppIconProps> {
  function PackIcon({ packOverride, ...props }: AppIconProps) {
    const { iconPackId } = useTheme();
    const activePack = packOverride ?? iconPackId;
    useIconPackReady(activePack);
    return <IconifySpan spec={ICON_MAP[name][activePack]} {...props} />;
  }
  PackIcon.displayName = name;
  return PackIcon;
}

export const ApartmentOutlined = createPackIcon("ApartmentOutlined");
export const ApiOutlined = createPackIcon("ApiOutlined");
export const ArrowLeftOutlined = createPackIcon("ArrowLeftOutlined");
export const ArrowUpOutlined = createPackIcon("ArrowUpOutlined");
export const BlockOutlined = createPackIcon("BlockOutlined");
export const BuildOutlined = createPackIcon("BuildOutlined");
export const CaretRightOutlined = createPackIcon("CaretRightOutlined");
export const CheckCircleOutlined = createPackIcon("CheckCircleOutlined");
export const CheckOutlined = createPackIcon("CheckOutlined");
export const ClearOutlined = createPackIcon("ClearOutlined");
export const CloudDownloadOutlined = createPackIcon("CloudDownloadOutlined");
export const CodeOutlined = createPackIcon("CodeOutlined");
export const CodeSandboxOutlined = createPackIcon("CodeSandboxOutlined");
export const ColumnHeightOutlined = createPackIcon("ColumnHeightOutlined");
export const CopyOutlined = createPackIcon("CopyOutlined");
export const DeleteOutlined = createPackIcon("DeleteOutlined");
export const DisconnectOutlined = createPackIcon("DisconnectOutlined");
export const DownOutlined = createPackIcon("DownOutlined");
export const DownloadOutlined = createPackIcon("DownloadOutlined");
export const EnterOutlined = createPackIcon("EnterOutlined");
export const ExpandAltOutlined = createPackIcon("ExpandAltOutlined");
export const ExportOutlined = createPackIcon("ExportOutlined");
export const EyeInvisibleOutlined = createPackIcon("EyeInvisibleOutlined");
export const EyeOutlined = createPackIcon("EyeOutlined");
export const FileOutlined = createPackIcon("FileOutlined");
export const FileTextOutlined = createPackIcon("FileTextOutlined");
export const FolderOpenOutlined = createPackIcon("FolderOpenOutlined");
export const FolderOutlined = createPackIcon("FolderOutlined");
export const HddOutlined = createPackIcon("HddOutlined");
export const HistoryOutlined = createPackIcon("HistoryOutlined");
export const InfoCircleOutlined = createPackIcon("InfoCircleOutlined");
export const LineChartOutlined = createPackIcon("LineChartOutlined");
export const LinkOutlined = createPackIcon("LinkOutlined");
export const LockOutlined = createPackIcon("LockOutlined");
export const MenuFoldOutlined = createPackIcon("MenuFoldOutlined");
export const MenuUnfoldOutlined = createPackIcon("MenuUnfoldOutlined");
export const MinusCircleOutlined = createPackIcon("MinusCircleOutlined");
export const MinusOutlined = createPackIcon("MinusOutlined");
export const MoreOutlined = createPackIcon("MoreOutlined");
export const PauseCircleOutlined = createPackIcon("PauseCircleOutlined");
export const PlayCircleOutlined = createPackIcon("PlayCircleOutlined");
export const PlusOutlined = createPackIcon("PlusOutlined");
export const PoweroffOutlined = createPackIcon("PoweroffOutlined");
export const ReloadOutlined = createPackIcon("ReloadOutlined");
export const RightOutlined = createPackIcon("RightOutlined");
export const SearchOutlined = createPackIcon("SearchOutlined");
export const SettingOutlined = createPackIcon("SettingOutlined");
export const ShrinkOutlined = createPackIcon("ShrinkOutlined");
export const StopOutlined = createPackIcon("StopOutlined");
export const SyncOutlined = createPackIcon("SyncOutlined");
export const TableOutlined = createPackIcon("TableOutlined");
export const TagOutlined = createPackIcon("TagOutlined");
export const VerticalAlignBottomOutlined = createPackIcon("VerticalAlignBottomOutlined");
export const VerticalAlignMiddleOutlined = createPackIcon("VerticalAlignMiddleOutlined");
export const WarningOutlined = createPackIcon("WarningOutlined");

type RichFsPack = "vscode-icons" | "catppuccin" | "material-icon-theme";

function isRichFsPack(pack: IconPackId): pack is RichFsPack {
  return pack === "vscode-icons" || pack === "catppuccin" || pack === "material-icon-theme";
}

function resolveFolderSpec(pack: RichFsPack, name: string, open: boolean, isRoot?: boolean): string | null {
  if (isRoot) {
    if (pack === "vscode-icons") {
      return open ? "vscode-icons:default-root-folder-opened" : "vscode-icons:default-root-folder";
    }
    if (pack === "material-icon-theme") {
      return open ? "material-icon-theme:folder-core-open" : "material-icon-theme:folder-core";
    }
    return open ? "catppuccin:root-open" : "catppuccin:root";
  }
  const lower = name.toLowerCase();
  if (lower === "etc" || lower === "conf" || lower === "config" || lower === ".config") {
    if (pack === "vscode-icons") {
      return open ? "vscode-icons:folder-type-config-opened" : "vscode-icons:folder-type-config";
    }
    if (pack === "material-icon-theme") {
      return open ? "material-icon-theme:folder-config-open" : "material-icon-theme:folder-config";
    }
    return open ? "catppuccin:folder-config-open" : "catppuccin:folder-config";
  }
  if (lower === "var" || lower === "log" || lower === "logs") {
    if (pack === "vscode-icons") {
      return open ? "vscode-icons:folder-type-log-opened" : "vscode-icons:folder-type-log";
    }
    if (pack === "material-icon-theme") {
      return open ? "material-icon-theme:folder-log-open" : "material-icon-theme:folder-log";
    }
    return open ? "catppuccin:folder-audit-open" : "catppuccin:folder-audit";
  }
  if (
    lower === "db" ||
    lower === "data" ||
    lower === "database" ||
    lower === "postgres" ||
    lower === "mysql" ||
    lower === "redis"
  ) {
    if (pack === "vscode-icons") {
      return open ? "vscode-icons:folder-type-db-opened" : "vscode-icons:folder-type-db";
    }
    if (pack === "material-icon-theme") {
      return open ? "material-icon-theme:folder-database-open" : "material-icon-theme:folder-database";
    }
    return open ? "catppuccin:folder-database-open" : "catppuccin:folder-database";
  }
  if (lower === "docker" || lower === ".docker") {
    if (pack === "vscode-icons") {
      return open ? "vscode-icons:folder-type-docker-opened" : "vscode-icons:folder-type-docker";
    }
    if (pack === "material-icon-theme") {
      return open ? "material-icon-theme:folder-docker-open" : "material-icon-theme:folder-docker";
    }
    return open ? "catppuccin:folder-docker-open" : "catppuccin:folder-docker";
  }
  return null;
}

function resolveFileSpec(pack: RichFsPack, name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("dockerfile") || lower.endsWith(".dockerfile") || lower === ".dockerignore") {
    return pack === "vscode-icons"
      ? "vscode-icons:file-type-docker"
      : pack === "material-icon-theme"
        ? "material-icon-theme:docker"
        : "catppuccin:docker";
  }
  if (lower === "compose.yaml" || lower === "compose.yml" || lower.startsWith("docker-compose.")) {
    return pack === "vscode-icons"
      ? "vscode-icons:file-type-docker2"
      : pack === "material-icon-theme"
        ? "material-icon-theme:docker"
        : "catppuccin:docker-compose";
  }
  if (lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env")) {
    return pack === "vscode-icons"
      ? "vscode-icons:file-type-dotenv"
      : pack === "material-icon-theme"
        ? "material-icon-theme:tune"
        : "catppuccin:env";
  }
  if (
    lower === "hosts" ||
    lower === "hostname" ||
    lower === "resolv.conf" ||
    lower === "passwd" ||
    lower === "group" ||
    lower === "shadow" ||
    lower === "fstab" ||
    lower === "crontab"
  ) {
    return pack === "vscode-icons"
      ? "vscode-icons:file-type-config"
      : pack === "material-icon-theme"
        ? "material-icon-theme:settings"
        : "catppuccin:config";
  }
  if (lower === ".bashrc" || lower === ".bash_profile" || lower === ".profile" || lower === ".zshrc") {
    return pack === "vscode-icons"
      ? "vscode-icons:file-type-shell"
      : pack === "material-icon-theme"
        ? "material-icon-theme:console"
        : "catppuccin:bash";
  }
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  switch (ext) {
    case "json":
    case "jsonc":
    case "json5":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-json"
        : pack === "material-icon-theme"
          ? "material-icon-theme:json"
          : "catppuccin:json";
    case "yaml":
    case "yml":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-yaml"
        : pack === "material-icon-theme"
          ? "material-icon-theme:yaml"
          : "catppuccin:yaml";
    case "toml":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-toml"
        : pack === "material-icon-theme"
          ? "material-icon-theme:toml"
          : "catppuccin:toml";
    case "conf":
    case "cfg":
    case "ini":
    case "cnf":
    case "properties":
    case "service":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-config"
        : pack === "material-icon-theme"
          ? "material-icon-theme:settings"
          : "catppuccin:config";
    case "sh":
    case "bash":
    case "zsh":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-shell"
        : pack === "material-icon-theme"
          ? "material-icon-theme:console"
          : "catppuccin:bash";
    case "js":
    case "mjs":
    case "cjs":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-js"
        : pack === "material-icon-theme"
          ? "material-icon-theme:javascript"
          : "catppuccin:javascript";
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
    case "jsx":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-typescript"
        : pack === "material-icon-theme"
          ? "material-icon-theme:typescript"
          : "catppuccin:typescript";
    case "py":
    case "pyc":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-python"
        : pack === "material-icon-theme"
          ? "material-icon-theme:python"
          : "catppuccin:python";
    case "go":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-go"
        : pack === "material-icon-theme"
          ? "material-icon-theme:go"
          : "catppuccin:go";
    case "md":
    case "markdown":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-markdown"
        : pack === "material-icon-theme"
          ? "material-icon-theme:markdown"
          : "catppuccin:markdown";
    case "log":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-log"
        : pack === "material-icon-theme"
          ? "material-icon-theme:log"
          : "catppuccin:log";
    case "sql":
    case "db":
    case "sqlite":
    case "sqlite3":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-sql"
        : pack === "material-icon-theme"
          ? "material-icon-theme:database"
          : "catppuccin:database";
    case "lock":
      return pack === "vscode-icons"
        ? "codicon:lock"
        : pack === "material-icon-theme"
          ? "material-icon-theme:lock"
          : "catppuccin:lock";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "svg":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-image"
        : pack === "material-icon-theme"
          ? "material-icon-theme:image"
          : "catppuccin:image";
    case "so":
    case "bin":
    case "exe":
    case "o":
    case "a":
    case "wasm":
      return pack === "vscode-icons"
        ? "vscode-icons:file-type-binary"
        : pack === "material-icon-theme"
          ? "material-icon-theme:hex"
          : "catppuccin:binary";
    default:
      return null;
  }
}

export function FolderEntryIcon({
  name,
  open = false,
  isRoot = false,
  style,
}: {
  name: string;
  open?: boolean;
  isRoot?: boolean;
  style?: CSSProperties;
}) {
  const { iconPackId } = useTheme();
  const ready = useIconPackReady(iconPackId);
  if (ready && isRichFsPack(iconPackId)) {
    const spec = resolveFolderSpec(iconPackId, name, open, isRoot);
    if (spec) return <IconifySpan spec={spec} style={style} />;
  }
  if (isRoot) return <HddOutlined style={style} />;
  return open ? <FolderOpenOutlined style={style} /> : <FolderOutlined style={style} />;
}

export function FileEntryIcon({ entry }: { entry: FsEntry }) {
  const { iconPackId } = useTheme();
  const ready = useIconPackReady(iconPackId);
  const richPack = ready && isRichFsPack(iconPackId) ? iconPackId : null;

  if (entry.kind === "dir") {
    return (
      <FolderEntryIcon
        name={entry.name}
        style={iconPackId === "lucide" ? { color: "var(--fog)" } : undefined}
      />
    );
  }
  if (entry.kind === "link") {
    if (richPack) {
      return (
        <IconifySpan
          spec={
            richPack === "vscode-icons"
              ? { icon: "codicon:file-symlink-file", color: "var(--teal)" }
              : richPack === "material-icon-theme"
                ? "material-icon-theme:url"
                : "catppuccin:symlink"
          }
        />
      );
    }
    return <LinkOutlined style={{ color: "var(--teal)" }} />;
  }
  if (entry.kind === "char" || entry.kind === "block" || entry.kind === "fifo" || entry.kind === "socket") {
    return <ApiOutlined style={{ color: "var(--ash)" }} />;
  }
  if (richPack) {
    const spec = resolveFileSpec(richPack, entry.name);
    if (spec) return <IconifySpan spec={spec} />;
  }
  return <FileTextOutlined style={iconPackId === "lucide" ? { color: "var(--fog)" } : undefined} />;
}
