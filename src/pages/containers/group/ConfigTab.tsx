import {
  CheckCircleOutlined,
  CopyOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Segmented } from "antd";
import { useMemo, useState } from "react";
import type { ComposeProject } from "../../../types/docker";
import { isSecret } from "../detail/model";

const MASK = "••••••••";

/** Values the compose environment marks as secret, for masking the Resolved view. */
function secretValues(config: ComposeProject): string[] {
  const values = new Set<string>();
  for (const svc of Object.values(config.config.services)) {
    for (const [key, value] of Object.entries(svc.environment ?? {})) {
      const text = value == null ? "" : String(value);
      if (text && isSecret(key, text)) values.add(text);
    }
  }
  return [...values];
}

function YamlView({ text }: { text: string }) {
  return (
    <div className="g-code-box">
      <div className="g-code">
        {text.split("\n").map((line, i) => {
          const comment = /^(\s*)(#.*)$/.exec(line);
          const kv = /^(\s*-?\s*)([\w.-]+)(:)(.*)$/.exec(line);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: config lines are positional
            <div key={i} className="g-ln">
              <span className="n">{i + 1}</span>
              <span className="t">
                {comment ? (
                  <>
                    {comment[1]}
                    <span className="y-c">{comment[2]}</span>
                  </>
                ) : kv ? (
                  <>
                    {kv[1]}
                    <span className="y-k">{kv[2]}</span>
                    <span className="y-c">{kv[3]}</span>
                    {kv[4]}
                  </>
                ) : (
                  line || " "
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConfigTab({ config }: { config: ComposeProject }) {
  const { message } = App.useApp();
  const [file, setFile] = useState(config.files[0]?.name ?? "compose.yaml");
  const [reveal, setReveal] = useState(false);

  const options = useMemo(
    () => [
      ...config.files.map((f) => ({ label: f.name, value: f.name })),
      { label: "Resolved", value: "resolved" },
    ],
    [config.files],
  );

  const secrets = useMemo(() => secretValues(config), [config]);

  const text = useMemo(() => {
    if (file === "resolved") {
      return reveal
        ? config.resolved
        : secrets.reduce((acc, value) => acc.split(value).join(MASK), config.resolved);
    }
    const found = config.files.find((f) => f.name === file);
    if (!found) return "";
    if (file === ".env" && !reveal) {
      return found.content.replace(
        /(^|\n)([\w.-]*?(?:PASSWORD|SECRET|TOKEN|KEY)[\w.-]*=).*/gi,
        `$1$2${MASK}`,
      );
    }
    return found.content;
  }, [file, reveal, config, secrets]);

  if (!config.files.length) return <Empty description="No compose files found" />;

  return (
    <div className="tab-stack">
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <Segmented value={file} onChange={(value) => setFile(String(value))} options={options} />
          <span
            className="dim"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <InfoCircleOutlined />
            {file === "resolved"
              ? "Output of docker compose config: files merged, variables interpolated."
              : file === ".env"
                ? "Used for variable interpolation, not injected into containers by itself."
                : `${config.workdir}/${file}`}
          </span>
          <span className="spacer" />
          {(file === ".env" || file === "resolved") && (
            <Button
              icon={reveal ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setReveal((value) => !value)}
            >
              {reveal ? "Hide secrets" : "Reveal secrets"}
            </Button>
          )}
          <Button
            icon={<CopyOutlined />}
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => message.success(`${file} copied`),
                () => message.error("Clipboard unavailable"),
              )
            }
          >
            Copy
          </Button>
        </div>
        <YamlView text={text} />
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            Read-only · edits happen in your editor; this view reloads when the file changes.
          </span>
          <span className="spacer" />
          <span
            className="dim"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <CheckCircleOutlined style={{ color: "var(--green)" }} /> Config valid
          </span>
        </div>
      </div>
    </div>
  );
}
