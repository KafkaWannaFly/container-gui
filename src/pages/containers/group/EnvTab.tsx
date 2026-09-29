import {
  CopyOutlined,
  ExportOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Input, Segmented, Table, Tooltip } from "antd";
import { useCallback, useMemo, useState } from "react";
import { Pill, StateDot } from "../../../components/ui";
import type { ContainerInspect, ContainerSummary, ImageInspect } from "../../../types/docker";
import { type EnvRow, envRows } from "../detail/model";
import { Section, useSections } from "./components";
import { svcColor } from "./model";

const MASK = "••••••••••••••••";

type Row = EnvRow & { id: number };

const SOURCE_TONE = { compose: "teal", runtime: "lav", image: "neutral" } as const;

function toDotenv(rows: EnvRow[]): string {
  return rows
    .map((row) => `${row.key}=${/[\s"']/.test(row.value) ? JSON.stringify(row.value) : row.value}`)
    .join("\n");
}

export default function EnvTab({
  containers,
  inspectById,
  imageById,
  states,
  onOpenContainer,
}: {
  containers: ContainerSummary[];
  inspectById: Map<string, ContainerInspect>;
  imageById: Map<string, ImageInspect>;
  states: Map<string, string>;
  onOpenContainer: (id: string, tab: string) => void;
}) {
  const { message } = App.useApp();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [mode, setMode] = useState("list");
  const [reveal, setReveal] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(true);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const ctr of containers) map.set(ctr.id, (ctr.names[0] ?? ctr.id.slice(0, 12)).replace(/^\//, ""));
    return map;
  }, [containers]);

  const rowsById = useMemo(() => {
    const map = new Map<string, EnvRow[]>();
    for (const ctr of containers) {
      const inspect = inspectById.get(ctr.id);
      if (!inspect) continue;
      map.set(ctr.id, envRows(inspect, inspect.Image ? imageById.get(inspect.Image) : undefined));
    }
    return map;
  }, [containers, inspectById, imageById]);

  const { closed, onToggle, button } = useSections(containers.map((ctr) => ctr.id));

  const q = query.toLowerCase();
  const match = useCallback(
    (row: EnvRow) =>
      (source === "all" || row.source === source) &&
      (!q || row.key.toLowerCase().includes(q) || row.value.toLowerCase().includes(q)),
    [source, q],
  );
  const shown = (row: EnvRow) => (row.secret && !reveal ? MASK : row.value);

  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => message.success(`${what} copied`),
      () => message.error("Clipboard unavailable"),
    );

  const listColumns = [
    {
      title: "Variable",
      dataIndex: "key",
      width: 240,
      render: (value: string) => (
        <span className="mono" style={{ color: "var(--paper)" }}>
          {value}
        </span>
      ),
    },
    {
      title: "Value",
      key: "value",
      render: (_: unknown, row: Row) => (
        <span
          className={`mono env-val${row.secret && !reveal ? " dim" : ""}`}
          title={row.secret && !reveal ? "" : row.value}
        >
          {shown(row)}
        </span>
      ),
    },
    {
      title: "Source",
      dataIndex: "source",
      width: 100,
      render: (value: string) => (
        <Pill tone={SOURCE_TONE[value as keyof typeof SOURCE_TONE] ?? "neutral"}>{value}</Pill>
      ),
    },
    {
      title: "",
      key: "copy",
      width: 46,
      align: "right" as const,
      render: (_: unknown, row: Row) => (
        <Tooltip title="Copy KEY=value">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => copy(`${row.key}=${row.value}`, row.key)}
          />
        </Tooltip>
      ),
    },
  ];

  const matrix = useMemo(() => {
    const keys = [
      ...new Set(
        containers
          .flatMap((ctr) => rowsById.get(ctr.id) ?? [])
          .filter(match)
          .map((row) => row.key),
      ),
    ];
    return keys
      .map((key) => {
        const cells = Object.fromEntries(
          containers.map((ctr) => [ctr.id, (rowsById.get(ctr.id) ?? []).find((row) => row.key === key)]),
        ) as Record<string, EnvRow | undefined>;
        const values = Object.values(cells)
          .filter(Boolean)
          .map((row) => (row as EnvRow).value);
        const freq: Record<string, number> = {};
        for (const value of values) freq[value] = (freq[value] ?? 0) + 1;
        const common = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] ?? "";
        return { key, cells, present: values.length, differs: Object.keys(freq).length > 1, common };
      })
      .filter((row) => row.present > 1 && (!onlyDiff || row.differs) && row.key !== "HOSTNAME");
  }, [containers, rowsById, match, onlyDiff]);

  const matrixColumns = [
    {
      title: "Variable",
      dataIndex: "key",
      width: 190,
      fixed: "left" as const,
      render: (value: string, row: { differs: boolean }) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="mono" style={{ color: "var(--paper)" }}>
            {value}
          </span>
          {row.differs ? <Pill tone="amber">differs</Pill> : null}
        </span>
      ),
    },
    ...containers.map((ctr) => ({
      title: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ width: 3, height: 10, borderRadius: 2, background: svcColor(ctr.composeService ?? "") }}
          />
          {nameOf.get(ctr.id)}
        </span>
      ),
      key: ctr.id,
      width: 190,
      render: (
        _: unknown,
        row: { cells: Record<string, EnvRow | undefined>; differs: boolean; common: string },
      ) => {
        const cell = row.cells[ctr.id];
        if (!cell) return <span className="dim">—</span>;
        const odd = row.differs && cell.value !== row.common;
        return (
          <span
            className={`mono mx-val${odd ? " mx-odd" : ""}${cell.secret && !reveal ? " dim" : ""}`}
            title={cell.secret && !reveal ? "" : cell.value}
          >
            {shown(cell)}
          </span>
        );
      },
    })),
  ];

  const visible = containers
    .map((ctr) => ({ ctr, rows: rowsById.get(ctr.id) ?? [] }))
    .filter(({ rows }) => !q || rows.filter(match).length > 0);

  return (
    <div className="tab-stack">
      <div className="toolbar">
        <Input
          placeholder="Filter across all containers"
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          prefix={<SearchOutlined style={{ color: "var(--smoke)" }} />}
          style={{ width: 260 }}
        />
        <Segmented
          value={source}
          onChange={(value) => setSource(String(value))}
          options={[
            { label: "All", value: "all" },
            { label: "Compose", value: "compose" },
            { label: "Image", value: "image" },
            { label: "Runtime", value: "runtime" },
          ]}
        />
        <Segmented
          value={mode}
          onChange={(value) => setMode(String(value))}
          options={[
            { label: "By container", value: "list" },
            { label: "Compare", value: "matrix" },
          ]}
        />
        <span className="spacer" />
        <Button
          icon={reveal ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => setReveal((value) => !value)}
        >
          {reveal ? "Hide secrets" : "Reveal secrets"}
        </Button>
        {mode === "list" ? button : null}
      </div>

      {mode === "list" ? (
        <>
          {visible.map(({ ctr, rows }) => {
            const filtered = rows.filter(match);
            return (
              <Section
                key={ctr.id}
                id={ctr.id}
                closed={closed}
                onToggle={onToggle}
                title={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 3,
                        height: 12,
                        borderRadius: 2,
                        background: svcColor(ctr.composeService ?? ""),
                      }}
                    />
                    {nameOf.get(ctr.id)}
                  </span>
                }
                extra={
                  <span style={{ display: "inline-flex", alignItems: "center", flex: 1, gap: 8 }}>
                    <StateDot state={states.get(ctr.id) ?? ctr.state} size={6} />
                    <span className="dim" style={{ fontSize: 12 }}>
                      {filtered.length}
                      {filtered.length !== rows.length ? ` of ${rows.length}` : ""} vars
                    </span>
                    <span style={{ flex: 1 }} />
                    <Tooltip title="Copy these rows as .env">
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                          copy(toDotenv(filtered), `${nameOf.get(ctr.id)} env`);
                        }}
                      >
                        .env
                      </Button>
                    </Tooltip>
                    <Button
                      size="small"
                      type="text"
                      icon={<ExportOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenContainer(ctr.id, "env");
                      }}
                    >
                      Open
                    </Button>
                  </span>
                }
              >
                <Table<Row>
                  size="small"
                  rowKey="id"
                  columns={listColumns}
                  dataSource={filtered.map((row, index) => ({ ...row, id: index }))}
                  pagination={false}
                  locale={{ emptyText: <Empty description="No matching variables" /> }}
                />
              </Section>
            );
          })}
          {containers.length - visible.length > 0 ? (
            <div className="dim" style={{ fontSize: 12 }}>
              {containers.length - visible.length} container(s) hidden — no matching variables.
            </div>
          ) : null}
        </>
      ) : (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <label className="switch-label">
              <input type="checkbox" checked={onlyDiff} onChange={() => setOnlyDiff((value) => !value)} />
              <span className="dim" style={{ fontSize: 12 }}>
                Only variables that differ
              </span>
            </label>
            <span className="spacer" />
            <span className="dim" style={{ fontSize: 12 }}>
              Variables set in 2+ containers · amber = differs from the most common value · HOSTNAME skipped
            </span>
          </div>
          <Table
            size="small"
            pagination={false}
            columns={matrixColumns}
            dataSource={matrix}
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    onlyDiff ? "No differences — shared variables agree everywhere" : "No shared variables"
                  }
                />
              ),
            }}
          />
        </div>
      )}

      <div className="dim" style={{ fontSize: 12 }}>
        Values are read-only — change them in compose.yaml and recreate the service.
      </div>
    </div>
  );
}
