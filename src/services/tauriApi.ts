import { Channel } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  type ComposeActionRequest,
  type ComposeProject,
  ComposeProjectSchema,
  type ComposeRun,
  ComposeRunSchema,
  type ConnectionConfig,
  ConnectionConfigSchema,
  type ContainerInspect,
  ContainerInspectSchema,
  type ContainerStats,
  ContainerStatsSchema,
  type ContainerSummary,
  ContainerSummarySchema,
  type DirListing,
  DirListingSchema,
  type DockerContext,
  DockerContextSchema,
  type DockerStatus,
  DockerStatusSchema,
  type ExecEvent,
  ExecEventSchema,
  type ExecProbe,
  ExecProbeSchema,
  type ExecStartOptions,
  type FileContent,
  FileContentSchema,
  type FsChange,
  FsChangeSchema,
  type ImageInspect,
  ImageInspectSchema,
  type ImageItem,
  ImageItemSchema,
  type ImagePullProgress,
  ImagePullProgressSchema,
  type LayerHistoryItem,
  LayerHistoryItemSchema,
  LogEventSchema,
  type LogLine,
  type LogStreamOptions,
  type MetricsSeries,
  MetricsSeriesSchema,
  type SystemInfo,
  SystemInfoSchema,
  type VolumeDetail,
  VolumeDetailSchema,
  type VolumeItem,
  VolumeItemSchema,
} from "../types/docker";
import { IPC_METRICS_ENABLED, recordChannelMessage, recordParse, timedInvoke } from "./ipcMetrics";

/**
 * Normalize a Tauri command rejection into a readable Error. Structured
 * `AppError` payloads arrive as `{ kind, message }`.
 */
export function toError(err: unknown): Error {
  if (typeof err === "string") return new Error(err);
  if (err && typeof err === "object" && "message" in err) {
    return new Error(String((err as { message: unknown }).message));
  }
  return new Error("Unexpected error");
}

async function call<T>(cmd: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  try {
    const raw = await timedInvoke(cmd, args);
    if (!IPC_METRICS_ENABLED) return schema.parse(raw);
    const start = performance.now();
    const parsed = schema.parse(raw);
    recordParse(cmd, performance.now() - start);
    return parsed;
  } catch (err) {
    throw toError(err);
  }
}

async function callVoid(cmd: string, args: Record<string, unknown> = {}): Promise<void> {
  try {
    await timedInvoke(cmd, args);
  } catch (err) {
    throw toError(err);
  }
}

/* ----------------------------- containers ----------------------------- */

export function listContainers(all = true): Promise<ContainerSummary[]> {
  return call("list_containers", { all }, z.array(ContainerSummarySchema));
}

/** Newest backend-collected sample per live container (all, or just `ids`). */
export function metricsLatest(ids?: string[]): Promise<ContainerStats[]> {
  return call("metrics_latest", { ids: ids ?? null }, z.array(ContainerStatsSchema));
}

/** Collected history (up to 30 min), downsampled to at most `maxPoints` per container. */
export function metricsSeries(
  ids: string[],
  options: { since?: number; maxPoints?: number } = {},
): Promise<MetricsSeries> {
  return call(
    "metrics_series",
    { ids, since: options.since ?? null, maxPoints: options.maxPoints ?? null },
    MetricsSeriesSchema,
  );
}

export function inspectContainer(id: string): Promise<ContainerInspect> {
  return call("inspect_container", { id }, ContainerInspectSchema);
}

export type ContainerActionKind = "start" | "stop" | "restart" | "kill" | "pause" | "unpause" | "remove";

export function containerAction(id: string, action: ContainerActionKind): Promise<void> {
  return callVoid("container_action", { id, action });
}

/**
 * Open a backend stream keyed by a fresh stream id. Messages are validated
 * with `schema`; the returned disposer cancels the backend task, so two
 * views on the same container never cancel each other.
 */
function openStream<T>(
  cmd: string,
  args: Record<string, unknown>,
  channelArg: string,
  schema: z.ZodType<T>,
  onMessage: (message: T) => void,
  onError?: (err: Error) => void,
  streamId: string = crypto.randomUUID(),
): () => void {
  const channel = new Channel<unknown>();
  let active = true;
  channel.onmessage = (raw) => {
    recordChannelMessage(cmd, raw);
    if (!active) return;
    const parsed = schema.safeParse(raw);
    if (parsed.success) onMessage(parsed.data);
  };
  timedInvoke(cmd, { ...args, streamId, [channelArg]: channel }, { stream: true }).catch((err) => {
    if (active) onError?.(toError(err));
  });
  return () => {
    active = false;
    void timedInvoke("stop_stream", { streamId }).catch(() => undefined);
  };
}

export type LogStreamHandlers = {
  onLines: (lines: LogLine[]) => void;
  /** Stream finished: container stopped, log ended, or it failed. */
  onEnd?: (error: string | null) => void;
};

/** Stream log line batches. Returns a disposer — call it on unmount. */
export function streamContainerLogs(
  id: string,
  options: LogStreamOptions,
  { onLines, onEnd }: LogStreamHandlers,
): () => void {
  return openStream(
    "stream_container_logs",
    { id, options: { tail: options.tail, since: options.since ?? null, follow: options.follow ?? true } },
    "onEvent",
    LogEventSchema,
    (event) => (event.kind === "lines" ? onLines(event.lines) : onEnd?.(event.error)),
    (err) => onEnd?.(err.message),
  );
}

/** Write the full container log to `dest`; resolves to the path. */
export function saveContainerLogs(id: string, dest: string): Promise<string> {
  return call("save_container_logs", { id, dest }, z.string());
}

/* -------------------------------- compose ----------------------------- */

