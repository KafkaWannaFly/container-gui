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
  composeWorkingDir: z.string().nullable(),
  composeConfigFiles: z.string().nullable(),
});
export type ContainerSummary = z.infer<typeof ContainerSummarySchema>;

/** One collector sample. `cpuPercent` and the rates are null on a container's
 * first sample and right after a restart (no previous reading to diff). */
export const MetricSampleSchema = z.object({
  ts: z.number(),
  cpuPercent: z.number().nullable(),
  onlineCpus: z.number(),
  memoryUsage: z.number(),
  memoryLimit: z.number(),
  netRx: z.number(),
  netTx: z.number(),
  blockRead: z.number(),
  blockWrite: z.number(),
  pids: z.number(),
  netRxRate: z.number().nullable(),
  netTxRate: z.number().nullable(),
  blockReadRate: z.number().nullable(),
  blockWriteRate: z.number().nullable(),
});
export type MetricSample = z.infer<typeof MetricSampleSchema>;

export const ContainerStatsSchema = MetricSampleSchema.extend({ id: z.string() });
export type ContainerStats = z.infer<typeof ContainerStatsSchema>;

export const MetricsSeriesSchema = z.object({
  stepMs: z.number(),
  series: z.array(z.object({ id: z.string(), samples: z.array(MetricSampleSchema) })),
});
export type MetricsSeries = z.infer<typeof MetricsSeriesSchema>;

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

export const LogLineSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  ts: z.string(),
  text: z.string(),
});
export type LogLine = z.infer<typeof LogLineSchema>;

export const LogEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lines"), lines: z.array(LogLineSchema) }),
  z.object({ kind: z.literal("end"), error: z.string().nullable() }),
]);
export type LogEvent = z.infer<typeof LogEventSchema>;

export type LogStreamOptions = {
  /** Last N lines; null streams the whole log. */
  tail: number | null;
  /** Unix seconds. */
  since?: number | null;
  follow?: boolean;
};

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

/* ------------------------------------------------------------------ *
 * Compose project (group detail)
 * ------------------------------------------------------------------ */

export const ComposeFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  content: z.string(),
});
export type ComposeFile = z.infer<typeof ComposeFileSchema>;

/** Truncated to the paths the group page reads; Compose adds more. */
const ComposeServiceConfigSchema = z.looseObject({
  image: z.string().nullish(),
  container_name: z.string().nullish(),
  profiles: z.array(z.string()).nullish(),
  depends_on: z
    .record(z.string(), z.union([z.string(), z.looseObject({ condition: z.string().nullish() })]))
    .nullish(),
  environment: z.record(z.string(), z.unknown()).nullish(),
  ports: z
    .array(
      z.looseObject({
        target: z.number(),
        published: z.string().nullish(),
        protocol: z.string().nullish(),
      }),
    )
    .nullish(),
  volumes: z
    .array(
      z.looseObject({
        type: z.string(),
        source: z.string().nullish(),
        target: z.string().nullish(),
        read_only: z.boolean().nullish(),
      }),
    )
    .nullish(),
  networks: z.record(z.string(), z.unknown()).nullish(),
  deploy: z.looseObject({ replicas: z.number().nullish() }).nullish(),
  healthcheck: z.looseObject({ test: z.array(z.string()).nullish() }).nullish(),
  restart: z.string().nullish(),
});
export type ComposeServiceConfig = z.infer<typeof ComposeServiceConfigSchema>;

export const ComposeConfigSchema = z.looseObject({
  name: z.string().nullish(),
  services: z.record(z.string(), ComposeServiceConfigSchema).default({}),
  networks: z
    .record(z.string(), z.looseObject({ name: z.string().nullish(), external: z.boolean().nullish() }))
    .nullish(),
  volumes: z.record(z.string(), z.looseObject({ name: z.string().nullish() })).nullish(),
});
export type ComposeConfig = z.infer<typeof ComposeConfigSchema>;

