import { CopyOutlined, DownloadOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Descriptions, type DescriptionsProps, Empty, Segmented, Spin, Table, Tooltip } from "antd";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { z } from "zod";
import CodeView from "../../../components/CodeView";
import { CollapseAllButton, Section, useSections } from "../../../components/Section";
import { Mono, Pill } from "../../../components/ui";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { useSaveToDownloads } from "../../../hooks/useSaveToDownloads";
import { localTime } from "../../../lib/format";
import { queryKeys } from "../../../lib/queryClient";
import { imageHistory, saveTextToDownloads } from "../../../services/tauriApi";
import { formatBytes, type LayerHistoryItem, shortId } from "../../../types/docker";
import { baseBoundary, historyText, oldestFirst, reconstructDockerfile, toInstruction } from "./dockerfile";
import { platformOf, type TabProps } from "./model";

const IMAGE_SECTIONS = ["summary", "build"] as const;
const BASE_LABEL = "org.opencontainers.image.base.name";

const View = z.enum(["dockerfile", "layers"]);
const LayersStyle = z.enum(["table", "raw"]);

const size = (n: number) => (n ? formatBytes(n) : "0 B");
const time = (unix: number) => format(new Date(unix * 1000), "yyyy-MM-dd HH:mm");

export default function ImageTab({ ctr, image, onCopy }: TabProps) {
  const { section, allClosed, toggleAll } = useSections("image.sections", IMAGE_SECTIONS);
  const [view, setView] = usePersistentState("image.view", View, "dockerfile");
  const [layersStyle, setLayersStyle] = usePersistentState("image.layers", LayersStyle, "table");
  const [expanded, setExpanded] = useState<string[]>([]);
  const save = useSaveToDownloads();

  const ref = ctr.Image ?? "";
  const name = ctr.Config?.Image ?? shortId(ref);
  const history = useQuery({
    queryKey: queryKeys.imageHistory(ref),
    queryFn: () => imageHistory(ref),
    enabled: ref !== "",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const layers = useMemo(() => oldestFirst(history.data ?? []), [history.data]);
  const labels = image?.Config?.Labels ?? {};
  const baseName = labels[BASE_LABEL];
  const boundary = useMemo(() => baseBoundary(layers), [layers]);
  const dockerfile = useMemo(
    () => (layers.length ? reconstructDockerfile(name, layers, baseName) : ""),
    [name, layers, baseName],
  );
  const raw = useMemo(() => historyText(layers, size, time), [layers]);

  const digest = image?.RepoDigests?.[0];
  const withContent = layers.filter((l) => l.size > 0).length;
  const fileBase = name.replace(/[/:@]/g, "_");

  const summary: DescriptionsProps["items"] = [
    { key: "name", label: "Image", children: <Mono>{name}</Mono> },
    {
      key: "id",
      label: "Image ID",
      children: (
        <button type="button" className="copyable mono" onClick={() => onCopy(ref, "Image ID")}>
          {ref.slice(0, 19)}
          <CopyOutlined />
        </button>
      ),
    },
    {
      key: "digest",
      label: "Digest",
      children: digest ? (
        <button type="button" className="copyable mono" onClick={() => onCopy(digest, "Digest")}>
          {digest.length > 48 ? `${digest.slice(0, 48)}…` : digest}
          <CopyOutlined />
        </button>
      ) : (
        <span className="dim">none — never pushed to or pulled from a registry</span>
      ),
    },
    {
      key: "source",
      label: "Source",
      children: digest ? (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Pill tone="teal">pulled</Pill>
          <Mono>{digest.split("@")[0]}</Mono>
        </span>
      ) : (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Pill tone="lav">local build</Pill>
          <span className="dim" style={{ fontSize: 12 }}>
            the original Dockerfile lives in its build context, not in the image
          </span>
        </span>
      ),
    },
    ...(baseName ? [{ key: "base", label: "Base image", children: <Mono>{baseName}</Mono> }] : []),
    { key: "created", label: "Created", children: <Mono>{localTime(image?.Created)}</Mono> },
    {
      key: "size",
      label: "Size",
      children: (
        <span>
          <Mono>{image?.Size ? formatBytes(image.Size) : "—"}</Mono>{" "}
          <span className="dim" style={{ fontSize: 12 }}>
            · {layers.length} layers, {withContent} with content
          </span>
        </span>
      ),
    },
    { key: "platform", label: "Platform", children: <Mono>{platformOf(ctr, image)}</Mono> },
  ];

  const layerCols = [
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

  const note =
    view === "dockerfile"
      ? "Reconstructed from layer history. Images do not keep their original Dockerfile."
      : layersStyle === "table"
        ? "Oldest layer first. Expand a row to see the raw history entry."
        : "Oldest layer first, full CreatedBy text as docker history --no-trunc prints it.";
  const text = view === "dockerfile" ? dockerfile : raw;
  const saveName = view === "dockerfile" ? `${fileBase}.Dockerfile` : `${fileBase}-history.txt`;
  const rowKey = (layer: LayerHistoryItem) => `${layer.id}-${layer.created}-${layer.createdBy}`;

  return (
    <div className="tab-stack">
      <div className="toolbar">
        <span className="spacer" />
        <CollapseAllButton allClosed={allClosed} onClick={toggleAll} />
      </div>

      <Section id="summary" title="Image" {...section}>
        <Descriptions column={1} size="small" bordered items={summary} />
      </Section>

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
              <Tooltip title="Copy">
                <Button
                  aria-label="Copy"
                  icon={<CopyOutlined />}
                  disabled={!text}
                  onClick={() => onCopy(text, view === "dockerfile" ? "Dockerfile" : "Layer history")}
                />
              </Tooltip>
              <Tooltip title={`Save to Downloads as ${saveName}`}>
                <Button
                  aria-label="Save to Downloads"
                  icon={<DownloadOutlined />}
                  disabled={!text}
                  onClick={() => void save(() => saveTextToDownloads(saveName, text))}
                />
              </Tooltip>
            </>
          ) : null}
        </div>

        {history.isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : !layers.length ? (
          <Empty description={history.error?.message ?? "No layer history available"} />
        ) : view === "dockerfile" ? (
          <div className="df-view">
            <CodeView value={dockerfile} language="dockerfile" />
          </div>
        ) : layersStyle === "raw" ? (
          <div className="df-view">
            <CodeView value={raw} language={null} />
          </div>
        ) : (
          <Table<LayerHistoryItem>
            size="small"
            rowKey={rowKey}
            pagination={false}
            dataSource={layers}
            columns={layerCols}
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
