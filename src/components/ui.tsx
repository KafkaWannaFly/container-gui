import { useHotkey } from "@tanstack/react-hotkeys";
import { useSize } from "ahooks";
import { App, Button, Dropdown, Input, type MenuProps, Tooltip } from "antd";
import {
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import whale from "../assets/whale.png";
import { useSearchHotkey } from "../hooks/useSearchHotkey";
import { CopyOutlined, MoreOutlined } from "./icons";

export const STATE_COLORS: Record<string, string> = {
  running: "var(--green)",
  exited: "var(--coral)",
  paused: "var(--amber)",
  created: "var(--fog)",
  dead: "var(--coral)",
  restarting: "var(--amber)",
};

export function StateDot({
  state,
  size = 10,
  color: colorOverride,
  label: labelOverride,
}: {
  state: string;
  size?: number;
  color?: string;
  label?: string;
}) {
  const color = colorOverride ?? STATE_COLORS[state] ?? "var(--fog)";
  const label = labelOverride ?? (state ? state.charAt(0).toUpperCase() + state.slice(1) : "Unknown");
  return (
    <Tooltip title={label}>
      <span
        style={{
          display: "inline-block",
          width: size,
          height: size,
          flex: "0 0 auto",
          borderRadius: 99,
          background: color,
          boxShadow: `0 0 0 3px ${color}22`,
        }}
      />
    </Tooltip>
  );
}

export function StateTag({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? "var(--fog)";
  const label = state ? state.charAt(0).toUpperCase() + state.slice(1) : "Unknown";
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mist)" }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: color,
          boxShadow: `0 0 0 3px ${color}22`,
        }}
      />
      {label}
    </span>
  );
}

