import { format } from "date-fns";
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
  /** Pre-formatted local time; formatting per render is too slow for big logs. */
  local: string;
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

/** Docker sends nanoseconds; Date only keeps milliseconds. */
function localTime(ts: string): string {
  if (!ts) return "";
  const date = new Date(ts.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(date.getTime()) ? ts : format(date, "yyyy-MM-dd HH:mm:ss.SSS");
}

/** Docker trims trailing zeros from the fraction, so pad before comparing. */
export function sortKey(ts: string): string {
  const match = /^(.*?)(?:.(d+))?Z$/.exec(ts);
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z` : ts;
}

export function parseLine(line: LogLine, seq: number): ParsedLine {
  const parsed: ParsedLine = {
    seq,
    ts: line.ts,
    sortKey: sortKey(line.ts),
    local: localTime(line.ts),
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
