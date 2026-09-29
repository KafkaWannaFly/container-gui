import { ClearOutlined, SearchOutlined, VerticalAlignBottomOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Segmented, Select, Switch, Tooltip } from "antd";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { StateDot } from "../../../components/ui";
import { streamContainerLogs } from "../../../services/tauriApi";
import { type ContainerSummary, middleEllipsis } from "../../../types/docker";
import { ContainerFilter } from "./components";
import { svcColor } from "./model";

type Level = "debug" | "info" | "warn" | "error" | "event";
type GLine = { seq: number; id: string; ts: string; level: Level; text: string };

const RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LINES = 4000;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Log lines carry no level field, so guess it from the message. */
function levelOf(text: string): Level {
  if (/\b(FATAL|ERROR|ERR|PANIC|CRITICAL)\b/i.test(text)) return "error";
  if (/\b(WARN|WARNING)\b/i.test(text)) return "warn";
  if (/\b(DEBUG|TRACE)\b/i.test(text)) return "debug";
  return "info";
}

function tailOption(value: string): number | null {
  if (value === "all" || value === "since") return null;
  return Number(value);
}

export default function LogsTab({
  containers,
  states,
  solo,
}: {
  containers: ContainerSummary[];
  states: Map<string, string>;
  solo: string | null;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [events, setEvents] = useState(true);
  const [view, setView] = useState("merged");
  const [follow, setFollow] = useState(true);
  const [timestamps, setTimestamps] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [tail, setTail] = useState("500");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(
    solo ? containers.filter((c) => c.id !== solo).map((c) => c.id) : [],
  );
  const [lines, setLines] = useState<GLine[]>([]);
  const [cleared, setCleared] = useState(0);

  const seqRef = useRef(0);
  const pinnedRef = useRef<GLine[]>([]);
  const paneRef = useRef<HTMLDivElement | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const ctr of containers) map.set(ctr.id, (ctr.names[0] ?? ctr.id.slice(0, 12)).replace(/^\//, ""));
    return map;
  }, [containers]);

  // Stream every container; batches append to a capped buffer.
  useEffect(() => {
    const tailLines = tailOption(tail);
    const disposers = containers.map((ctr) =>
      streamContainerLogs(
        ctr.id,
        { tail: tailLines, follow: true },
        {
          onLines: (batch) => {
            setLines((prev) => {
              const next = [...prev];
              for (const line of batch) {
                next.push({
                  seq: seqRef.current++,
                  id: ctr.id,
                  ts: line.ts,
                  level: levelOf(line.text),
                  text: line.text,
                });
              }
              return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
            });
          },
        },
      ),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [containers, tail]);

  // Lifecycle events: derived from state transitions, no backend event feed.
  // ponytail: session-only, from what we observe — swap for docker events if needed.
  const prevStates = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const prev = prevStates.current;
    const next = new Map(states);
    if (prev) {
      for (const [id, state] of next) {
        const before = prev.get(id);
        if (before && before !== state) {
          const name = nameOf.get(id) ?? id.slice(0, 12);
          pinnedRef.current.push({
            seq: seqRef.current++,
            id,
            ts: new Date().toISOString(),
            level: "event",
            text: `${name}: ${before} → ${state}`,
          });
        }
      }
    }
    prevStates.current = next;
  }, [states, nameOf]);

  const shownKeys = containers.filter((ctr) => !hidden.includes(ctr.id));
  const shownSet = useMemo(() => new Set(shownKeys.map((ctr) => ctr.id)), [shownKeys]);

  const allLines = useMemo(() => [...lines, ...pinnedRef.current.slice(-40)], [lines]);

  const rows = useMemo(
    () =>
      allLines
        .filter(
          (line) =>
            shownSet.has(line.id) &&
            (line.level === "event" ? events : level === "all" || RANK[line.level] >= RANK[level]) &&
            (!query || line.text.toLowerCase().includes(query.toLowerCase())),
        )
        .slice(cleared),
    [allLines, shownSet, events, level, query, cleared],
  );

  const errCount = allLines.filter((line) => line.level === "error" && shownSet.has(line.id)).length;
  const warnCount = allLines.filter((line) => line.level === "warn" && shownSet.has(line.id)).length;

  function near(ts: string): boolean {
    return Boolean(anchor && ts && Math.abs(new Date(ts).getTime() - new Date(anchor).getTime()) <= 2000);
  }

  // Follow sticks to the bottom of every pane.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll whenever lines or layout change
  useEffect(() => {
    if (!follow || !paneRef.current) return;
    for (const pane of paneRef.current.querySelectorAll("[data-pane]")) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [rows, follow, view]);

  const only = (id: string) => setHidden(containers.filter((ctr) => ctr.id !== id).map((ctr) => ctr.id));

  const renderText = (text: string) => {
    if (!query) return text;
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return text;
    return (
      <>
        {text.slice(0, index)}
        <span className="hl">{text.slice(index, index + query.length)}</span>
        {text.slice(index + query.length)}
      </>
    );
  };

  const line = (item: GLine, withTag: boolean) => {
    const color = svcColor(containers.find((ctr) => ctr.id === item.id)?.composeService ?? "");
    const cls = `g-row g-${item.level}${anchor === item.ts ? " g-anchor" : near(item.ts) ? " g-near" : ""}`;
    return (
      <div key={item.seq} className={cls} style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }}>
        {timestamps ? (
          <button
            type="button"
            className="g-ts"
            title="Highlight everything within ±2s across containers"
            onClick={() => setAnchor((prev) => (prev === item.ts ? null : item.ts))}
          >
            {item.ts ? format(new Date(item.ts), "HH:mm:ss.SSS") : "--:--:--.---"}
          </button>
        ) : null}
        {withTag ? (
          <button
            type="button"
            className="g-tag"
            style={{ color, borderColor: color }}
            title={`${nameOf.get(item.id)} — click to show only this`}
            onClick={() => only(item.id)}
          >
            {middleEllipsis(nameOf.get(item.id) ?? "")}
          </button>
        ) : null}
        <span className="g-lvl">{item.level === "event" ? "●" : item.level.toUpperCase()}</span>
        <span className="msg">{renderText(item.text)}</span>
      </div>
    );
  };

  const empty = (
    <span className="dim" style={{ padding: "0 12px" }}>
      No log lines match the current filter.
    </span>
  );

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <Input
          placeholder="Search all containers"
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          prefix={<SearchOutlined style={{ color: "var(--smoke)" }} />}
          style={{ width: 220 }}
        />
        <Segmented
          value={level}
          onChange={(value) => setLevel(String(value))}
          options={[
            { label: "All", value: "all" },
            { label: "Info", value: "info" },
            { label: `Warn ${warnCount}`, value: "warn" },
            { label: `Error ${errCount}`, value: "error" },
          ]}
        />
        <Select
          value={tail}
          onChange={setTail}
          style={{ width: 150 }}
          options={[
            { value: "100", label: "Last 100 / ctr" },
            { value: "500", label: "Last 500 / ctr" },
            { value: "since", label: "Since last up" },
            { value: "all", label: "All lines" },
          ]}
        />
        <span className="spacer" />
        <span className="switch-label">
          <Switch size="small" checked={timestamps} onChange={setTimestamps} />
          <span className="dim" style={{ fontSize: 12 }}>
            Timestamps
          </span>
        </span>
        {view === "merged" ? (
          <span className="switch-label">
            <Switch size="small" checked={wrap} onChange={setWrap} />
            <span className="dim" style={{ fontSize: 12 }}>
              Wrap
            </span>
          </span>
        ) : null}
        <Button
          icon={<VerticalAlignBottomOutlined />}
          type={follow ? "primary" : "default"}
          onClick={() => setFollow((prev) => !prev)}
        >
          Follow
        </Button>
        <Tooltip title="Clear">
          <Button icon={<ClearOutlined />} aria-label="Clear" onClick={() => setCleared(allLines.length)} />
        </Tooltip>
      </div>

      <div className="toolbar" style={{ marginBottom: 12, gap: 6 }}>
        <ContainerFilter
          containers={containers}
          hidden={hidden}
          setHidden={setHidden}
          nameOf={(ctr) => nameOf.get(ctr.id) ?? ""}
          colorOf={(ctr) => svcColor(ctr.composeService ?? "")}
        />
        <button
          type="button"
          className={`g-chip${events ? "" : " off"}`}
          onClick={() => setEvents((prev) => !prev)}
          aria-pressed={events}
        >
          Lifecycle events
        </button>
        <span className="spacer" />
        <Segmented
          value={view}
          onChange={(value) => setView(String(value))}
          options={[
            { label: "Merged", value: "merged" },
            { label: "Side by side", value: "split" },
          ]}
        />
      </div>

      <div ref={paneRef}>
        {view === "merged" ? (
          <div className="g-log" data-pane="1">
            {rows.length ? rows.map((item) => line(item, true)) : empty}
          </div>
        ) : shownKeys.length === 0 ? (
          <div className="g-log">{empty}</div>
        ) : (
          <div className="g-split">
            {shownKeys.map((ctr) => {
              const mine = rows.filter((item) => item.id === ctr.id);
              const color = svcColor(ctr.composeService ?? "");
              return (
                <div key={ctr.id} className="g-col">
                  <div className="g-col-h" style={{ borderTop: `2px solid ${color}` }}>
                    <StateDot state={states.get(ctr.id) ?? ctr.state} size={6} />
                    <span style={{ color: "var(--paper)" }}>{nameOf.get(ctr.id)}</span>
                    <span className="mono dim">{ctr.composeService}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono dim">{mine.length}</span>
                  </div>
                  <div className="g-log" data-pane="1">
                    {mine.length ? (
                      mine.map((item) => line(item, false))
                    ) : (
                      <span className="dim" style={{ padding: "0 12px" }}>
                        No matching lines.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          {rows.length} lines from {shownKeys.length} of {containers.length} containers
          {timestamps ? ` · times in ${LOCAL_TZ}` : ""}
        </span>
        <span className="spacer" />
        {anchor ? (
          <span style={{ fontSize: 12, color: "var(--teal)" }}>
            Highlighting ±2s around {format(new Date(anchor), "HH:mm:ss.SSS")}
            <button
              type="button"
              className="link-btn"
              style={{ marginLeft: 8 }}
              onClick={() => setAnchor(null)}
            >
              clear
            </button>
          </span>
        ) : (
          <span className="dim" style={{ fontSize: 12 }}>
            Tip: click a timestamp to line up what every container did at that moment.
          </span>
        )}
      </div>

      {containers.length === 0 ? <Empty description="No containers in this project" /> : null}
    </div>
  );
}
