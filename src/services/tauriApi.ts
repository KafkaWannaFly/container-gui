import { Channel, invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  ConnectionConfigSchema,
  ContainerInspectSchema,
  ContainerStatsSchema,
  ContainerSummarySchema,
  DockerContextSchema,
  DockerStatusSchema,
  ImageItemSchema,
  LayerHistoryItemSchema,
  LogChunkSchema,
  SystemInfoSchema,
  VolumeItemSchema,
  ImagePullProgressSchema,
  type ConnectionConfig,
  type ContainerInspect,
  type ContainerStats,
  type ContainerSummary,
  type DockerContext,
  type DockerStatus,
  type ImageItem,
  type ImagePullProgress,
  type LayerHistoryItem,
  type LogChunk,
  type SystemInfo,
  type VolumeItem,
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

export function containerAction(id: string, action: "start" | "stop" | "restart" | "kill" | "remove"): Promise<void> {
  return callVoid("container_action", { id, action });
}

/**
 * Stream logs into `onChunk`. Returns a disposer that cancels the
 * backend stream — call it on unmount.
 */
export function streamContainerLogs(
  id: string,
  tail: number,
  onChunk: (chunk: LogChunk) => void,
  onEnd?: () => void,
): () => void {
  const channel = new Channel<unknown>();
  let active = true;
  channel.onmessage = (raw) => {
    if (!active) return;
    const parsed = LogChunkSchema.safeParse(raw);
    if (parsed.success) onChunk(parsed.data);
  };
  invoke("stream_container_logs", { id, tail, onChunk: channel })
    .catch(() => undefined)
    .finally(() => {
      if (active) onEnd?.();
    });
  return () => {
    active = false;
    void invoke("stop_container_logs", { id }).catch(() => undefined);
  };
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
