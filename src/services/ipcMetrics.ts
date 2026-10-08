import { type InvokeArgs, invoke } from "@tauri-apps/api/core";
import { warn } from "@tauri-apps/plugin-log";

/**
 * IPC middleware: every Tauri command goes through `timedInvoke`, which
 * records round-trip time and JSON payload sizes per command. Tauri has no
 * public hook on the Rust side for command completion, so the frontend is
 * the one place that sees every call end to end (Rust work + serialization +
 * transport).
 *
 * Enabled in dev builds, or in release via `localStorage["ipc-metrics"] = "1"`.
 * In dev, inspect from DevTools with
 * `console.table((await import("/src/services/ipcMetrics.ts")).ipcStats())`.
 * Each call also appears as an `ipc:<command>` measure in the Performance
 * panel, and slow/large calls are logged as warnings.
 */
export const IPC_METRICS_ENABLED: boolean =
  import.meta.env.DEV || globalThis.localStorage?.getItem("ipc-metrics") === "1";

const SLOW_MS = 500;
const LARGE_BYTES = 1_000_000;
const WINDOW = 200;

type Stat = {
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  recentMs: number[];
  reqBytes: number;
  resBytes: number;
  maxResBytes: number;
  parseMs: number;
  messages: number;
  messageBytes: number;
};

const stats = new Map<string, Stat>();

function statFor(cmd: string): Stat {
  let stat = stats.get(cmd);
  if (!stat) {
    stat = {
      calls: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
      recentMs: [],
      reqBytes: 0,
      resBytes: 0,
      maxResBytes: 0,
      parseMs: 0,
      messages: 0,
      messageBytes: 0,
    };
    stats.set(cmd, stat);
  }
  return stat;
}

/** Approximate wire size: length of the JSON text (UTF-16 units ≈ bytes for ASCII). */
function jsonSize(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function record(
  cmd: string,
  start: number,
  args: InvokeArgs | undefined,
  payload: unknown,
  ok: boolean,
  stream: boolean,
) {
  const end = performance.now();
  const ms = end - start;
  const reqBytes = jsonSize(args);
  const resBytes = jsonSize(payload);

  const stat = statFor(cmd);
  stat.calls += 1;
  if (!ok) stat.errors += 1;
  stat.totalMs += ms;
  stat.maxMs = Math.max(stat.maxMs, ms);
  stat.recentMs.push(ms);
  if (stat.recentMs.length > WINDOW) stat.recentMs.shift();
  stat.reqBytes += reqBytes;
  stat.resBytes += resBytes;
  stat.maxResBytes = Math.max(stat.maxResBytes, resBytes);

  // The performance timeline buffer is unbounded; trim it for polled commands.
  if (stat.calls % 1000 === 0) performance.clearMeasures(`ipc:${cmd}`);
  performance.measure(`ipc:${cmd}`, { start, end, detail: { ok, reqBytes, resBytes } });

  // Stream commands resolve when the stream ends, so their duration is the
  // stream lifetime rather than latency.
  if (!stream && (ms >= SLOW_MS || resBytes >= LARGE_BYTES)) {
    void warn(
      `[ipc] slow/large command ${cmd}: round trip ${ms.toFixed(1)} ms, req ${formatBytes(reqBytes)}, ` +
        `res ${formatBytes(resBytes)}${ok ? "" : " (error)"}`,
    );
  }
}

/**
 * Drop-in replacement for `invoke` that records the full round trip (timer
 * starts before `invoke()`, stops when the response arrives) and payload sizes.
 * Size measurement happens after the timer stops, so it is not counted.
 */
export async function timedInvoke<T>(
  cmd: string,
  args?: InvokeArgs,
  options: { stream?: boolean } = {},
): Promise<T> {
  if (!IPC_METRICS_ENABLED) return invoke<T>(cmd, args);
  const start = performance.now();
  try {
    const result = await invoke<T>(cmd, args);
    record(cmd, start, args, result, true, options.stream ?? false);
    return result;
  } catch (err) {
    record(cmd, start, args, err, false, options.stream ?? false);
    throw err;
  }
}

/** Record time spent validating a command's response on the frontend. */
export function recordParse(cmd: string, ms: number) {
  if (IPC_METRICS_ENABLED) statFor(cmd).parseMs += ms;
}

/** Record one message delivered over a command's `Channel`. */
export function recordChannelMessage(cmd: string, raw: unknown) {
  if (!IPC_METRICS_ENABLED) return;
  const stat = statFor(cmd);
  stat.messages += 1;
  stat.messageBytes += jsonSize(raw);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export type IpcStatRow = {
  command: string;
  calls: number;
  errors: number;
  /** invoke() start → response received: Rust work + serialization + transport. */
  avgRoundTripMs: number;
  p95RoundTripMs: number;
  maxRoundTripMs: number;
  /** Zod validation of the response on the frontend. */
  avgParseMs: number;
  /** Round trip + parse: API call start → validated data. */
  avgTotalMs: number;
  avgReq: string;
  avgRes: string;
  maxRes: string;
  totalRes: string;
  messages: number;
  messageData: string;
};

/** Per-command summary, slowest total time first. */
export function ipcStats(): IpcStatRow[] {
  const round = (n: number) => Math.round(n * 10) / 10;
  return [...stats.entries()]
    .sort(([, a], [, b]) => b.totalMs - a.totalMs)
    .map(([command, s]) => ({
      command,
      calls: s.calls,
      errors: s.errors,
      avgRoundTripMs: round(s.calls ? s.totalMs / s.calls : 0),
      p95RoundTripMs: round(percentile(s.recentMs, 95)),
      maxRoundTripMs: round(s.maxMs),
      avgParseMs: round(s.calls ? s.parseMs / s.calls : 0),
      avgTotalMs: round(s.calls ? (s.totalMs + s.parseMs) / s.calls : 0),
      avgReq: formatBytes(s.calls ? Math.round(s.reqBytes / s.calls) : 0),
      avgRes: formatBytes(s.calls ? Math.round(s.resBytes / s.calls) : 0),
      maxRes: formatBytes(s.maxResBytes),
      totalRes: formatBytes(s.resBytes),
      messages: s.messages,
      messageData: formatBytes(s.messageBytes),
    }));
}

export function ipcStatsReset() {
  for (const cmd of stats.keys()) performance.clearMeasures(`ipc:${cmd}`);
  stats.clear();
}
