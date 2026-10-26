import {
  ApartmentOutlined as AntApartmentOutlined,
  ApiOutlined as AntApiOutlined,
  ArrowLeftOutlined as AntArrowLeftOutlined,
  ArrowUpOutlined as AntArrowUpOutlined,
  BlockOutlined as AntBlockOutlined,
  BuildOutlined as AntBuildOutlined,
  CaretRightOutlined as AntCaretRightOutlined,
  CheckCircleOutlined as AntCheckCircleOutlined,
  CheckOutlined as AntCheckOutlined,
  ClearOutlined as AntClearOutlined,
  CloudDownloadOutlined as AntCloudDownloadOutlined,
  CodeOutlined as AntCodeOutlined,
  CodeSandboxOutlined as AntCodeSandboxOutlined,
  ColumnHeightOutlined as AntColumnHeightOutlined,
  CopyOutlined as AntCopyOutlined,
  DeleteOutlined as AntDeleteOutlined,
  DisconnectOutlined as AntDisconnectOutlined,
  DownloadOutlined as AntDownloadOutlined,
  DownOutlined as AntDownOutlined,
  EnterOutlined as AntEnterOutlined,
  ExpandAltOutlined as AntExpandAltOutlined,
  ExportOutlined as AntExportOutlined,
  EyeInvisibleOutlined as AntEyeInvisibleOutlined,
  EyeOutlined as AntEyeOutlined,
  FileOutlined as AntFileOutlined,
  FileTextOutlined as AntFileTextOutlined,
  FolderOpenOutlined as AntFolderOpenOutlined,
  FolderOutlined as AntFolderOutlined,
  HddOutlined as AntHddOutlined,
  HistoryOutlined as AntHistoryOutlined,
  InfoCircleOutlined as AntInfoCircleOutlined,
  LineChartOutlined as AntLineChartOutlined,
  LinkOutlined as AntLinkOutlined,
  LockOutlined as AntLockOutlined,
  MenuFoldOutlined as AntMenuFoldOutlined,
  MenuUnfoldOutlined as AntMenuUnfoldOutlined,
  MinusCircleOutlined as AntMinusCircleOutlined,
  MinusOutlined as AntMinusOutlined,
  MoreOutlined as AntMoreOutlined,
  PauseCircleOutlined as AntPauseCircleOutlined,
  PlayCircleOutlined as AntPlayCircleOutlined,
  PlusOutlined as AntPlusOutlined,
  PoweroffOutlined as AntPoweroffOutlined,
  ReloadOutlined as AntReloadOutlined,
  RightOutlined as AntRightOutlined,
  SearchOutlined as AntSearchOutlined,
  SettingOutlined as AntSettingOutlined,
  ShrinkOutlined as AntShrinkOutlined,
  StopOutlined as AntStopOutlined,
  SyncOutlined as AntSyncOutlined,
  TableOutlined as AntTableOutlined,
  TagOutlined as AntTagOutlined,
  VerticalAlignBottomOutlined as AntVerticalAlignBottomOutlined,
  VerticalAlignMiddleOutlined as AntVerticalAlignMiddleOutlined,
  WarningOutlined as AntWarningOutlined,
} from "@ant-design/icons";
import { addCollection, Icon } from "@iconify/react";
import { type ComponentType, type CSSProperties, type HTMLAttributes, useSyncExternalStore } from "react";
import { type IconPackId, useTheme } from "../theme/antdTheme";
import type { FsEntry } from "../types/docker";

type NonAntdPackId = Exclude<IconPackId, "antd">;
type IconSpec = string | { icon: string; color?: string };

const loadedPacks = new Set<NonAntdPackId>();
const loadingPromises = new Map<NonAntdPackId, Promise<void>>();
const packListeners = new Set<() => void>();

function subscribePackStore(listener: () => void) {
  packListeners.add(listener);
  return () => {
    packListeners.delete(listener);
  };
}

