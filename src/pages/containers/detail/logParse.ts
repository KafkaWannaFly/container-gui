import type { LogLine } from "../../../types/docker";

export type Level = "debug" | "info" | "warn" | "error";
export const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type ParsedLine = {
  /** Monotonic per stream session; stable React key. */
  seq: number;
  /** Docker's UTC timestamp, as sent. */
  ts: string;
  /** `ts` padded to nanoseconds so plain string comparison orders lines. */
  sortKey: string;
  /** `ts` as epoch milliseconds; NaN when missing or unparsable. */
  ms: number;
  stream: "stdout" | "stderr";
  level: Level;
  text: string;
  /** Present when the line is a JSON object. */
  json?: { msg: string; fields: [string, string][]; raw: Record<string, unknown> };
};

const LEVEL_WORDS: [RegExp, Level][] = [
  [/\b(FATAL|PANIC|CRIT(ICAL)?|ERR(OR)?|EMERG|ALERT)\b/i, "error"],
  [/\bWARN(ING)?\b/i, "warn"],
  [/\b(DEBUG|TRACE)\b/i, "debug"],
];
/** `level=warn`, `lvl: error`, `[error]` — explicit markers win over loose words. */
const LEVEL_MARKER = /(?:\b(?:level|lvl|severity)\s*[=:]\s*"?|\[)(\w+)/i;

const MSG_KEYS = ["msg", "message", "event", "log"];
const LEVEL_KEYS = ["level", "lvl", "severity", "log.level", "levelname"];
const TIME_KEYS = ["time", "ts", "timestamp", "@timestamp", "t"];

function toLevel(word: string | undefined, numeric = false): Level | null {
  if (!word) return null;
  const w = word.toLowerCase();
  if (/^(fatal|panic|crit|critical|err|error|emerg|alert)$/.test(w)) return "error";
  if (/^warn(ing)?$/.test(w)) return "warn";
  if (/^(debug|trace|verbose)$/.test(w)) return "debug";
  if (/^(info|notice|information)$/.test(w)) return "info";
  // Numeric (pino/bunyan): 10 trace … 60 fatal. JSON only: in text a
  // bracketed number is usually a date or pid.
  const n = Number(w);
  if (numeric && Number.isFinite(n) && n >= 10 && n <= 60)
    return n >= 50 ? "error" : n >= 40 ? "warn" : n >= 30 ? "info" : "debug";
  return null;
}

/**
 * Docker has no log levels; infer one from the text. Explicit markers
 * (`level=warn`, `[error]`) first, then loose words anywhere in the line.
 */
export function inferLevel(text: string): Level {
  // Levels sit near the start of a line; deeper matches are payload
  // ("error" inside a JSON result, a URL, a stack of field names).
  const head = text.slice(0, 160);
  const marker = toLevel(LEVEL_MARKER.exec(head)?.[1]);
  if (marker) return marker;
  for (const [re, level] of LEVEL_WORDS) if (re.test(head)) return level;
  return "info";
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseJson(text: string): NonNullable<ParsedLine["json"]> & { level: Level | null } {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const pick = (keys: string[]) => keys.find((k) => k in raw);
  const msgKey = pick(MSG_KEYS);
  const levelKey = pick(LEVEL_KEYS);
  const skip = new Set([msgKey, levelKey, ...TIME_KEYS]);
  return {
    msg: msgKey ? stringify(raw[msgKey]) : "",
    level: levelKey ? toLevel(stringify(raw[levelKey]), true) : null,
    fields: Object.entries(raw)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => [k, stringify(v)]),
    raw,
  };
}

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "off", "local" (follows the OS setting) or an IANA zone name. */
export type Stamps = string;
export const TZ_PREFIX = "tz:";

export function resolveZone(stamps: Stamps): string | null {
  if (stamps === "off") return null;
  if (stamps === "local") return LOCAL_TZ;
  try {
    new Intl.DateTimeFormat("en", { timeZone: stamps });
    return stamps;
  } catch {
    return LOCAL_TZ; // A stored zone this runtime doesn't know.
  }
}

/**
 * One zone per common UTC offset, named by well-known cities. Cities in
 * one entry share DST rules, so the offset shown is right for all of them.
 */
export const ZONES: [tz: string, cities: string][] = [
  ["Pacific/Pago_Pago", "Pago Pago"],
  ["Pacific/Honolulu", "Honolulu"],
  ["America/Anchorage", "Anchorage"],
  ["America/Los_Angeles", "Los Angeles, Vancouver"],
  ["America/Denver", "Denver, Calgary"],
  ["America/Chicago", "Chicago, Dallas"],
  ["America/New_York", "New York, Toronto"],
  ["America/Halifax", "Halifax"],
  ["America/Sao_Paulo", "São Paulo, Buenos Aires"],
  ["Atlantic/South_Georgia", "South Georgia"],
  ["Atlantic/Azores", "Azores"],
  ["Europe/London", "London, Dublin, Lisbon"],
  ["Europe/Paris", "Paris, Berlin, Rome"],
  ["Europe/Athens", "Athens, Helsinki, Kyiv"],
  ["Europe/Istanbul", "Istanbul, Moscow, Riyadh"],
  ["Asia/Dubai", "Dubai, Baku"],
  ["Asia/Karachi", "Karachi, Tashkent"],
  ["Asia/Kolkata", "Mumbai, New Delhi"],
  ["Asia/Dhaka", "Dhaka"],
  ["Asia/Bangkok", "Bangkok, Jakarta, Ho Chi Minh City"],
  ["Asia/Singapore", "Singapore, Beijing, Perth"],
  ["Asia/Tokyo", "Tokyo, Seoul"],
  ["Australia/Sydney", "Sydney, Melbourne"],
  ["Pacific/Auckland", "Auckland"],
];
const CITIES = new Map(ZONES);

/** " (local time)" or " (Tokyo, Seoul)" for the footer. */
export function zoneCities(stamps: Stamps, zone: string): string {
  if (stamps === "local") return " (local time)";
  const cities = CITIES.get(zone);
  return cities ? ` (${cities})` : "";
}

/** `+05:30` → 330, for ordering zones by their current offset. */
export function offsetMinutes(offset: string): number {
  const [h, m] = offset.slice(1).split(":").map(Number);
  return (offset.startsWith("-") ? -1 : 1) * (h * 60 + m);
}

export function stampsLabelOf(stamps: Stamps, zone: string | null): string {
  if (zone === null) return "Hidden";
  if (stamps === "local") return "Local";
  if (zone === "UTC") return "UTC";
  return `UTC${zoneOffset(zone)}`;
}

/** Docker sends nanoseconds; Date only keeps milliseconds. */
export function epochMs(ts: string): number {
  return ts ? new Date(ts.replace(/(\.\d{3})\d+/, "$1")).getTime() : Number.NaN;
}

const stampFormats = new Map<string, Intl.DateTimeFormat>();

function formatMs(ms: number, fallback: string, timeZone: string): string {
  if (Number.isNaN(ms)) return fallback;
  let fmt = stampFormats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    });
    stampFormats.set(timeZone, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond}`;
}

/**
 * `yyyy-MM-dd HH:mm:ss.SSS` in `timeZone`. Formatters are cached; only
 * visible rows are formatted, so this stays cheap for big logs.
 */
export function formatStamp(line: ParsedLine, timeZone: string): string {
  return formatMs(line.ms, line.ts, timeZone);
}

export function formatTimestamp(ts: string, timeZone: string): string {
  return formatMs(epochMs(ts), ts, timeZone);
}

/** `+08:00` style offset of `timeZone` right now. */
export function zoneOffset(timeZone: string): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  // "GMT+08:00", or bare "GMT" for UTC.
  return name.replace("GMT", "") || "+00:00";
}

/** Docker trims trailing zeros from the fraction, so pad before comparing. */
export function sortKey(ts: string): string {
  const match = /^(.*?)(?:\.(\d+))?Z$/.exec(ts);
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z` : ts;
}

export function parseLine(line: LogLine, seq: number): ParsedLine {
  const parsed: ParsedLine = {
    seq,
    ts: line.ts,
    sortKey: sortKey(line.ts),
    ms: epochMs(line.ts),
    stream: line.stream,
    level: "info",
    text: line.text,
  };
  const trimmed = line.text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const { level, ...json } = parseJson(trimmed);
      parsed.json = json;
      parsed.level = level ?? inferLevel(json.msg);
      return parsed;
    } catch {
      // Not JSON after all; fall through to text inference.
    }
  }
  parsed.level = inferLevel(line.text);
  return parsed;
}
