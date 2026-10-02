import { CopyOutlined, DownloadOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Button, Empty, Segmented, Spin, Switch, Table, Tooltip } from "antd";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { z } from "zod";
import CodeView from "../../../components/CodeView";
import { Section, useSections } from "../../../components/Section";
import { Mono, Pill } from "../../../components/ui";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { useSaveFile } from "../../../hooks/useSaveFile";
import { saveTextToFile } from "../../../services/tauriApi";
import { formatBytes, type ImageInspect, type LayerHistoryItem } from "../../../types/docker";
import {
  baseBoundary,
  historyText,
  oldestFirst,
  reconstructDockerfile,
  toInstruction,
} from "../../containers/detail/dockerfile";

const BASE_LABEL = "org.opencontainers.image.base.name";
const View = z.enum(["dockerfile", "layers"]);
const LayersStyle = z.enum(["table", "raw"]);

const size = (n: number) => (n ? formatBytes(n) : "0 B");
const time = (unix: number) => format(new Date(unix * 1000), "yyyy-MM-dd HH:mm");

type Props = {
  /** Reference the history is read for, shown in `docker history`. */
  name: string;
  layers: LayerHistoryItem[] | undefined;
  loading: boolean;
  error?: string;
  image: ImageInspect | undefined;
  onCopy: (text: string, what: string) => void;
};

export default function BuildTab({ name, layers: history, loading, error, image, onCopy }: Props) {
  const { section } = useSections("image-detail.sections", ["build"]);
  const [view, setView] = usePersistentState("image.view", View, "dockerfile");
  const [layersStyle, setLayersStyle] = usePersistentState("image.layers", LayersStyle, "table");
  const [wrap, setWrap] = usePersistentState("image.wrap", z.boolean(), false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const save = useSaveFile();

  const layers = useMemo(() => oldestFirst(history ?? []), [history]);
  const baseName = image?.Config?.Labels?.[BASE_LABEL];
  const boundary = useMemo(() => baseBoundary(layers), [layers]);
  const dockerfile = useMemo(
    () => (layers.length ? reconstructDockerfile(name, layers, baseName) : ""),
    [name, layers, baseName],
  );
  const raw = useMemo(() => historyText(layers, size, time), [layers]);

  const text = view === "dockerfile" ? dockerfile : raw;
  const fileBase = name.replace(/[/:@]/g, "_");
  const saveName = view === "dockerfile" ? `${fileBase}.Dockerfile` : `${fileBase}-history.txt`;
  const note =
    view === "dockerfile"
      ? "Reconstructed from layer history. Images do not keep their original Dockerfile."
      : layersStyle === "table"
        ? "Oldest layer first. Expand a row to see the raw history entry."
        : "Oldest layer first, full CreatedBy text as docker history --no-trunc prints it.";
  const rowKey = (layer: LayerHistoryItem) => `${layer.id}-${layer.created}-${layer.createdBy}`;

  const columns = [
    {
      title: "#",
      key: "i",
      width: 48,
      render: (_: unknown, __: LayerHistoryItem, i: number) => <span className="mono dim">{i + 1}</span>,
    },
    {
      title: "Instruction",
      key: "by",
      ellipsis: true,
      render: (_: unknown, layer: LayerHistoryItem, i: number) => (
        <span className="ins-cell">
          {i < boundary ? <Pill>base</Pill> : null}
          <span className="mono ins-text">
            {toInstruction(layer.createdBy).text.replace(/ \\\n\s+/g, " ")}
          </span>
        </span>
      ),
    },
    {
      title: "Size",
      key: "size",
      width: 100,
      align: "right" as const,
      render: (_: unknown, layer: LayerHistoryItem) => (
        <span className={`mono${layer.size ? "" : " dim"}`}>{size(layer.size)}</span>
      ),
    },
    {
      title: "Created",
      key: "created",
      width: 150,
      render: (_: unknown, layer: LayerHistoryItem) => (
        <span className="mono dim">{time(layer.created)}</span>
      ),
    },
  ];

  return (
    <div className="tab-stack">
      <Section
        id="build"
        title="Build history"
        {...section}
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            {layers.length} layers
          </span>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <Segmented
            value={view}
            onChange={(v) => setView(v as z.infer<typeof View>)}
            options={[
              { label: "Dockerfile", value: "dockerfile" },
              { label: `Layers ${layers.length}`, value: "layers" },
            ]}
          />
          {view === "layers" ? (
            <Segmented
              size="small"
              value={layersStyle}
              onChange={(v) => setLayersStyle(v as z.infer<typeof LayersStyle>)}
              options={[
                { label: "Expandable", value: "table" },
                { label: "Raw text", value: "raw" },
              ]}
            />
          ) : null}
          <span className="dim note">
            <InfoCircleOutlined /> {note}
          </span>
          <span className="spacer" />
          {view === "dockerfile" || layersStyle === "raw" ? (
            <>
              <span className="switch-label" style={{ marginRight: 4 }}>
                <Switch size="small" checked={wrap} onChange={setWrap} />
                <span className="dim">Wrap</span>
              </span>
              <Tooltip title="Copy">
                <Button
                  aria-label="Copy"
                  icon={<CopyOutlined />}
                  disabled={!text}
                  onClick={() => onCopy(text, view === "dockerfile" ? "Dockerfile" : "Layer history")}
                />
              </Tooltip>
              <Tooltip title={`Save ${saveName}`}>
                <Button
                  aria-label="Save"
                  icon={<DownloadOutlined />}
                  disabled={!text}
                  onClick={() => void save(saveName, (dest) => saveTextToFile(dest, text))}
                />
              </Tooltip>
            </>
          ) : null}
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : !layers.length ? (
          <Empty description={error ?? "No layer history available"} />
        ) : view === "dockerfile" ? (
          <div className="df-view">
            <CodeView value={dockerfile} language="dockerfile" wrap={wrap} />
          </div>
        ) : layersStyle === "raw" ? (
          <div className="df-view">
            <CodeView value={raw} language={null} lineNumbers={false} wrap={wrap} />
          </div>
        ) : (
          <Table<LayerHistoryItem>
            size="small"
            rowKey={rowKey}
            pagination={false}
            dataSource={layers}
            columns={columns}
            expandable={{
              expandedRowKeys: expanded,
              onExpandedRowsChange: (keys) => setExpanded(keys.map(String)),
              expandedRowRender: (layer) => (
                <pre className="code-view" style={{ minHeight: 0 }}>
                  {layer.createdBy}
                  {layer.comment ? `\n\n# ${layer.comment}` : ""}
                </pre>
              ),
            }}
          />
        )}

        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            <Mono>docker history --no-trunc {name}</Mono>
          </span>
          <span className="spacer" />
          <span className="dim" style={{ fontSize: 12 }}>
            {image?.Size ? formatBytes(image.Size) : "—"} · {layers.length} layers
          </span>
        </div>
      </Section>
    </div>
  );
}