export function ensureIconPackLoaded(pack: IconPackId): Promise<void> {
  if (pack === "antd" || loadedPacks.has(pack)) return Promise.resolve();
  const existing = loadingPromises.get(pack);
  if (existing) return existing;
  const loader =
    pack === "lucide"
      ? import("virtual:iconify-pack/lucide")
      : pack === "hugeicons"
        ? import("virtual:iconify-pack/hugeicons")
        : pack === "vscode-icons"
          ? import("virtual:iconify-pack/vscode-icons")
          : import("virtual:iconify-pack/catppuccin");
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
  const ready = useSyncExternalStore(subscribePackStore, () => pack === "antd" || loadedPacks.has(pack));
  if (!ready && pack !== "antd") {
    void ensureIconPackLoaded(pack);
  }
  return ready;
}

const ICON_MAP = {
  ApartmentOutlined: {
    lucide: "lucide:network",
    hugeicons: "hugeicons:hierarchy-square-01",
    "vscode-icons": "vscode-icons:file-type-docker2",
    catppuccin: "catppuccin:workflow",
  },
  ApiOutlined: {
    lucide: "lucide:plug",
    hugeicons: "hugeicons:plug-01",
    "vscode-icons": "codicon:plug",
    catppuccin: { icon: "lucide:plug", color: "var(--ctp-teal)" },
  },
  ArrowLeftOutlined: {
    lucide: "lucide:arrow-left",
    hugeicons: "hugeicons:arrow-left-01",
    "vscode-icons": "codicon:arrow-left",
    catppuccin: { icon: "lucide:arrow-left", color: "var(--ctp-text)" },
  },
  ArrowUpOutlined: {
    lucide: "lucide:arrow-up",
    hugeicons: "hugeicons:arrow-up-01",
    "vscode-icons": "codicon:arrow-up",
    catppuccin: { icon: "lucide:arrow-up", color: "var(--ctp-text)" },
  },
  BlockOutlined: {
    lucide: "lucide:layers",
    hugeicons: "hugeicons:layers-01",
    "vscode-icons": "vscode-icons:folder-type-images",
    catppuccin: "catppuccin:image",
  },
  BuildOutlined: {
    lucide: "lucide:hammer",
    hugeicons: "hugeicons:wrench-01",
    "vscode-icons": { icon: "codicon:tools", color: "#e8ab53" },
    catppuccin: "catppuccin:rocket",
  },
  CaretRightOutlined: {
    lucide: "lucide:chevron-right",
    hugeicons: "hugeicons:arrow-right-01",
    "vscode-icons": "codicon:triangle-right",
    catppuccin: { icon: "lucide:chevron-right", color: "var(--ctp-text)" },
  },
  CheckCircleOutlined: {
    lucide: "lucide:circle-check",
    hugeicons: "hugeicons:checkmark-circle-02",
    "vscode-icons": { icon: "codicon:pass", color: "#89d185" },
    catppuccin: "catppuccin:todo",
  },
  CheckOutlined: {
    lucide: "lucide:check",
    hugeicons: "hugeicons:tick-02",
    "vscode-icons": "codicon:check",
    catppuccin: { icon: "lucide:check", color: "var(--ctp-green)" },
  },
  ClearOutlined: {
    lucide: "lucide:brush-cleaning",
    hugeicons: "hugeicons:clean",
    "vscode-icons": "codicon:clear-all",
    catppuccin: { icon: "lucide:brush-cleaning", color: "var(--ctp-mauve)" },
  },
  CloudDownloadOutlined: {
    lucide: "lucide:cloud-download",
    hugeicons: "hugeicons:cloud-download",
    "vscode-icons": { icon: "codicon:cloud-download", color: "#75beff" },
    catppuccin: { icon: "lucide:cloud-download", color: "var(--ctp-teal)" },
  },
  CodeOutlined: {
    lucide: "lucide:terminal",
    hugeicons: "hugeicons:computer-terminal-01",
    "vscode-icons": "vscode-icons:file-type-shell",
    catppuccin: "catppuccin:bash",
  },
  CodeSandboxOutlined: {
    lucide: "lucide:box",
    hugeicons: "hugeicons:cube",
    "vscode-icons": "vscode-icons:file-type-docker",
    catppuccin: "catppuccin:docker",
  },
  ColumnHeightOutlined: {
    lucide: "lucide:chevrons-up-down",
    hugeicons: "hugeicons:unfold-more",
    "vscode-icons": "codicon:unfold",
    catppuccin: { icon: "lucide:chevrons-up-down", color: "var(--ctp-text)" },
  },
  CopyOutlined: {
    lucide: "lucide:copy",
    hugeicons: "hugeicons:copy-01",
    "vscode-icons": "codicon:copy",
    catppuccin: { icon: "lucide:copy", color: "var(--ctp-blue)" },
  },
  DeleteOutlined: {
    lucide: "lucide:trash-2",
    hugeicons: "hugeicons:delete-02",
    "vscode-icons": "codicon:trash",
    catppuccin: { icon: "lucide:trash-2", color: "var(--ctp-red)" },
  },
  DisconnectOutlined: {
    lucide: "lucide:unplug",
    hugeicons: "hugeicons:unplug",
    "vscode-icons": { icon: "codicon:debug-disconnect", color: "#f48771" },
    catppuccin: { icon: "lucide:unplug", color: "var(--ctp-peach)" },
  },
  DownOutlined: {
    lucide: "lucide:chevron-down",
    hugeicons: "hugeicons:arrow-down-01",
    "vscode-icons": "codicon:chevron-down",
    catppuccin: { icon: "lucide:chevron-down", color: "var(--ctp-text)" },
  },
  DownloadOutlined: {
    lucide: "lucide:download",
    hugeicons: "hugeicons:download-04",
    "vscode-icons": "codicon:desktop-download",
    catppuccin: { icon: "lucide:download", color: "var(--ctp-teal)" },
  },
  EnterOutlined: {
    lucide: "lucide:corner-down-left",
    hugeicons: "hugeicons:arrow-turn-backward",
    "vscode-icons": "codicon:newline",
    catppuccin: { icon: "lucide:corner-down-left", color: "var(--ctp-peach)" },
  },
  ExpandAltOutlined: {
    lucide: "lucide:maximize-2",
    hugeicons: "hugeicons:arrow-expand-01",
    "vscode-icons": "codicon:screen-full",
    catppuccin: { icon: "lucide:maximize-2", color: "var(--ctp-text)" },
  },
  ExportOutlined: {
    lucide: "lucide:external-link",
    hugeicons: "hugeicons:link-square-02",
    "vscode-icons": "codicon:link-external",
    catppuccin: { icon: "lucide:external-link", color: "var(--ctp-teal)" },
  },
  EyeInvisibleOutlined: {
    lucide: "lucide:eye-off",
    hugeicons: "hugeicons:view-off-slash",
    "vscode-icons": "codicon:eye-closed",
    catppuccin: { icon: "lucide:eye-off", color: "var(--ctp-mauve)" },
  },
  EyeOutlined: {
    lucide: "lucide:eye",
    hugeicons: "hugeicons:view",
    "vscode-icons": "codicon:eye",
    catppuccin: { icon: "lucide:eye", color: "var(--ctp-mauve)" },
  },
  FileOutlined: {
    lucide: "lucide:file",
    hugeicons: "hugeicons:file-01",
    "vscode-icons": "vscode-icons:default-file",
    catppuccin: "catppuccin:file",
  },
  FileTextOutlined: {
    lucide: "lucide:file-text",
    hugeicons: "hugeicons:file-02",
    "vscode-icons": "vscode-icons:file-type-log",
    catppuccin: "catppuccin:log",
  },
  FolderOpenOutlined: {
    lucide: "lucide:folder-open",
    hugeicons: "hugeicons:folder-open",
    "vscode-icons": "vscode-icons:default-folder-opened",
    catppuccin: "catppuccin:folder-open",
  },
  FolderOutlined: {
    lucide: "lucide:folder",
    hugeicons: "hugeicons:folder-01",
    "vscode-icons": "vscode-icons:default-folder",
    catppuccin: "catppuccin:folder",
  },
  HddOutlined: {
    lucide: "lucide:hard-drive",
    hugeicons: "hugeicons:hard-drive",
    "vscode-icons": "vscode-icons:file-type-db",
    catppuccin: "catppuccin:database",
  },
  HistoryOutlined: {
    lucide: "lucide:history",
    hugeicons: "hugeicons:time-02",
    "vscode-icons": "codicon:history",
    catppuccin: { icon: "lucide:history", color: "var(--ctp-yellow)" },
  },
  InfoCircleOutlined: {
    lucide: "lucide:info",
    hugeicons: "hugeicons:information-circle",
    "vscode-icons": { icon: "codicon:info", color: "#75beff" },
    catppuccin: { icon: "lucide:info", color: "var(--ctp-blue)" },
  },
  LineChartOutlined: {
    lucide: "lucide:chart-line",
    hugeicons: "hugeicons:analytics-up",
    "vscode-icons": { icon: "codicon:graph-line", color: "#75beff" },
    catppuccin: { icon: "lucide:chart-line", color: "var(--ctp-mauve)" },
  },
  LinkOutlined: {
    lucide: "lucide:link",
    hugeicons: "hugeicons:link-01",
    "vscode-icons": "codicon:link",
    catppuccin: "catppuccin:url",
  },
  LockOutlined: {
    lucide: "lucide:lock",
    hugeicons: "hugeicons:square-lock-02",
    "vscode-icons": "codicon:lock",
    catppuccin: "catppuccin:lock",
  },
  MenuFoldOutlined: {
    lucide: "lucide:panel-right-close",
    hugeicons: "hugeicons:sidebar-right-01",
    "vscode-icons": "codicon:layout-sidebar-right-off",
    catppuccin: { icon: "lucide:panel-right-close", color: "var(--ctp-text)" },
  },
  MenuUnfoldOutlined: {
    lucide: "lucide:panel-right-open",
    hugeicons: "hugeicons:sidebar-right",
    "vscode-icons": "codicon:layout-sidebar-right",
    catppuccin: { icon: "lucide:panel-right-open", color: "var(--ctp-text)" },
  },
  MinusCircleOutlined: {
    lucide: "lucide:circle-stop",
    hugeicons: "hugeicons:stop-circle",
    "vscode-icons": { icon: "codicon:stop-circle", color: "#f48771" },
    catppuccin: { icon: "lucide:circle-stop", color: "var(--ctp-red)" },
  },
  MinusOutlined: {
    lucide: "lucide:minus",
    hugeicons: "hugeicons:minus-sign",
    "vscode-icons": "codicon:remove",
    catppuccin: { icon: "lucide:minus", color: "var(--ctp-text)" },
  },
  MoreOutlined: {
    lucide: "lucide:ellipsis-vertical",
    hugeicons: "hugeicons:more-vertical",
    "vscode-icons": "codicon:kebab-vertical",
    catppuccin: { icon: "lucide:ellipsis-vertical", color: "var(--ctp-text)" },
  },
  PauseCircleOutlined: {
    lucide: "lucide:circle-pause",
    hugeicons: "hugeicons:pause-circle",
    "vscode-icons": { icon: "codicon:debug-pause", color: "#cca700" },
    catppuccin: { icon: "lucide:circle-pause", color: "var(--ctp-yellow)" },
  },
  PlayCircleOutlined: {
    lucide: "lucide:circle-play",
    hugeicons: "hugeicons:play-circle",
    "vscode-icons": { icon: "codicon:play-circle", color: "#89d185" },
    catppuccin: { icon: "lucide:circle-play", color: "var(--ctp-green)" },
  },
  PlusOutlined: {
    lucide: "lucide:plus",
    hugeicons: "hugeicons:plus-sign",
    "vscode-icons": "codicon:add",
    catppuccin: { icon: "lucide:plus", color: "var(--ctp-text)" },
  },
  PoweroffOutlined: {
    lucide: "lucide:power",
    hugeicons: "hugeicons:power-service",
    "vscode-icons": { icon: "codicon:debug-stop", color: "#f48771" },
    catppuccin: { icon: "lucide:power", color: "var(--ctp-red)" },
  },
  ReloadOutlined: {
    lucide: "lucide:rotate-cw",
    hugeicons: "hugeicons:reload",
    "vscode-icons": "codicon:refresh",
    catppuccin: { icon: "lucide:rotate-cw", color: "var(--ctp-blue)" },
  },
  RightOutlined: {
    lucide: "lucide:chevron-right",
    hugeicons: "hugeicons:arrow-right-01",
    "vscode-icons": "codicon:chevron-right",
    catppuccin: { icon: "lucide:chevron-right", color: "var(--ctp-text)" },
  },
  SearchOutlined: {
    lucide: "lucide:search",
    hugeicons: "hugeicons:search-01",
    "vscode-icons": "codicon:search",
    catppuccin: "catppuccin:search",
  },
  SettingOutlined: {
    lucide: "lucide:settings",
    hugeicons: "hugeicons:settings-01",
    "vscode-icons": "vscode-icons:file-type-config",
    catppuccin: "catppuccin:config",
  },
  ShrinkOutlined: {
    lucide: "lucide:minimize-2",
    hugeicons: "hugeicons:arrow-shrink-01",
    "vscode-icons": "codicon:screen-normal",
    catppuccin: { icon: "lucide:minimize-2", color: "var(--ctp-text)" },
  },
  StopOutlined: {
    lucide: "lucide:ban",
    hugeicons: "hugeicons:unavailable",
    "vscode-icons": { icon: "codicon:circle-slash", color: "#f48771" },
    catppuccin: { icon: "lucide:ban", color: "var(--ctp-red)" },
  },
  SyncOutlined: {
    lucide: "lucide:refresh-cw",
    hugeicons: "hugeicons:refresh",
    "vscode-icons": "codicon:sync",
    catppuccin: { icon: "lucide:refresh-cw", color: "var(--ctp-blue)" },
  },
  TableOutlined: {
    lucide: "lucide:table",
    hugeicons: "hugeicons:table",
    "vscode-icons": "codicon:table",
    catppuccin: { icon: "lucide:table", color: "var(--ctp-teal)" },
  },
  TagOutlined: {
    lucide: "lucide:tag",
    hugeicons: "hugeicons:tag-01",
    "vscode-icons": "codicon:tag",
    catppuccin: { icon: "lucide:tag", color: "var(--ctp-mauve)" },
  },
  VerticalAlignBottomOutlined: {
    lucide: "lucide:arrow-down-to-line",
    hugeicons: "hugeicons:arrow-down-03",
    "vscode-icons": "codicon:fold-down",
    catppuccin: { icon: "lucide:arrow-down-to-line", color: "var(--ctp-text)" },
  },
  VerticalAlignMiddleOutlined: {
    lucide: "lucide:chevrons-down-up",
    hugeicons: "hugeicons:unfold-less",
    "vscode-icons": "codicon:fold",
    catppuccin: { icon: "lucide:chevrons-down-up", color: "var(--ctp-text)" },
  },
  WarningOutlined: {
    lucide: "lucide:triangle-alert",
    hugeicons: "hugeicons:alert-02",
    "vscode-icons": { icon: "codicon:warning", color: "#cca700" },
    catppuccin: { icon: "lucide:triangle-alert", color: "var(--ctp-yellow)" },
  },
} satisfies Record<string, Record<NonAntdPackId, IconSpec>>;

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