export const ComposeProjectSchema = z.object({
  project: z.string(),
  workdir: z.string(),
  files: z.array(ComposeFileSchema),
  configHash: z.string(),
  composeVersion: z.string(),
  config: ComposeConfigSchema,
  resolved: z.string(),
});
export type ComposeProject = z.infer<typeof ComposeProjectSchema>;

export const ComposeRunSchema = z.object({
  code: z.number(),
  stdout: z.string(),
  stderr: z.string(),
});
export type ComposeRun = z.infer<typeof ComposeRunSchema>;

export type ComposeActionRequest = {
  workdir: string;
  files: string[];
  action: string;
  service?: string | null;
  replicas?: number | null;
  profiles?: string[];
  services?: string[];
};

/**
 * Raw Docker inspect payload. We only assert the paths the UI reads and
 * let the rest through untouched — the Docker inspect schema is huge and
 * changes across engine versions.
 */
const HealthcheckSchema = z.looseObject({
  Test: z.array(z.string()).nullish(),
  /** Nanoseconds. */
  Interval: z.number().nullish(),
  Timeout: z.number().nullish(),
  Retries: z.number().nullish(),
});

const PortBindingSchema = z.looseObject({
  HostIp: z.string().nullish(),
  HostPort: z.string().nullish(),
});

const EndpointSchema = z.looseObject({
  IPAddress: z.string().nullish(),
  IPPrefixLen: z.number().nullish(),
  Gateway: z.string().nullish(),
  MacAddress: z.string().nullish(),
  Aliases: z.array(z.string()).nullish(),
  DNSNames: z.array(z.string()).nullish(),
});
export type NetworkEndpoint = z.infer<typeof EndpointSchema>;

export const ContainerInspectSchema = z.looseObject({
  Id: z.string(),
  Name: z.string().optional(),
  Created: z.string().optional(),
  Image: z.string().optional(),
  Platform: z.string().nullish(),
  RestartCount: z.number().nullish(),
  State: z
    .looseObject({
      Status: z.string().optional(),
      Running: z.boolean().optional(),
      Paused: z.boolean().optional(),
      StartedAt: z.string().optional(),
      FinishedAt: z.string().optional(),
      ExitCode: z.number().optional(),
      Health: z
        .looseObject({
          Status: z.string().nullish(),
          FailingStreak: z.number().nullish(),
          Log: z
            .array(
              z.looseObject({
                Start: z.string().nullish(),
                End: z.string().nullish(),
                ExitCode: z.number().nullish(),
                Output: z.string().nullish(),
              }),
            )
            .nullish(),
        })
        .nullish(),
    })
    .optional(),
  Config: z
    .looseObject({
      Image: z.string().optional(),
      Hostname: z.string().optional(),
      User: z.string().nullish(),
      WorkingDir: z.string().nullish(),
      Tty: z.boolean().nullish(),
      Env: z.array(z.string()).nullish(),
      Cmd: z.array(z.string()).nullish(),
      Entrypoint: z.array(z.string()).nullish(),
      Labels: z.record(z.string(), z.string()).nullish(),
      Healthcheck: HealthcheckSchema.nullish(),
    })
    .optional(),
  HostConfig: z
    .looseObject({
      NetworkMode: z.string().optional(),
      RestartPolicy: z.looseObject({ Name: z.string().optional() }).optional(),
      NanoCpus: z.number().nullish(),
      CpuQuota: z.number().nullish(),
      CpuPeriod: z.number().nullish(),
      Memory: z.number().nullish(),
      PidsLimit: z.number().nullish(),
      ReadonlyRootfs: z.boolean().nullish(),
      LogConfig: z.looseObject({ Type: z.string().nullish() }).nullish(),
    })
    .optional(),
  NetworkSettings: z
    .looseObject({
      Networks: z.record(z.string(), EndpointSchema).nullish(),
      Ports: z.record(z.string(), z.array(PortBindingSchema).nullable()).nullish(),
    })
    .optional(),
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

/** Raw image inspect payload; same loose approach as containers. */
export const ImageInspectSchema = z.looseObject({
  Id: z.string(),
  RepoTags: z.array(z.string()).nullish(),
  RepoDigests: z.array(z.string()).nullish(),
  Created: z.string().nullish(),
  Os: z.string().nullish(),
  Architecture: z.string().nullish(),
  Variant: z.string().nullish(),
  Size: z.number().nullish(),
  Config: z
    .looseObject({
      Env: z.array(z.string()).nullish(),
      Labels: z.record(z.string(), z.string()).nullish(),
      Entrypoint: z.array(z.string()).nullish(),
      Cmd: z.array(z.string()).nullish(),
      WorkingDir: z.string().nullish(),
      User: z.string().nullish(),
      Shell: z.array(z.string()).nullish(),
      StopSignal: z.string().nullish(),
      ExposedPorts: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});
export type ImageInspect = z.infer<typeof ImageInspectSchema>;

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

/** Bytes per second; `null` (no previous reading yet) shows as "—". */
export function formatRate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null) return "—";
  return bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : "0 B/s";
}

export function portLabel(port: PortMapping): string {
  const proto = port.type || "tcp";
  if (port.publicPort) {
    return `${port.ip ?? "0.0.0.0"}:${port.publicPort} → ${port.privatePort}/${proto}`;
  }
  return `${port.privatePort}/${proto}`;
}

/** Browser URL for a published TCP port; https when the container side is a TLS port. */
export function portUrl(hostPort: number | string, containerPort: number | string): string {
  const scheme = String(containerPort) === "443" || String(containerPort) === "8443" ? "https" : "http";
  return `${scheme}://localhost:${hostPort}`;
}

export function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12);
}

