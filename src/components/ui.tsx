import type { ReactNode } from "react";
import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";

export const STATE_COLORS: Record<string, string> = {
  running: "var(--green)",
  exited: "var(--coral)",
  paused: "var(--amber)",
  created: "var(--fog)",
  dead: "var(--coral)",
  restarting: "var(--amber)",
};

export function StateDot({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? "var(--fog)";
  const label = state ? state.charAt(0).toUpperCase() + state.slice(1) : "Unknown";
  return (
    <Tooltip title={label}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mist)" }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color, boxShadow: `0 0 0 3px ${color}22` }} />
      {label}
    </span>
  );
}

const PILL_TONES: Record<string, [string, string]> = {
  green: ["rgba(39,166,68,.13)", "var(--green)"],
  coral: ["rgba(235,87,87,.12)", "var(--coral)"],
  violet: ["rgba(99,102,241,.16)", "#8b93ff"],
  lav: ["rgba(139,92,246,.16)", "#b79bff"],
  teal: ["rgba(2,184,204,.13)", "var(--teal)"],
  neutral: ["rgba(255,255,255,.05)", "var(--fog)"],
};

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof PILL_TONES | string }) {
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

export function MetricCard({ label, value, suffix }: { label: string; value: ReactNode; suffix?: ReactNode }) {
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
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="4.5" width="16" height="4" rx="1.4" fill="#e4f222" />
      <rect x="1" y="9.5" width="16" height="4" rx="1.4" fill="#62666d" />
    </svg>
  );
}