function createPackIcon(
  name: IconName,
  AntComp: ComponentType<Omit<AppIconProps, "packOverride">>,
): ComponentType<AppIconProps> {
  function PackIcon({ packOverride, ...props }: AppIconProps) {
    const { iconPackId } = useTheme();
    const activePack = packOverride ?? iconPackId;
    const ready = useIconPackReady(activePack);
    if (activePack === "antd" || !ready) {
      return <AntComp {...props} />;
    }
    return <IconifySpan spec={ICON_MAP[name][activePack]} {...props} />;
  }
  PackIcon.displayName = name;
  return PackIcon;
}

export const ApartmentOutlined = createPackIcon("ApartmentOutlined", AntApartmentOutlined);
export const ApiOutlined = createPackIcon("ApiOutlined", AntApiOutlined);
export const ArrowLeftOutlined = createPackIcon("ArrowLeftOutlined", AntArrowLeftOutlined);
export const ArrowUpOutlined = createPackIcon("ArrowUpOutlined", AntArrowUpOutlined);
export const BlockOutlined = createPackIcon("BlockOutlined", AntBlockOutlined);
export const BuildOutlined = createPackIcon("BuildOutlined", AntBuildOutlined);
export const CaretRightOutlined = createPackIcon("CaretRightOutlined", AntCaretRightOutlined);
export const CheckCircleOutlined = createPackIcon("CheckCircleOutlined", AntCheckCircleOutlined);
export const CheckOutlined = createPackIcon("CheckOutlined", AntCheckOutlined);
export const ClearOutlined = createPackIcon("ClearOutlined", AntClearOutlined);
export const CloudDownloadOutlined = createPackIcon("CloudDownloadOutlined", AntCloudDownloadOutlined);
export const CodeOutlined = createPackIcon("CodeOutlined", AntCodeOutlined);
export const CodeSandboxOutlined = createPackIcon("CodeSandboxOutlined", AntCodeSandboxOutlined);
export const ColumnHeightOutlined = createPackIcon("ColumnHeightOutlined", AntColumnHeightOutlined);
export const CopyOutlined = createPackIcon("CopyOutlined", AntCopyOutlined);
export const DeleteOutlined = createPackIcon("DeleteOutlined", AntDeleteOutlined);
export const DisconnectOutlined = createPackIcon("DisconnectOutlined", AntDisconnectOutlined);
export const DownOutlined = createPackIcon("DownOutlined", AntDownOutlined);
export const DownloadOutlined = createPackIcon("DownloadOutlined", AntDownloadOutlined);
export const EnterOutlined = createPackIcon("EnterOutlined", AntEnterOutlined);
export const ExpandAltOutlined = createPackIcon("ExpandAltOutlined", AntExpandAltOutlined);
export const ExportOutlined = createPackIcon("ExportOutlined", AntExportOutlined);
export const EyeInvisibleOutlined = createPackIcon("EyeInvisibleOutlined", AntEyeInvisibleOutlined);
export const EyeOutlined = createPackIcon("EyeOutlined", AntEyeOutlined);
export const FileOutlined = createPackIcon("FileOutlined", AntFileOutlined);
export const FileTextOutlined = createPackIcon("FileTextOutlined", AntFileTextOutlined);
export const FolderOpenOutlined = createPackIcon("FolderOpenOutlined", AntFolderOpenOutlined);
export const FolderOutlined = createPackIcon("FolderOutlined", AntFolderOutlined);
export const HddOutlined = createPackIcon("HddOutlined", AntHddOutlined);
export const HistoryOutlined = createPackIcon("HistoryOutlined", AntHistoryOutlined);
export const InfoCircleOutlined = createPackIcon("InfoCircleOutlined", AntInfoCircleOutlined);
export const LineChartOutlined = createPackIcon("LineChartOutlined", AntLineChartOutlined);
export const LinkOutlined = createPackIcon("LinkOutlined", AntLinkOutlined);
export const LockOutlined = createPackIcon("LockOutlined", AntLockOutlined);
export const MenuFoldOutlined = createPackIcon("MenuFoldOutlined", AntMenuFoldOutlined);
export const MenuUnfoldOutlined = createPackIcon("MenuUnfoldOutlined", AntMenuUnfoldOutlined);
export const MinusCircleOutlined = createPackIcon("MinusCircleOutlined", AntMinusCircleOutlined);
export const MinusOutlined = createPackIcon("MinusOutlined", AntMinusOutlined);
export const MoreOutlined = createPackIcon("MoreOutlined", AntMoreOutlined);
export const PauseCircleOutlined = createPackIcon("PauseCircleOutlined", AntPauseCircleOutlined);
export const PlayCircleOutlined = createPackIcon("PlayCircleOutlined", AntPlayCircleOutlined);
export const PlusOutlined = createPackIcon("PlusOutlined", AntPlusOutlined);
export const PoweroffOutlined = createPackIcon("PoweroffOutlined", AntPoweroffOutlined);
export const ReloadOutlined = createPackIcon("ReloadOutlined", AntReloadOutlined);
export const RightOutlined = createPackIcon("RightOutlined", AntRightOutlined);
export const SearchOutlined = createPackIcon("SearchOutlined", AntSearchOutlined);
export const SettingOutlined = createPackIcon("SettingOutlined", AntSettingOutlined);
export const ShrinkOutlined = createPackIcon("ShrinkOutlined", AntShrinkOutlined);
export const StopOutlined = createPackIcon("StopOutlined", AntStopOutlined);
export const SyncOutlined = createPackIcon("SyncOutlined", AntSyncOutlined);
export const TableOutlined = createPackIcon("TableOutlined", AntTableOutlined);
export const TagOutlined = createPackIcon("TagOutlined", AntTagOutlined);
export const VerticalAlignBottomOutlined = createPackIcon(
  "VerticalAlignBottomOutlined",
  AntVerticalAlignBottomOutlined,
);
export const VerticalAlignMiddleOutlined = createPackIcon(
  "VerticalAlignMiddleOutlined",
  AntVerticalAlignMiddleOutlined,
);
export const WarningOutlined = createPackIcon("WarningOutlined", AntWarningOutlined);

