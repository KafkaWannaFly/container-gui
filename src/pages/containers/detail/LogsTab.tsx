import {
  CheckOutlined,
  ClearOutlined,
  DownloadOutlined,
  DownOutlined,
  EyeOutlined,
  SearchOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { Alert, Button, Checkbox, Dropdown, Input, type MenuProps, Select, Tooltip } from "antd";
import { format } from "date-fns";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { z } from "zod";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { useSaveFile } from "../../../hooks/useSaveFile";
import { saveContainerLogs, streamContainerLogs } from "../../../services/tauriApi";
import { formatStamp, LEVEL_RANK, type Level, type ParsedLine, parseLine, zoneOffset } from "./logParse";
import { containerName, type TabProps } from "./model";

/** Lines kept in memory; the oldest are dropped in chunks past this. */
const MAX_LINES = 50_000;
const DROP_CHUNK = 5_000;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "off", "local" (follows the OS setting) or an IANA zone name. */
type Stamps = string;
const TZ_PREFIX = "tz:";

function resolveZone(stamps: Stamps): string | null {
  if (stamps === "off") return null;
  if (stamps === "local") return LOCAL_TZ;
  try {
    new Intl.DateTimeFormat("en", { timeZone: stamps });
    return stamps;
  } catch {
    return LOCAL_TZ; // A stored zone this runtime doesn't know.
  }
}

/** Every IANA zone with its current offset; built on first open of the menu. */
/**
 * One zone per common UTC offset, named by well-known cities. Cities in
 * one entry share DST rules, so the offset shown is right for all of them.
 */
const ZONES: [tz: string, cities: string][] = [
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
function zoneCities(stamps: Stamps, zone: string): string {
  if (stamps === "local") return " (local time)";
  const cities = CITIES.get(zone);
  return cities ? ` (${cities})` : "";
}

/** `+05:30` → 330, for ordering zones by their current offset. */
function offsetMinutes(offset: string): number {
  const [h, m] = offset.slice(1).split(":").map(Number);
  return (offset.startsWith("-") ? -1 : 1) * (h * 60 + m);
}

function zoneItems(selected: Stamps): NonNullable<MenuProps["items"]> {
  const check = (key: Stamps) => (selected === key ? <CheckOutlined /> : <span className="lg-nocheck" />);
  const zones = ZONES.map(([tz, cities]) => ({ tz, cities, offset: zoneOffset(tz) })).sort(
    (a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset),
  );
  return [
    { key: `${TZ_PREFIX}off`, icon: check("off"), label: "Hidden" },
    {
      key: `${TZ_PREFIX}local`,
      icon: check("local"),
      label: "Local time",
      extra: `UTC${zoneOffset(LOCAL_TZ)}`,
    },
    { key: `${TZ_PREFIX}UTC`, icon: check("UTC"), label: "UTC", extra: "UTC+00:00" },
    { type: "divider" },
    ...zones.map(({ tz, cities, offset }) => ({
      key: `${TZ_PREFIX}${tz}`,
      icon: check(tz),
      label: cities,
      extra: `UTC${offset}`,
    })),
  ];
}

/**
 * Clear cut-offs per container (sort key of the last hidden line), kept
 * for the app session so re-opening the tab or re-tailing stays cleared.
 */
const clearedAt = new Map<string, string>();

type Filter = "all" | Level;
type Options = { zone: string | null; pretty: boolean; q: string };

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    out.push(
      text.slice(from, at),
      <span key={at} className="hl">
        {text.slice(at, at + q.length)}
      </span>,
    );
    from = at + q.length;
  }
  out.push(text.slice(from));
  return out;
}

function LogRow({ line, opts }: { line: ParsedLine; opts: Options }) {
  const [open, setOpen] = useState(false);
  const json = opts.pretty ? line.json : undefined;
  return (
    <div className={`lg-row lg-${line.level}`} title={line.stream === "stderr" ? "stderr" : undefined}>
      {opts.zone && line.ts ? (
        <span className="lg-ts" title={`${line.ts} (UTC)`}>
          {formatStamp(line, opts.zone)}{" "}
        </span>
      ) : null}
      <span className="lg-lvl">{line.level.toUpperCase()}</span>
      {json ? (
        <>
          {/* A span, not a button: buttons are always inline-block and would break the line. */}
          {/* biome-ignore lint/a11y/useSemanticElements: see above; role and key handling keep it accessible */}
          <span
            role="button"
            tabIndex={0}
            className="lg-json"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((o) => !o);
              }
            }}
          >
            {json.msg ? highlight(json.msg, opts.q) : null}
            {json.fields.map(([k, v], i) => (
              <span key={k} className="lg-field">
                {json.msg || i > 0 ? " " : ""}
                {k}={highlight(v, opts.q)}
              </span>
            ))}
          </span>
          {open ? <pre className="lg-pretty">{JSON.stringify(json.raw, null, 2)}</pre> : null}
        </>
      ) : (
        <span>{highlight(line.text, opts.q)}</span>
      )}
    </div>
  );
}

