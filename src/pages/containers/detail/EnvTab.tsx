import {
  CheckOutlined,
  CodeOutlined,
  CopyOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileTextOutlined,
  SearchOutlined,
  SettingOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Empty, Input, Segmented, Table, Tooltip } from "antd";
import { type ComponentType, useMemo, useState } from "react";
import { Pill } from "../../../components/ui";
import { type EnvRow, envRows, type TabProps } from "./model";

const MASK = "••••••••••••••••";

type ViewKey = "table" | "json" | "yaml" | "env";
const VIEWS: { key: ViewKey; label: string; icon: ComponentType<{ style?: React.CSSProperties }> }[] = [
  { key: "table", label: "Table", icon: TableOutlined },
  { key: "json", label: "JSON", icon: CodeOutlined },
  { key: "yaml", label: "YAML", icon: FileTextOutlined },
  { key: "env", label: ".env", icon: SettingOutlined },
];

const SOURCE_TONE = { compose: "teal", runtime: "lav", image: "neutral" } as const;

/** Serialize rows into one of the text formats, one entry per line. */
function serialize(kind: Exclude<ViewKey, "table">, rows: EnvRow[], valueFor: (row: EnvRow) => string) {
  if (kind === "json") {
    return [
      "{",
      ...rows.map(
        (r, i) =>
          `  ${JSON.stringify(r.key)}: ${JSON.stringify(valueFor(r))}${i < rows.length - 1 ? "," : ""}`,
      ),
      "}",
    ];
  }
  if (kind === "yaml") {
    const risky = (s: string) => s === "" || /[\s#:'"{}[\],&*?|<>=!%@`]/.test(s);
    return rows.map((r) => {
      const v = valueFor(r);
      return `${r.key}: ${risky(v) ? JSON.stringify(v) : v}`;
    });
  }
  return rows.map((r) => {
    const v = valueFor(r);
    return `${r.key}=${/[\s"'#$]/.test(v) ? JSON.stringify(v) : v}`;
  });
}

/** Split a serialized line into key / separator / value for tinting. */
function Tinted({ kind, line }: { kind: ViewKey; line: string }) {
  const sep = kind === "env" ? "=" : ":";
  const at = line.indexOf(sep);
  if (at < 0 || (kind === "json" && !line.startsWith("  "))) return <div className="cv-s">{line}</div>;
  return (
    <div>
      <span className="cv-k">{line.slice(0, at)}</span>
      <span className="cv-s">{sep}</span>
      <span>{line.slice(at + 1)}</span>
    </div>
  );
}

export default function EnvTab({ ctr, image, onCopy }: TabProps) {
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("all");
  const [revealed, setRevealed] = useState<string[]>([]);
  const [view, setView] = useState<ViewKey>("table");

  const all = useMemo(() => envRows(ctr, image), [ctr, image]);
  const needle = q.toLowerCase();
  const rows = all.filter(
    (e) =>
      (src === "all" || e.source === src) &&
      (e.key.toLowerCase().includes(needle) || e.value.toLowerCase().includes(needle)),
  );
  const secrets = all.filter((e) => e.secret).map((e) => e.key);

  const toggle = (key: string) =>
    setRevealed((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  // Display honours the reveal toggles; copy always yields the real values.
  const shown = (r: EnvRow) => (r.secret && !revealed.includes(r.key) ? MASK : r.value);
  const real = (r: EnvRow) => r.value;

  const viewItems = VIEWS.map((v) => ({
    key: v.key,
    label: (
      <div className="view-item">
        <v.icon style={{ color: view === v.key ? "var(--lime)" : "var(--ash)", fontSize: 13 }} />
        <span className="nm">{v.label}</span>
        {view === v.key ? (
          <CheckOutlined style={{ color: "var(--lime)", fontSize: 11 }} />
        ) : (
          <span style={{ width: 11 }} />
        )}
        <Tooltip title={`Copy as ${v.label}`} placement="right">
          <Button
            type="text"
            size="small"
            aria-label={`Copy as ${v.label}`}
            icon={<CopyOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              const text =
                v.key === "table"
                  ? rows.map((r) => `${r.key}\t${real(r)}\t${r.source}`).join("\n")
                  : serialize(v.key, rows, real).join("\n");
              onCopy(text, `${rows.length} variables as ${v.label}`);
            }}
          />
        </Tooltip>
      </div>
    ),
    onClick: () => setView(v.key),
  }));

  const empty = <Empty description={all.length ? "No matching variables" : "No environment variables"} />;

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <Input
          placeholder="Filter variables"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          prefix={<SearchOutlined style={{ color: "var(--ash)" }} />}
          style={{ width: 260 }}
        />
        <Segmented
          value={src}
          onChange={(value) => setSrc(String(value))}
          options={[
            { label: "All", value: "all" },
            { label: "Compose", value: "compose" },
            { label: "Image", value: "image" },
            { label: "Runtime", value: "runtime" },
          ]}
        />
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          {rows.length} of {all.length}
        </span>
        <Button
          icon={revealed.length ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          disabled={!secrets.length}
          onClick={() => setRevealed((r) => (r.length ? [] : secrets))}
        >
          {revealed.length ? "Hide secrets" : "Reveal secrets"}
        </Button>
        <Dropdown menu={{ items: viewItems }} trigger={["click"]} placement="bottomRight">
          <Button>
            View as: {VIEWS.find((v) => v.key === view)?.label} <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>
      </div>

      {view === "table" ? (
        <Table<EnvRow>
          size="small"
          rowKey="key"
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: empty }}
          columns={[
            {
              title: "Variable",
              dataIndex: "key",
              width: 260,
              render: (v: string) => (
                <span className="mono" style={{ color: "var(--paper)" }}>
                  {v}
                </span>
              ),
            },
            {
              title: "Value",
              dataIndex: "value",
              render: (v: string, r) => {
                const hidden = r.secret && !revealed.includes(r.key);
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className={`mono env-val${hidden ? " dim" : ""}`} title={hidden ? "" : v}>
                      {hidden ? MASK : v}
                    </span>
                    {r.secret ? (
                      <Button
                        type="text"
                        size="small"
                        aria-label={hidden ? "Reveal value" : "Hide value"}
                        onClick={() => toggle(r.key)}
                        icon={hidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                      />
                    ) : null}
                  </span>
                );
              },
            },
            {
              title: (
                <Tooltip title="Inferred: a value equal to the image's comes from the image; anything else was set when the container was created.">
                  <span>Source</span>
                </Tooltip>
              ),
              dataIndex: "source",
              width: 110,
              render: (v: EnvRow["source"]) => <Pill tone={SOURCE_TONE[v]}>{v}</Pill>,
            },
            {
              title: "",
              key: "act",
              width: 46,
              align: "right",
              render: (_, r) => (
                <Tooltip title="Copy KEY=value">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Copy ${r.key}`}
                    icon={<CopyOutlined />}
                    onClick={() => onCopy(`${r.key}=${r.value}`, r.key)}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      ) : rows.length === 0 ? (
        empty
      ) : (
        <pre className="code-view">
          {serialize(view, rows, shown).map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and re-derived each render
            <Tinted key={i} kind={view} line={line} />
          ))}
        </pre>
      )}

      <div className="toolbar" style={{ marginTop: 12 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          Values are read-only — changing them requires recreating the container.
        </span>
        <span className="spacer" />
        {view !== "table" ? (
          <span className="dim" style={{ fontSize: 12 }}>
            Reflects the current filter{revealed.length < secrets.length ? " · secrets masked" : ""}.
          </span>
        ) : null}
      </div>
    </div>
  );
}