function resolveFolderSpec(
  pack: "vscode-icons" | "catppuccin",
  name: string,
  open: boolean,
  isRoot?: boolean,
): string | null {
  if (isRoot) {
    return pack === "vscode-icons"
      ? open
        ? "vscode-icons:default-root-folder-opened"
        : "vscode-icons:default-root-folder"
      : open
        ? "catppuccin:root-open"
        : "catppuccin:root";
  }
  const lower = name.toLowerCase();
  if (lower === "etc" || lower === "conf" || lower === "config" || lower === ".config") {
    return pack === "vscode-icons"
      ? open
        ? "vscode-icons:folder-type-config-opened"
        : "vscode-icons:folder-type-config"
      : open
        ? "catppuccin:folder-config-open"
        : "catppuccin:folder-config";
  }
  if (lower === "var" || lower === "log" || lower === "logs") {
    return pack === "vscode-icons"
      ? open
        ? "vscode-icons:folder-type-log-opened"
        : "vscode-icons:folder-type-log"
      : open
        ? "catppuccin:folder-audit-open"
        : "catppuccin:folder-audit";
  }
  if (
    lower === "db" ||
    lower === "data" ||
    lower === "database" ||
    lower === "postgres" ||
    lower === "mysql" ||
    lower === "redis"
  ) {
    return pack === "vscode-icons"
      ? open
        ? "vscode-icons:folder-type-db-opened"
        : "vscode-icons:folder-type-db"
      : open
        ? "catppuccin:folder-database-open"
        : "catppuccin:folder-database";
  }
  if (lower === "docker" || lower === ".docker") {
    return pack === "vscode-icons"
      ? open
        ? "vscode-icons:folder-type-docker-opened"
        : "vscode-icons:folder-type-docker"
      : open
        ? "catppuccin:folder-docker-open"
        : "catppuccin:folder-docker";
  }
  return null;
}

