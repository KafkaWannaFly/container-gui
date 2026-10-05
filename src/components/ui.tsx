import { CopyOutlined, MoreOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, type MenuProps, Tooltip } from "antd";
import type { ReactNode } from "react";
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
  green: ["rgba(39,166,68,.13)", "var(--green)"],
  coral: ["rgba(235,87,87,.12)", "var(--coral)"],
  amber: ["rgba(217,164,65,.14)", "var(--amber)"],
  violet: ["rgba(99,102,241,.16)", "#8b93ff"],
  lav: ["rgba(139,92,246,.16)", "#b79bff"],
  teal: ["rgba(2,184,204,.13)", "var(--teal)"],
  neutral: ["rgba(255,255,255,.05)", "var(--fog)"],
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

/** 3-dot row action menu; `groups` renders dividers between arrays. */
export function RowActions({ groups }: { groups: MenuProps["items"][] }) {
  const items: MenuProps["items"] = groups.flatMap((group, i) => [
    ...(i > 0 ? [{ type: "divider" as const }] : []),
    ...(group ?? []),
  ]);
  return (
    <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
      <Button type="text" size="small" aria-label="Actions" icon={<MoreOutlined />} />
    </Dropdown>
  );
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