/** Merged config, raw files and metadata for one compose project. */
export function getComposeProject(workdir: string, files: string[]): Promise<ComposeProject> {
  return call("compose_project", { workdir, files }, ComposeProjectSchema);
}

/** Run an allow-listed `docker compose` lifecycle action. */
export function composeAction(request: ComposeActionRequest): Promise<ComposeRun> {
  return call("compose_action", { request }, ComposeRunSchema);
}

/* -------------------------------- files ------------------------------- */

export function listContainerDir(id: string, path: string, limit?: number): Promise<DirListing> {
  return call("list_container_dir", { id, path, limit: limit ?? null }, DirListingSchema);
}

export function readContainerFile(id: string, path: string, maxBytes?: number): Promise<FileContent> {
  return call("read_container_file", { id, path, maxBytes: maxBytes ?? null }, FileContentSchema);
}

export function containerChanges(id: string): Promise<FsChange[]> {
  return call("container_changes", { id }, z.array(FsChangeSchema));
}

/** Save a file — or a directory as .tar — to `dest`; resolves to the path. */
export function saveContainerPath(
  id: string,
  path: string,
  asArchive: boolean,
  dest: string,
): Promise<string> {
  return call("save_container_path", { id, path, asArchive, dest }, z.string());
}

/** Write text to a path the user picked; resolves to the path. */
export function saveTextToFile(dest: string, contents: string): Promise<string> {
  return call("save_text_to_file", { dest, contents }, z.string());
}

/* -------------------------------- images ------------------------------ */

export function listImages(): Promise<ImageItem[]> {
  return call("list_images", {}, z.array(ImageItemSchema));
}

export function pullImage(
  imageName: string,
  onProgress: (progress: ImagePullProgress) => void,
  onEnd?: () => void,
): () => void {
  const channel = new Channel<unknown>();
  let active = true;
  channel.onmessage = (raw) => {
    recordChannelMessage("pull_image", raw);
    if (!active) return;
    const parsed = ImagePullProgressSchema.safeParse(raw);
    if (parsed.success) onProgress(parsed.data);
  };
  timedInvoke("pull_image", { imageName, onProgress: channel }, { stream: true })
    .catch(() => undefined)
    .finally(() => onEnd?.());
  return () => {
    active = false;
    void timedInvoke("cancel_pull", { imageName }).catch(() => undefined);
  };
}

export function imageHistory(ref: string): Promise<LayerHistoryItem[]> {
  return call("image_history", { image: ref }, z.array(LayerHistoryItemSchema));
}

export function inspectImage(ref: string): Promise<ImageInspect> {
  return call("inspect_image", { image: ref }, ImageInspectSchema);
}

export function tagImage(id: string, repo: string, tag: string): Promise<void> {
  return callVoid("tag_image", { id, repo, tag });
}

export function removeImage(id: string, force = false): Promise<void> {
  return callVoid("remove_image", { id, force });
}

export async function pruneImages(danglingOnly = true): Promise<number> {
  return call("prune_images", { danglingOnly }, z.number());
}

/* -------------------------------- volumes ----------------------------- */

export function listVolumes(): Promise<VolumeItem[]> {
  return call("list_volumes", {}, z.array(VolumeItemSchema));
}

/** Slow disk-usage pass; updates the cached sizes that `listVolumes` returns. */
export function refreshVolumeSizes(): Promise<void> {
  return callVoid("refresh_volume_sizes", {});
}

export function getVolumeDetail(name: string): Promise<VolumeDetail> {
  return call("volume_detail", { name }, VolumeDetailSchema);
}

export function removeVolume(name: string, force = false): Promise<void> {
  return callVoid("remove_volume", { name, force });
}

export async function pruneVolumes(): Promise<number> {
  return call("prune_volumes", {}, z.number());
}

/* -------------------------------- system ------------------------------ */

export function getSystemInfo(): Promise<SystemInfo> {
  return call("system_info", {}, SystemInfoSchema);
}

export function getDockerStatus(): Promise<DockerStatus> {
  return call("docker_status", {}, DockerStatusSchema);
}

export function listDockerContexts(): Promise<DockerContext[]> {
  return call("list_contexts", {}, z.array(DockerContextSchema));
}

export function testConnection(config: ConnectionConfig): Promise<DockerStatus> {
  const parsed = ConnectionConfigSchema.parse(config);
  return call("test_connection", { config: parsed }, DockerStatusSchema);
}

export function switchDockerEndpoint(config: ConnectionConfig): Promise<DockerStatus> {
  const parsed = ConnectionConfigSchema.parse(config);
  return call("switch_docker_endpoint", { config: parsed }, DockerStatusSchema);
}

/* --------------------------------- exec -------------------------------- */

export function execProbe(id: string): Promise<ExecProbe> {
  return call("exec_probe", { id }, ExecProbeSchema);
}

export type ExecSession = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

/** Start an interactive exec session; `onEvent` gets output, then one exit. */
export function startExec(
  id: string,
  options: ExecStartOptions,
  onEvent: (event: ExecEvent) => void,
): ExecSession {
  const streamId = crypto.randomUUID();
  const close = openStream(
    "exec_start",
    { id, options: { env: [], tty: false, cols: 0, rows: 0, ...options } },
    "onEvent",
    ExecEventSchema,
    onEvent,
    (err) => onEvent({ kind: "exit", code: null, error: err.message }),
    streamId,
  );
  // Commands run concurrently on the backend, so keystrokes sent as
  // separate invokes can overtake each other. Chain them to keep order.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    write: (data) => {
      queue = queue.then(() => timedInvoke("exec_input", { streamId, data })).catch(() => undefined);
    },
    resize: (cols, rows) => void timedInvoke("exec_resize", { streamId, cols, rows }).catch(() => undefined),
    close,
  };
}