export default function LogsTab({ ctr }: TabProps) {
  const id = ctr.Id;
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<Filter>("all");
  const [follow, setFollow] = useState(true);
  const [stamps, setStamps] = usePersistentState<Stamps>("logs.timestamps", z.string(), "local");
  const [wrap, setWrap] = usePersistentState("logs.wrap", z.boolean(), true);
  const [pretty, setPretty] = usePersistentState("logs.pretty", z.boolean(), true);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [tail, setTail] = useState("500");
  const [cutoff, setCutoff] = useState(() => clearedAt.get(id) ?? "");
  const [ended, setEnded] = useState<{ error: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const buffer = useRef<ParsedLine[]>([]);
  const listRef = useRef<VirtuosoHandle>(null);
  const save = useSaveFile();

  // Restart the stream when the container (re)starts so new output shows up.
  const startedAt = ctr.State?.StartedAt;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `startedAt` re-subscribes after a restart
  useEffect(() => {
    buffer.current = [];
    setVersion((v) => v + 1);
    setEnded(null);
    let seq = 0;
    let frame = 0;
    const bump = () => {
      frame = 0;
      setVersion((v) => v + 1);
    };
    const dispose = streamContainerLogs(
      id,
      { tail: tail === "all" ? null : Number(tail) },
      {
        onLines: (lines) => {
          const buf = buffer.current;
          for (const line of lines) buf.push(parseLine(line, seq++));
          if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES + DROP_CHUNK);
          // Coalesce bursts into one render per frame.
          if (!frame) frame = requestAnimationFrame(bump);
        },
        onEnd: (error) => setEnded({ error }),
      },
    );
    return () => {
      dispose();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [id, tail, startedAt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals buffer mutation
  const { rows, visible, counts } = useMemo(() => {
    const counts: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    const visible: ParsedLine[] = [];
    for (const line of buffer.current) {
      if (cutoff && line.sortKey <= cutoff) continue;
      counts[line.level] += 1;
      visible.push(line);
    }
    const needle = q.toLowerCase();
    const rows = visible.filter(
      (line) =>
        (level === "all" || LEVEL_RANK[line.level] >= LEVEL_RANK[level]) &&
        (!needle || line.text.toLowerCase().includes(needle)),
    );
    return { rows, visible, counts };
  }, [version, q, level, cutoff]);

  const hidden = buffer.current.length - visible.length;
  const hasJson = useMemo(() => rows.some((line) => line.json), [rows]);

  // Turning Follow back on jumps to the newest line.
  useEffect(() => {
    if (follow) listRef.current?.scrollToIndex({ index: "LAST" });
  }, [follow]);

  const clear = () => {
    const last = buffer.current[buffer.current.length - 1]?.sortKey ?? "";
    clearedAt.set(id, last);
    setCutoff(last);
  };
  const unclear = () => {
    clearedAt.delete(id);
    setCutoff("");
  };

  const zone = useMemo(() => resolveZone(stamps), [stamps]);
  const opts: Options = { zone, pretty, q };
  // Built lazily: formatting ~400 zone offsets is only worth it once the menu opens.
  const zones = useMemo(() => (displayOpen ? zoneItems(stamps) : []), [displayOpen, stamps]);
  const onDisplayClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "wrap") setWrap((on) => !on);
    else if (key === "pretty") setPretty((on) => !on);
    else if (key.startsWith(TZ_PREFIX)) {
      setStamps(key.slice(TZ_PREFIX.length));
      setDisplayOpen(false);
    }
  };
  const stampsLabel =
    zone === null
      ? "Hidden"
      : stamps === "local"
        ? "Local"
        : zone === "UTC"
          ? "UTC"
          : `UTC${zoneOffset(zone)}`;
  const toggleLevel = (next: Level) => setLevel((cur) => (cur === next ? "all" : next));
  const filtered = q || level !== "all";
  const running = !!ctr.State?.Running;
  const stamp = format(new Date(), "yyyyMMdd-HHmmss");

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Input
          placeholder="Search in logs"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          prefix={<SearchOutlined style={{ color: "var(--ash)" }} />}
          style={{ width: 220 }}
        />
        <Tooltip title="Levels are inferred from the text; Docker does not record them.">
          <span className="lg-chips">
            <button
              type="button"
              className={`lg-chip${level === "all" ? " on" : ""}`}
              onClick={() => setLevel("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`lg-chip warn${level === "warn" ? " on" : ""}${counts.warn ? "" : " zero"}`}
              onClick={() => toggleLevel("warn")}
            >
              ▲ {counts.warn} warn
            </button>
            <button
              type="button"
              className={`lg-chip error${level === "error" ? " on" : ""}${counts.error ? "" : " zero"}`}
              onClick={() => toggleLevel("error")}
            >
              ● {counts.error} error
            </button>
          </span>
        </Tooltip>
        <Select
          value={tail}
          onChange={setTail}
          style={{ width: 116 }}
          options={[
            { value: "100", label: "Last 100" },
            { value: "500", label: "Last 500" },
            { value: "5000", label: "Last 5000" },
            { value: "all", label: "All lines" },
          ]}
        />
        <span className="spacer" />
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          open={displayOpen}
          // Stay open while toggling options; close on outside click or the button.
          onOpenChange={(next, info) => {
            if (info.source === "trigger") setDisplayOpen(next);
          }}
          menu={{
            onClick: onDisplayClick,
            items: [
              {
                key: "timestamps",
                label: (
                  <span className="lg-menu-row">
                    Timestamps <span className="dim">{stampsLabel}</span>
                  </span>
                ),
                popupClassName: "lg-tz-menu",
                children: zones,
              },
              { type: "divider" },
              { key: "wrap", label: <Checkbox checked={wrap}>Wrap lines</Checkbox> },
              {
                key: "pretty",
                disabled: !hasJson,
                label: (
                  <Tooltip
                    placement="left"
                    title={
                      hasJson
                        ? "Show JSON lines as level, message and fields. Click a line for the full object."
                        : "No JSON lines in this log."
                    }
                  >
                    <Checkbox checked={pretty && hasJson} disabled={!hasJson}>
                      Pretty JSON
                    </Checkbox>
                  </Tooltip>
                ),
              },
            ],
          }}
        >
          <Button icon={<EyeOutlined />}>
            Display <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>
        <Tooltip
          title={
            follow
              ? "Following: the view stays on the newest line as output arrives. Click or scroll up to pause."
              : "Paused: click to jump to the newest line and keep up with new output."
          }
        >
          <Button
            icon={<VerticalAlignBottomOutlined />}
            type={follow ? "primary" : "default"}
            onClick={() => setFollow((f) => !f)}
          >
            Follow
          </Button>
        </Tooltip>
        <Tooltip title="Clear — hides the current lines from this view. Container logs are not deleted.">
          <Button aria-label="Clear" icon={<ClearOutlined />} onClick={clear} disabled={!visible.length} />
        </Tooltip>
        <Tooltip title="Save the full log (all lines, both streams).">
          <Button
            aria-label="Download"
            icon={<DownloadOutlined />}
            onClick={() =>
              void save(`${containerName(ctr)}-${stamp}.log`, (dest) => saveContainerLogs(id, dest))
            }
          />
        </Tooltip>
      </div>

      {ended?.error ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Logs unavailable"
          description={`${ended.error}${
            ctr.HostConfig?.LogConfig?.Type ? ` (log driver: ${ctr.HostConfig.LogConfig.Type})` : ""
          }`}
        />
      ) : null}

      <div className={`log-view${wrap ? "" : " nowrap"}`} role="log" aria-live="off">
        {hidden > 0 ? (
          <div className="dim lg-hidden">
            {hidden} earlier line{hidden === 1 ? "" : "s"} hidden by Clear ·{" "}
            <button type="button" className="link-btn" onClick={unclear}>
              Show
            </button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <span className="dim">
            {filtered
              ? "No log lines match the current filter."
              : ended
                ? "No log output."
                : "Waiting for output…"}
          </span>
        ) : (
          <Virtuoso
            ref={listRef}
            className="lg-list"
            data={rows}
            computeItemKey={(_, line) => line.seq}
            initialTopMostItemIndex={rows.length - 1}
            followOutput={follow ? "auto" : false}
            atBottomStateChange={setFollow}
            itemContent={(_, line) => <LogRow line={line} opts={opts} />}
          />
        )}
      </div>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          {rows.length} lines{filtered ? ` (filtered from ${visible.length})` : ""}
          {zone ? ` · times in UTC${zoneOffset(zone)}${zoneCities(stamps, zone)}` : ""}
          {buffer.current.length >= MAX_LINES - DROP_CHUNK ? ` · keeping the newest ${MAX_LINES} lines` : ""}
        </span>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          {ended
            ? running
              ? "Stream ended."
              : "Container is not running — showing its last output."
            : follow
              ? "Following — scroll up to pause."
              : "Paused — new lines keep arriving below."}
        </span>
      </div>
    </div>
  );
}
