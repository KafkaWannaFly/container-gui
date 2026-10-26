import {
  ClearOutlined,
  DownOutlined,
  EyeOutlined,
  SearchOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Empty, type MenuProps, Segmented, Select, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { SearchInput, StateDot, useSearch } from "../../../components/ui";
import { useTauriEvent } from "../../../hooks/useDockerEvents";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { streamContainerLogs } from "../../../services/tauriApi";
import { type ContainerSummary, DockerEventSchema, middleEllipsis } from "../../../types/docker";
import {
  formatTimestamp,
  resolveZone,
  type Stamps,
  stampsLabelOf,
  TZ_PREFIX,
  zoneCities,
  zoneOffset,
} from "../detail/logParse";
import { zoneItems } from "../detail/LogsTab";
import { ContainerFilter } from "./components";
import { svcColor } from "./model";

type Level = "debug" | "info" | "warn" | "error" | "event";
type GLine = { seq: number; id: string; ts: string; level: Level; text: string };

const MAX_LINES = 4000;

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
  const search = useSearch();
  const [level, setLevel] = useState("all");
  const [events, setEvents] = useState(true);
  const [view, setView] = useState("merged");
  const [follow, setFollow] = useState(true);
  const [stamps, setStamps] = usePersistentState<Stamps>("logs.timestamps", z.string(), "local");
  const [wrap, setWrap] = usePersistentState("logs.wrap", z.boolean(), true);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [tail, setTail] = useState("500");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(
    solo ? containers.filter((c) => c.id !== solo).map((c) => c.id) : [],
  );
  const [lines, setLines] = useState<GLine[]>([]);
  const [pinned, setPinned] = useState<GLine[]>([]);
  const [cleared, setCleared] = useState(0);

  const seqRef = useRef(0);
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

  useTauriEvent("docker://event", DockerEventSchema, (event) => {
    if (event.resourceType !== "container" || !nameOf.has(event.actorId)) return;
    const name = nameOf.get(event.actorId) ?? event.actorId.slice(0, 12);
    setPinned((prev) => [
      ...prev.slice(-39),
      {
        seq: seqRef.current++,
        id: event.actorId,
        ts: new Date(event.time * 1000).toISOString(),
        level: "event",
        text: `${name}: ${event.action}`,
      },
    ]);
  });

  const shownKeys = containers.filter((ctr) => !hidden.includes(ctr.id));
  const shownSet = useMemo(() => new Set(shownKeys.map((ctr) => ctr.id)), [shownKeys]);

  const allLines = useMemo(() => [...lines, ...pinned], [lines, pinned]);

  const rows = useMemo(
    () =>
      allLines
        .filter(
          (line) =>
            shownSet.has(line.id) &&
            (line.level === "event" ? events : level === "all" || line.level === level) &&
            search.match(line.text),
        )
        .slice(cleared),
    [allLines, shownSet, events, level, search, cleared],
  );

  const infoCount = allLines.filter((line) => line.level === "info" && shownSet.has(line.id)).length;
  const errCount = allLines.filter((line) => line.level === "error" && shownSet.has(line.id)).length;
  const warnCount = allLines.filter((line) => line.level === "warn" && shownSet.has(line.id)).length;

  function near(ts: string): boolean {
    return Boolean(anchor && ts && Math.abs(new Date(ts).getTime() - new Date(anchor).getTime()) <= 2000);
  }

  // Follow sticks to the bottom of every pane.
  useEffect(() => {
    if (!follow || !paneRef.current) return;
    for (const pane of paneRef.current.querySelectorAll("[data-pane]")) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [rows, follow, view]);

  const onPaneScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
    setFollow(atBottom);
  };

  const only = (id: string) => setHidden(containers.filter((ctr) => ctr.id !== id).map((ctr) => ctr.id));

  const zone = useMemo(() => resolveZone(stamps), [stamps]);
  const zones = useMemo(() => (displayOpen ? zoneItems(stamps) : []), [displayOpen, stamps]);
  const stampsLabel = stampsLabelOf(stamps, zone);
  const onDisplayClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "wrap") setWrap((on) => !on);
    else if (key.startsWith(TZ_PREFIX)) {
      setStamps(key.slice(TZ_PREFIX.length));
      setDisplayOpen(false);
    }
  };

  const line = (item: GLine, withTag: boolean) => {
    const color = svcColor(containers.find((ctr) => ctr.id === item.id)?.composeService ?? "");
    const cls = `g-row g-${item.level}${anchor === item.ts ? " g-anchor" : near(item.ts) ? " g-near" : ""}`;
    return (
      <div key={item.seq} className={cls}>
        {zone ? (
          <button
            type="button"
            className="g-ts"
            title={`${item.ts} (UTC) — click to highlight everything within ±2s across containers`}
            onClick={() => setAnchor((prev) => (prev === item.ts ? null : item.ts))}
          >
            {item.ts ? formatTimestamp(item.ts, zone) : "--:--:--.---"}
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
        <span className="msg">{search.highlight(item.text)}</span>
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
        <SearchInput
          {...search.inputProps}
          placeholder="Search all containers"
          prefix={<SearchOutlined style={{ color: "var(--smoke)" }} />}
          style={{ width: 310 }}
        />
        <Select
          value={level}
          onChange={setLevel}
          style={{ width: 136 }}
          options={[
            { value: "all", label: "All levels" },
            { value: "info", label: `Info (${infoCount})` },
            { value: "warn", label: `Warn (${warnCount})` },
            { value: "error", label: `Error (${errCount})` },
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
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          open={displayOpen}
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
            ],
          }}
        >
          <Button icon={<EyeOutlined />}>
            Display <DownOutlined style={{ fontSize: 12 }} />
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
            onClick={() => setFollow((prev) => !prev)}
          >
            Follow
          </Button>
        </Tooltip>
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
          <div className={`g-log${wrap ? "" : " nowrap"}`} data-pane="1" onScroll={onPaneScroll}>
            {rows.length ? rows.map((item) => line(item, true)) : empty}
          </div>
        ) : shownKeys.length === 0 ? (
          <div className={`g-log${wrap ? "" : " nowrap"}`}>{empty}</div>
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
                  <div className={`g-log${wrap ? "" : " nowrap"}`} data-pane="1" onScroll={onPaneScroll}>
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
          {zone ? ` · times in UTC${zoneOffset(zone)}${zoneCities(stamps, zone)}` : ""}
        </span>
        <span className="spacer" />
        {anchor ? (
          <span style={{ fontSize: 12, color: "var(--teal)" }}>
            Highlighting ±2s around {formatTimestamp(anchor, zone ?? "UTC")}
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
