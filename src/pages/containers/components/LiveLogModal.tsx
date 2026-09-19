import { useEffect, useRef, useState } from "react";
import { Button, Modal, Switch } from "antd";
import { ClearOutlined } from "@ant-design/icons";
import { Mono } from "../../../components/ui";
import { streamContainerLogs } from "../../../services/tauriApi";
import { shortId, type LogChunk } from "../../../types/docker";

interface LogTarget {
  id: string;
  names: string[];
}

interface Props {
  container: LogTarget | null;
  onClose: () => void;
}

const MAX_LINES = 2000;

export default function LiveLogModal({ container, onClose }: Props) {
  const [lines, setLines] = useState<LogChunk[]>([]);
  const [follow, setFollow] = useState(true);
  const [connected, setConnected] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  const containerId = container?.id ?? null;

  useEffect(() => {
    if (!containerId) return;
    setLines([]);
    setConnected(true);
    const dispose = streamContainerLogs(
      containerId,
      200,
      (chunk) => setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(-MAX_LINES + 1), chunk] : [...prev, chunk])),
      () => setConnected(false),
    );
    return () => {
      dispose();
      setConnected(false);
    };
  }, [containerId]);

  useEffect(() => {
    if (follow && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const onScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  return (
    <Modal
      open={container != null}
      onCancel={onClose}
      footer={null}
      width={760}
      title={
        container ? (
          <span>
            Live logs — <Mono>{container.names[0] ?? shortId(container.id)}</Mono>
          </span>
        ) : (
          "Live logs"
        )
      }
    >
      <pre ref={preRef} className="logs" style={{ maxHeight: 440 }} onScroll={onScroll}>
        {lines.length === 0 ? (
          <span className="dim">{connected ? "Waiting for output…" : "No logs available."}</span>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={line.stream === "stderr" ? "err" : undefined}>
              {line.message.replace(/\n$/, "")}
            </div>
          ))
        )}
      </pre>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          {connected ? "Streaming" : "Disconnected"} · {lines.length} lines · auto-scroll pauses when you scroll up
        </span>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          Follow
        </span>
        <Switch size="small" checked={follow} onChange={setFollow} />
        <Button size="small" icon={<ClearOutlined />} onClick={() => setLines([])}>
          Clear
        </Button>
      </div>
    </Modal>
  );
}
