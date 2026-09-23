import { format } from "date-fns";

/** Docker's zero time for "never" (e.g. FinishedAt of a running container). */
export function isZeroTime(iso: string | null | undefined): boolean {
  return !iso || iso.startsWith("0001-01-01");
}

/** Local wall-clock time, e.g. `2026-09-23 15:04:05`. */
export function localTime(iso: string | null | undefined, pattern = "yyyy-MM-dd HH:mm:ss"): string {
  if (isZeroTime(iso)) return "—";
  const date = new Date(iso as string);
  return Number.isNaN(date.getTime()) ? "—" : format(date, pattern);
}

/** Compact duration: `4d 6h 21m`, `6h 2m`, `42s`. */
export function compactDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Docker durations are nanoseconds. */
export function nsDuration(ns: number | null | undefined): string {
  if (!ns) return "—";
  const ms = ns / 1e6;
  return ms < 1000 ? `${ms}ms` : `${ms / 1000}s`;
}

/** Join argv the way a shell would read it back. */
export function shellJoin(args: string[] | null | undefined): string {
  if (!args?.length) return "";
  return args.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ");
}