/** Truncate a long name to `start…end` instead of clipping the end away. */
export function middleEllipsis(text: string, max = 14): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/* ------------------------------ filesystem ----------------------------- */

export const FsEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["dir", "file", "link", "char", "block", "fifo", "socket", "other"]),
  size: z.number(),
  mode: z.string(),
  owner: z.string(),
  mtime: z.number(),
  target: z.string().nullable(),
});
export type FsEntry = z.infer<typeof FsEntrySchema>;

export const DirListingSchema = z.object({
  path: z.string(),
  entries: z.array(FsEntrySchema),
  truncated: z.boolean(),
});
export type DirListing = z.infer<typeof DirListingSchema>;

export const FileContentSchema = z.object({
  path: z.string(),
  kind: z.string(),
  size: z.number(),
  mode: z.string(),
  mtime: z.number(),
  linkTarget: z.string().nullable(),
  content: z.string().nullable(),
  binary: z.boolean(),
  truncated: z.boolean(),
});
export type FileContent = z.infer<typeof FileContentSchema>;

export const FsChangeSchema = z.object({
  path: z.string(),
  kind: z.enum(["A", "C", "D"]),
});
export type FsChange = z.infer<typeof FsChangeSchema>;

/* --------------------------------- exec -------------------------------- */

export const ExecEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("output"), stream: z.enum(["stdout", "stderr"]), data: z.string() }),
  z.object({ kind: z.literal("exit"), code: z.number().nullable(), error: z.string().nullable() }),
]);
export type ExecEvent = z.infer<typeof ExecEventSchema>;

export const ExecProbeSchema = z.object({
  shells: z.array(z.string()),
  users: z.array(z.string()),
  osId: z.string(),
  osName: z.string(),
  hostname: z.string(),
});
export type ExecProbe = z.infer<typeof ExecProbeSchema>;

export type ExecStartOptions = {
  cmd: string[];
  user?: string;
  workingDir?: string;
  env?: string[];
  tty?: boolean;
  cols?: number;
  rows?: number;
};