const PILL_TONES: Record<string, [string, string]> = {
  green: ["color-mix(in srgb, var(--green) 14%, transparent)", "var(--green)"],
  coral: ["color-mix(in srgb, var(--coral) 14%, transparent)", "var(--coral)"],
  amber: ["color-mix(in srgb, var(--amber) 15%, transparent)", "var(--amber)"],
  violet: ["color-mix(in srgb, var(--violet) 16%, transparent)", "var(--violet)"],
  lav: ["color-mix(in srgb, var(--lav) 16%, transparent)", "var(--lav)"],
  teal: ["color-mix(in srgb, var(--teal) 14%, transparent)", "var(--teal)"],
  neutral: ["color-mix(in srgb, var(--paper) 6%, transparent)", "var(--fog)"],
};

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof PILL_TONES | string;
}) {
  const [bg, fg] = PILL_TONES[tone] ?? PILL_TONES.neutral;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 6px",
        borderRadius: 4,
        fontSize: 12,
        lineHeight: "18px",
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

export function CopyButton({ text, what }: { text: string; what: string }) {
  const { message } = App.useApp();
  return (
    <Tooltip title={`Copy ${what.toLowerCase()}`}>
      <Button
        type="text"
        size="small"
        aria-label={`Copy ${what.toLowerCase()}`}
        icon={<CopyOutlined />}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => message.success(`${what} copied`),
            () => message.error("Clipboard unavailable"),
          )
        }
      />
    </Tooltip>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

export function ShortcutBadge({ children = "Ctrl + F" }: { children?: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchPattern(
  query: string,
  options: SearchOptions,
): { testRe: RegExp | null; highlightRe: RegExp | null; error: string | null } {
  if (!query) return { testRe: null, highlightRe: null, error: null };
  const base = options.regex ? query : escapeRegExp(query);
  const source = options.wholeWord ? `(?<![a-zA-Z0-9_])(?:${base})(?![a-zA-Z0-9_])` : base;
  const flags = options.caseSensitive ? "" : "i";
  try {
    return {
      testRe: new RegExp(source, flags),
      highlightRe: new RegExp(source, `${flags}g`),
      error: null,
    };
  } catch (err) {
    return {
      testRe: null,
      highlightRe: null,
      error: err instanceof Error ? err.message : "Invalid regular expression",
    };
  }
}

export function useSearch(initialQuery = "") {
  const [query, setQuery] = useState(initialQuery);
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);

  return useMemo(() => {
    const { testRe, highlightRe, error } = buildSearchPattern(query, options);
    const active = query.length > 0;
    const match = (text: string): boolean => {
      if (!active) return true;
      if (!testRe) return false;
      return testRe.test(text);
    };
    const matchAny = (...texts: string[]): boolean => {
      if (!active) return true;
      if (!testRe) return false;
      return texts.some((t) => testRe.test(t));
    };
    const highlight = (text: string): ReactNode => {
      if (!active || !highlightRe || !text) return text;
      highlightRe.lastIndex = 0;
      const out: ReactNode[] = [];
      let lastIndex = 0;
      for (let m = highlightRe.exec(text); m !== null; m = highlightRe.exec(text)) {
        const start = m.index;
        const end = start + m[0].length;
        if (end === start) {
          if (highlightRe.lastIndex === start) highlightRe.lastIndex = start + 1;
          if (highlightRe.lastIndex > text.length) break;
          continue;
        }
        if (start > lastIndex) out.push(text.slice(lastIndex, start));
        out.push(
          <span key={start} className="hl">
            {m[0]}
          </span>,
        );
        lastIndex = end;
      }
      if (out.length === 0) return text;
      if (lastIndex < text.length) out.push(text.slice(lastIndex));
      return out;
    };

    return {
      query,
      setQuery,
      options,
      setOptions,
      active,
      invalidRegex: error,
      match,
      matchAny,
      highlight,
      inputProps: {
        value: query,
        onChange: setQuery,
        options,
        onOptionsChange: setOptions,
        invalidRegex: error,
      },
    };
  }, [query, options]);
}

export function SearchInput({
  value,
  onChange,
  options,
  onOptionsChange,
  invalidRegex,
  placeholder,
  size,
  prefix,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOptions;
  onOptionsChange: (options: SearchOptions) => void;
  invalidRegex?: string | null;
  placeholder?: string;
  size?: "small" | "middle" | "large";
  prefix?: ReactNode;
  style?: CSSProperties;
}) {
  const searchRef = useSearchHotkey();
  const [focused, setFocused] = useState(false);
  const toggle = (key: keyof SearchOptions) => onOptionsChange({ ...options, [key]: !options[key] });
  const hotkeyOpts = { ignoreInputs: false, requireReset: true, conflictBehavior: "allow" as const };
  useHotkey(
    "Alt+C",
    () => {
      if (document.activeElement?.closest(".xterm")) return;
      toggle("caseSensitive");
    },
    hotkeyOpts,
  );
  useHotkey(
    "Alt+W",
    () => {
      if (document.activeElement?.closest(".xterm")) return;
      toggle("wholeWord");
    },
    hotkeyOpts,
  );
  useHotkey(
    "Alt+R",
    () => {
      if (document.activeElement?.closest(".xterm")) return;
      toggle("regex");
    },
    hotkeyOpts,
  );

  return (
    <Input
      ref={searchRef}
      size={size}
      placeholder={placeholder}
      allowClear
      status={invalidRegex ? "error" : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      prefix={prefix}
      style={style}
      suffix={
        <span className="search-suffix">
          {!focused ? <ShortcutBadge /> : null}
          <span className="search-toggles">
            <Tooltip title="Match Case (Alt+C)">
              <button
                type="button"
                className={`search-toggle${options.caseSensitive ? " on" : ""}`}
                aria-label="Match Case (Alt+C)"
                aria-pressed={options.caseSensitive}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle("caseSensitive")}
              >
                Aa
              </button>
            </Tooltip>
            <Tooltip title="Match Whole Word (Alt+W)">
              <button
                type="button"
                className={`search-toggle${options.wholeWord ? " on" : ""}`}
                aria-label="Match Whole Word (Alt+W)"
                aria-pressed={options.wholeWord}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle("wholeWord")}
              >
                <span className="search-whole-word">ab</span>
              </button>
            </Tooltip>
            <Tooltip
              title={
                invalidRegex ? `Invalid regex: ${invalidRegex} (Alt+R)` : "Use Regular Expression (Alt+R)"
              }
            >
              <button
                type="button"
                className={`search-toggle${options.regex ? " on" : ""}`}
                aria-label="Use Regular Expression (Alt+R)"
                aria-pressed={options.regex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle("regex")}
              >
                .*
              </button>
            </Tooltip>
          </span>
        </span>
      }
    />
  );
}

/** Flatten menu groups into one list, with dividers between non-empty groups. */
function flattenMenu(groups: MenuProps["items"][]): NonNullable<MenuProps["items"]> {
  return groups.flatMap((group, i) => [
    ...(i > 0 && group?.length ? [{ type: "divider" as const }] : []),
    ...(group ?? []),
  ]);
}

/** 3-dot row action menu; `groups` renders dividers between arrays. */
export function RowActions({ groups }: { groups: MenuProps["items"][] }) {
  return (
    <Dropdown menu={{ items: flattenMenu(groups) }} trigger={["click"]} placement="bottomRight">
      <Button type="text" size="small" aria-label="Actions" icon={<MoreOutlined />} />
    </Dropdown>
  );
}

/** Right-click menu for table rows, showing the same items as `RowActions`. */
export function useRowContextMenu<T>(groupsOf: (row: T) => MenuProps["items"][]) {
  const [target, setTarget] = useState<{ row: T; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!target) return;
    const close = () => setTarget(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [target]);
  const onRow = (row: T): HTMLAttributes<HTMLElement> => ({
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      if (!flattenMenu(groupsOf(row)).length) return;
      event.preventDefault();
      setTarget({ row, x: event.clientX, y: event.clientY });
    },
  });
  const contextMenu = target
    ? createPortal(
        <Dropdown
          key={`${target.x}:${target.y}`}
          open
          trigger={["contextMenu"]}
          menu={{ items: flattenMenu(groupsOf(target.row)), onClick: () => setTarget(null) }}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        >
          <span
            style={{
              position: "fixed",
              left: target.x,
              top: target.y,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </Dropdown>,
        document.body,
      )
    : null;
  return { onRow, contextMenu };
}

const DEFAULT_MIN_CHARS = 15;
const DEFAULT_CHAR_WIDTH_PX = 7.5;

/**
 * Measures a table column header's live width via `ahooks`'s `useSize` and
 * converts it into a character threshold for `middleEllipsis`.
 */
export function useColumnMaxChars(minChars = DEFAULT_MIN_CHARS) {
  const ref = useRef<HTMLSpanElement>(null);
  const size = useSize(() => ref.current?.closest("th") ?? ref.current);
  const colWidth = size?.width ?? 0;

  const title = useCallback((label: ReactNode) => <span ref={ref}>{label}</span>, []);

  const maxChars = useCallback(
    (reservedPx = 36, charWidthPx = DEFAULT_CHAR_WIDTH_PX) => {
      if (colWidth <= 0) return minChars;
      return Math.max(minChars, Math.floor((colWidth - reservedPx) / charWidthPx));
    },
    [colWidth, minChars],
  );

  return { title, colWidth, maxChars };
}

export function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
}) {
  return (
    <div className="card metric">
      <div className="k">{label}</div>
      <div className="v">
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </div>
  );
}

export function Glyph() {
  return <img src={whale} height={18} alt="" aria-hidden="true" style={{ display: "block" }} />;
}
