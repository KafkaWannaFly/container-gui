import {
  ClearOutlined,
  DownloadOutlined,
  DownOutlined,
  EyeOutlined,
  SearchOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { Alert, Button, Dropdown, Input, Select, Tooltip } from "antd";
import { format } from "date-fns";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useSaveToDownloads } from "../../../hooks/useSaveToDownloads";
import { saveContainerLogs, streamContainerLogs } from "../../../services/tauriApi";
import { LEVEL_RANK, type Level, type ParsedLine, parseLine } from "./logParse";
import { containerName, type TabProps } from "./model";

/** Lines kept in memory; the oldest are dropped in chunks past this. */
const MAX_LINES = 50_000;
const DROP_CHUNK = 5_000;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_OFFSET = format(new Date(), "xxx");

/**
 * Clear cut-offs per container (sort key of the last hidden line), kept
 * for the app session so re-opening the tab or re-tailing stays cleared.
 */
const clearedAt = new Map<string, string>();

type Filter = "all" | Level;
type Options = { timestamps: boolean; pretty: boolean; q: string };

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
    <div
      className={`lg-row lg-${line.level}${line.stream === "stderr" ? " stderr" : ""}`}
      title={line.stream === "stderr" ? "stderr" : undefined}
    >
      {opts.timestamps && line.local ? (
        <span className="lg-ts" title={`${line.ts} (UTC)`}>
          {line.local}{" "}
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
  const [timestamps, setTimestamps] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [pretty, setPretty] = useState(true);
  const [tail, setTail] = useState("500");
  const [cutoff, setCutoff] = useState(() => clearedAt.get(id) ?? "");
  const [ended, setEnded] = useState<{ error: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const buffer = useRef<ParsedLine[]>([]);
  const listRef = useRef<VirtuosoHandle>(null);
  const save = useSaveToDownloads();

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

  const opts: Options = { timestamps, pretty, q };
  const display = [timestamps && "timestamps", wrap && "wrap", pretty && "pretty"].filter(
    Boolean,
  ) as string[];
  const displaySetters: Record<string, (on: boolean) => void> = {
    timestamps: setTimestamps,
    wrap: setWrap,
    pretty: setPretty,
  };
  const setDisplayOption = (key: string, on: boolean) => displaySetters[key]?.(on);
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
          menu={{
            selectable: true,
            multiple: true,
            selectedKeys: display,
            onSelect: ({ key }) => setDisplayOption(key, true),
            onDeselect: ({ key }) => setDisplayOption(key, false),
            items: [
              { key: "timestamps", label: "Timestamps", extra: LOCAL_TZ },
              { key: "wrap", label: "Wrap lines" },
              {
                key: "pretty",
                label: (
                  <Tooltip
                    placement="left"
                    title="Show JSON lines as level, message and fields. Click a line for the full object."
                  >
                    <span style={{ display: "block" }}>Pretty JSON</span>
                  </Tooltip>
                ),
                disabled: !hasJson,
              },
            ],
          }}
        >
          <Button icon={<EyeOutlined />}>
            Display <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>
        <Button
          icon={<VerticalAlignBottomOutlined />}
          type={follow ? "primary" : "default"}
          onClick={() => setFollow((f) => !f)}
        >
          Follow
        </Button>
        <Tooltip title="Clear — hides the current lines from this view. Container logs are not deleted.">
          <Button aria-label="Clear" icon={<ClearOutlined />} onClick={clear} disabled={!visible.length} />
        </Tooltip>
        <Tooltip title="Download the full log (all lines, both streams) to Downloads.">
          <Button
            aria-label="Download"
            icon={<DownloadOutlined />}
            onClick={() => void save(() => saveContainerLogs(id, `${containerName(ctr)}-${stamp}.log`))}
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
          {timestamps ? ` · times in ${LOCAL_TZ} (UTC${TZ_OFFSET})` : ""}
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
