import { Channel, invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  type ConnectionConfig,
  ConnectionConfigSchema,
  type ContainerInspect,
  ContainerInspectSchema,
  type ContainerLiveStats,
  ContainerLiveStatsSchema,
  type ContainerStats,
  ContainerStatsSchema,
  type ContainerSummary,
  ContainerSummarySchema,
  type DockerContext,
  DockerContextSchema,
  type DockerStatus,
  DockerStatusSchema,
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
  type SystemInfo,
  SystemInfoSchema,
  type VolumeItem,
  VolumeItemSchema,
} from "../types/docker";

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
    const raw = await invoke(cmd, args);
    return schema.parse(raw);
  } catch (err) {
    throw toError(err);
  }
}

async function callVoid(cmd: string, args: Record<string, unknown> = {}): Promise<void> {
  try {
    await invoke(cmd, args);
  } catch (err) {
    throw toError(err);
  }
}

/* ----------------------------- containers ----------------------------- */

export function listContainers(all = true): Promise<ContainerSummary[]> {
  return call("list_containers", { all }, z.array(ContainerSummarySchema));
}

export function listContainerStats(all = true): Promise<ContainerStats[]> {
  return call("container_stats", { all }, z.array(ContainerStatsSchema));
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
): () => void {
  const streamId = crypto.randomUUID();
  const channel = new Channel<unknown>();
  let active = true;
  channel.onmessage = (raw) => {
    if (!active) return;
    const parsed = schema.safeParse(raw);
    if (parsed.success) onMessage(parsed.data);
  };
  invoke(cmd, { ...args, streamId, [channelArg]: channel }).catch((err) => {
    if (active) onError?.(toError(err));
  });
  return () => {
    active = false;
    void invoke("stop_stream", { streamId }).catch(() => undefined);
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

/** Live stats samples (about one per second) for one container. */
export function streamContainerStats(id: string, onSample: (stats: ContainerLiveStats) => void): () => void {
  return openStream("stream_container_stats", { id }, "onStats", ContainerLiveStatsSchema, onSample);
}

/** Write the full container log into Downloads; resolves to the path. */
export function saveContainerLogs(id: string, filename: string): Promise<string> {
  return call("save_container_logs", { id, filename }, z.string());
}

/* -------------------------------- files ------------------------------- */

/** Write text into the user's Downloads folder; resolves to the path. */
export function saveTextToDownloads(filename: string, contents: string): Promise<string> {
  return call("save_text_to_downloads", { filename, contents }, z.string());
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
    if (!active) return;
    const parsed = ImagePullProgressSchema.safeParse(raw);
    if (parsed.success) onProgress(parsed.data);
  };
  invoke("pull_image", { imageName, onProgress: channel })
    .catch(() => undefined)
    .finally(() => onEnd?.());
  return () => {
    active = false;
    void invoke("cancel_pull", { imageName }).catch(() => undefined);
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
