import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Runtime schemas — validate every payload crossing the Tauri IPC
 * boundary. Types are inferred so Rust and TS stay in lockstep.
 * ------------------------------------------------------------------ */

export const PortMappingSchema = z.object({
  privatePort: z.number(),
  publicPort: z.number().nullable(),
  ip: z.string().nullable(),
  type: z.string(),
});
export type PortMapping = z.infer<typeof PortMappingSchema>;

export const ContainerSummarySchema = z.object({
  id: z.string(),
  names: z.array(z.string()),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  created: z.number(),
  ports: z.array(PortMappingSchema),
  composeProject: z.string().nullable(),
  composeService: z.string().nullable(),
});
export type ContainerSummary = z.infer<typeof ContainerSummarySchema>;

export const ContainerStatsSchema = z.object({
  id: z.string(),
  cpuPercent: z.number(),
  memoryUsage: z.number(),
  memoryLimit: z.number(),
});
export type ContainerStats = z.infer<typeof ContainerStatsSchema>;

export const VolumeItemSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  inUse: z.boolean(),
  refCount: z.number(),
});
export type VolumeItem = z.infer<typeof VolumeItemSchema>;

export const ImageItemSchema = z.object({
  id: z.string(),
  repoTags: z.array(z.string()),
  size: z.number(),
  created: z.number(),
});
export type ImageItem = z.infer<typeof ImageItemSchema>;

export const ImagePullProgressSchema = z.object({
  id: z.string(),
  status: z.string(),
  currentBytes: z.number(),
  totalBytes: z.number(),
  percent: z.number(),
});
export type ImagePullProgress = z.infer<typeof ImagePullProgressSchema>;

export const LogChunkSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  message: z.string(),
});
export type LogChunk = z.infer<typeof LogChunkSchema>;

export const LayerHistoryItemSchema = z.object({
  id: z.string(),
  created: z.number(),
  createdBy: z.string(),
  size: z.number(),
  tags: z.array(z.string()),
  comment: z.string(),
});
export type LayerHistoryItem = z.infer<typeof LayerHistoryItemSchema>;

export const DockerEventSchema = z.object({
  resourceType: z.string(),
  action: z.string(),
  actorId: z.string(),
  time: z.number(),
});
export type DockerEvent = z.infer<typeof DockerEventSchema>;

export const DockerContextSchema = z.object({
  name: z.string(),
  host: z.string(),
  description: z.string().nullable(),
});
export type DockerContext = z.infer<typeof DockerContextSchema>;

export const ConnectionConfigSchema = z.object({
  kind: z.enum(["unix", "npipe", "tcp"]),
  value: z.string(),
});
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

export const DockerStatusSchema = z.object({
  endpoint: z.string(),
  kind: z.string(),
  state: z.enum(["connected", "standby", "connecting", "error"]),
  engineVersion: z.string().nullable(),
  apiVersion: z.string().nullable(),
  os: z.string().nullable(),
  arch: z.string().nullable(),
  pingMs: z.number().nullable(),
  message: z.string().nullable(),
});
export type DockerStatus = z.infer<typeof DockerStatusSchema>;

export const SystemInfoSchema = z.object({
  dockerVersion: z.string(),
  apiVersion: z.string(),
  os: z.string(),
  arch: z.string(),
  kernelVersion: z.string(),
  containersRunning: z.number(),
  containersPaused: z.number(),
  containersStopped: z.number(),
  containersTotal: z.number(),
  imagesTotal: z.number(),
  cpus: z.number(),
  memoryTotal: z.number(),
  pingMs: z.number(),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

/**
 * Raw Docker inspect payload. We only assert the paths the UI reads and
 * let the rest through untouched — the Docker inspect schema is huge and
 * changes across engine versions.
 */
export const ContainerInspectSchema = z.looseObject({
  Id: z.string(),
  Name: z.string().optional(),
  Created: z.string().optional(),
  State: z.looseObject({
    Status: z.string().optional(),
    Running: z.boolean().optional(),
    Paused: z.boolean().optional(),
    StartedAt: z.string().optional(),
    FinishedAt: z.string().optional(),
    ExitCode: z.number().optional(),
  }).optional(),
  Config: z.looseObject({
    Image: z.string().optional(),
    Hostname: z.string().optional(),
    Env: z.array(z.string()).nullish(),
    Cmd: z.array(z.string()).nullish(),
    Entrypoint: z.array(z.string()).nullish(),
    Labels: z.record(z.string(), z.string()).nullish(),
  }).optional(),
  HostConfig: z.looseObject({
    NetworkMode: z.string().optional(),
    RestartPolicy: z.looseObject({ Name: z.string().optional() }).optional(),
  }).optional(),
  NetworkSettings: z.looseObject({
    Networks: z.record(z.string(), z.any()).optional(),
    Ports: z.record(z.string(), z.any()).nullish(),
  }).optional(),
  Mounts: z
    .array(
      z.looseObject({
        Type: z.string().optional(),
        Name: z.string().optional(),
        Source: z.string().optional(),
        Destination: z.string().optional(),
        Mode: z.string().optional(),
        RW: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type ContainerInspect = z.infer<typeof ContainerInspectSchema>;

/* ------------------------------------------------------------------ *
 * Display helpers
 * ------------------------------------------------------------------ */

export type ContainerState = "running" | "exited" | "paused" | "created" | string;

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!bytes || bytes < 0) return "—";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : fractionDigits)} ${units[i]}`;
}

export function portLabel(port: PortMapping): string {
  const proto = port.type || "tcp";
  if (port.publicPort) {
    return `${port.ip ?? "0.0.0.0"}:${port.publicPort} → ${port.privatePort}/${proto}`;
  }
  return `${port.privatePort}/${proto}`;
}

export function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12);
}
