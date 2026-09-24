import { CloudDownloadOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Divider, Input, Modal, Progress } from "antd";
import { useEffect, useRef, useState } from "react";
import { Mono } from "../../../components/ui";
import { queryKeys } from "../../../lib/queryClient";
import { pullImage } from "../../../services/tauriApi";
import { formatBytes, type ImagePullProgress } from "../../../types/docker";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface LayerState {
  id: string;
  status: string;
  current: number;
  total: number;
  percent: number;
}

const ACTIVE_STATUSES = ["Downloading", "Extracting", "Verifying Checksum", "Download complete", "Pushing"];

export default function PullImageModal({ open, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [imageName, setImageName] = useState("nginx:latest");
  const [pulling, setPulling] = useState(false);
  const [layers, setLayers] = useState<Record<string, LayerState>>({});
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      disposeRef.current?.();
      disposeRef.current = null;
      setPulling(false);
    }
  }, [open]);

  useEffect(() => () => disposeRef.current?.(), []);

  const onProgress = (progress: ImagePullProgress) => {
    const id = progress.id || progress.status;
    setLayers((prev) => ({
      ...prev,
      [id]: {
        id,
        status: progress.status,
        current: progress.currentBytes,
        total: progress.totalBytes,
        percent: progress.percent,
      },
    }));
  };

  const start = () => {
    if (!imageName.trim()) return;
    setLayers({});
    setPulling(true);
    disposeRef.current = pullImage(imageName.trim(), onProgress, () => {
      setPulling(false);
      disposeRef.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      message.success(`Pulled ${imageName.trim()}`);
    });
  };

  const layerList = Object.values(layers).sort((a, b) => a.id.localeCompare(b.id));
  const done = layerList.filter((l) => l.status === "Pull complete" || l.percent >= 100).length;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Pull image"
      width={560}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={pulling}>
          Close
        </Button>,
        <Button key="pull" type="primary" icon={<CloudDownloadOutlined />} loading={pulling} onClick={start}>
          Pull
        </Button>,
      ]}
    >
      <div className="label">Image reference</div>
      <Input
        className="mono"
        value={imageName}
        disabled={pulling}
        onChange={(e) => setImageName(e.target.value)}
        onPressEnter={start}
        placeholder="redis:alpine"
      />

      <Divider />

      <div className="label">Layers {layerList.length ? `· ${done}/${layerList.length} complete` : ""}</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          marginTop: 12,
          maxHeight: 320,
          overflow: "auto",
        }}
      >
        {layerList.length === 0 ? (
          <span className="dim">Progress appears here once the pull starts.</span>
        ) : (
          layerList.map((layer) => {
            const complete = layer.status === "Pull complete" || layer.percent >= 100;
            const active = pulling && ACTIVE_STATUSES.includes(layer.status) && !complete;
            return (
              <div key={layer.id}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 12 }}>
                  <Mono>{layer.id.slice(0, 18)}</Mono>
                  <span className="dim" style={{ fontSize: 12 }}>
                    {layer.status}
                    {layer.total > 0 ? ` · ${formatBytes(layer.current)} / ${formatBytes(layer.total)}` : ""}
                    {layer.percent > 0 ? ` · ${layer.percent}%` : ""}
                  </span>
                </div>
                <Progress
                  percent={Math.round(layer.percent)}
                  status={complete ? "success" : active ? "active" : "normal"}
                  showInfo={false}
                  size="small"
                />
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
