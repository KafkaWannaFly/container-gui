import { CopyOutlined, MoreOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, type MenuProps, Tooltip } from "antd";
import { type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";
import whale from "../assets/whale.png";

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
  const onRow = (row: T): HTMLAttributes<HTMLElement> => ({
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      if (!flattenMenu(groupsOf(row)).length) return;
      event.preventDefault();
      setTarget({ row, x: event.clientX, y: event.clientY });
    },
  });
  const contextMenu = target ? (
    <Dropdown
      open
      trigger={["contextMenu"]}
      menu={{ items: flattenMenu(groupsOf(target.row)), onClick: () => setTarget(null) }}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
    >
      <span style={{ position: "fixed", left: target.x, top: target.y, width: 1, height: 1 }} />
    </Dropdown>
  ) : null;
  return { onRow, contextMenu };
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