function resolveFileSpec(pack: "vscode-icons" | "catppuccin", name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("dockerfile") || lower.endsWith(".dockerfile") || lower === ".dockerignore") {
    return pack === "vscode-icons" ? "vscode-icons:file-type-docker" : "catppuccin:docker";
  }
  if (lower === "compose.yaml" || lower === "compose.yml" || lower.startsWith("docker-compose.")) {
    return pack === "vscode-icons" ? "vscode-icons:file-type-docker2" : "catppuccin:docker-compose";
  }
  if (lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env")) {
    return pack === "vscode-icons" ? "vscode-icons:file-type-dotenv" : "catppuccin:env";
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
    return pack === "vscode-icons" ? "vscode-icons:file-type-config" : "catppuccin:config";
  }
  if (lower === ".bashrc" || lower === ".bash_profile" || lower === ".profile" || lower === ".zshrc") {
    return pack === "vscode-icons" ? "vscode-icons:file-type-shell" : "catppuccin:bash";
  }
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  switch (ext) {
    case "json":
    case "jsonc":
    case "json5":
      return pack === "vscode-icons" ? "vscode-icons:file-type-json" : "catppuccin:json";
    case "yaml":
    case "yml":
      return pack === "vscode-icons" ? "vscode-icons:file-type-yaml" : "catppuccin:yaml";
    case "toml":
      return pack === "vscode-icons" ? "vscode-icons:file-type-toml" : "catppuccin:toml";
    case "conf":
    case "cfg":
    case "ini":
    case "cnf":
    case "properties":
    case "service":
      return pack === "vscode-icons" ? "vscode-icons:file-type-config" : "catppuccin:config";
    case "sh":
    case "bash":
    case "zsh":
      return pack === "vscode-icons" ? "vscode-icons:file-type-shell" : "catppuccin:bash";
    case "js":
    case "mjs":
    case "cjs":
      return pack === "vscode-icons" ? "vscode-icons:file-type-js" : "catppuccin:javascript";
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
    case "jsx":
      return pack === "vscode-icons" ? "vscode-icons:file-type-typescript" : "catppuccin:typescript";
    case "py":
    case "pyc":
      return pack === "vscode-icons" ? "vscode-icons:file-type-python" : "catppuccin:python";
    case "go":
      return pack === "vscode-icons" ? "vscode-icons:file-type-go" : "catppuccin:go";
    case "md":
    case "markdown":
      return pack === "vscode-icons" ? "vscode-icons:file-type-markdown" : "catppuccin:markdown";
    case "log":
      return pack === "vscode-icons" ? "vscode-icons:file-type-log" : "catppuccin:log";
    case "sql":
    case "db":
    case "sqlite":
    case "sqlite3":
      return pack === "vscode-icons" ? "vscode-icons:file-type-sql" : "catppuccin:database";
    case "lock":
      return pack === "vscode-icons" ? "codicon:lock" : "catppuccin:lock";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "svg":
      return pack === "vscode-icons" ? "vscode-icons:file-type-image" : "catppuccin:image";
    case "so":
    case "bin":
    case "exe":
    case "o":
    case "a":
    case "wasm":
      return pack === "vscode-icons" ? "vscode-icons:file-type-binary" : "catppuccin:binary";
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
  if (ready && (iconPackId === "vscode-icons" || iconPackId === "catppuccin")) {
    const spec = resolveFolderSpec(iconPackId, name, open, isRoot);
    if (spec) return <IconifySpan spec={spec} style={style} />;
  }
  if (isRoot) return <HddOutlined style={style} />;
  return open ? <FolderOpenOutlined style={style} /> : <FolderOutlined style={style} />;
}

export function FileEntryIcon({ entry }: { entry: FsEntry }) {
  const { iconPackId } = useTheme();
  const ready = useIconPackReady(iconPackId);
  const richPack =
    ready && (iconPackId === "vscode-icons" || iconPackId === "catppuccin") ? iconPackId : null;

  if (entry.kind === "dir") {
    return (
      <FolderEntryIcon
        name={entry.name}
        style={richPack === "vscode-icons" ? undefined : { color: "var(--fog)" }}
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
  return <FileTextOutlined style={richPack === "vscode-icons" ? undefined : { color: "var(--fog)" }} />;
}
