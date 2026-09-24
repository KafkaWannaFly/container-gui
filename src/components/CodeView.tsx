import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { css } from "@codemirror/legacy-modes/mode/css";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { javascript, json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import CodeMirror, { EditorState, EditorView, Prec } from "@uiw/react-codemirror";
import { useMemo } from "react";

const MODES: Record<string, StreamParser<unknown>> = {
  dockerfile: dockerFile,
  shell,
  nginx,
  properties,
  toml,
  yaml,
  json,
  javascript,
  typescript,
  python,
  go,
  rust,
  xml,
  html,
  css,
};

const BY_EXT: Record<string, string> = {
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ash: "shell",
  conf: "properties",
  cnf: "properties",
  cfg: "properties",
  ini: "properties",
  env: "properties",
  properties: "properties",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  go: "go",
  rs: "rust",
  xml: "xml",
  svg: "xml",
  html: "html",
  htm: "html",
  css: "css",
};

/** Pick a highlighting mode from the file name, falling back to the shebang. */
export function detectLanguage(path: string, text: string): string | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (name === "dockerfile" || name === "containerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  if (name === "nginx.conf" || path.includes("/nginx/")) return "nginx";
  if ([".bashrc", ".profile", ".ashrc", ".bash_profile"].includes(name)) return "shell";
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  if (BY_EXT[ext]) return BY_EXT[ext];
  const first = text.slice(0, 200).split("\n")[0];
  if (/^#!.*\b(ba|a|z|da)?sh\b/.test(first)) return "shell";
  if (/^#!.*\bpython/.test(first)) return "python";
  if (/^#!.*\bnode\b/.test(first)) return "javascript";
  if (/^[A-Z_][A-Z0-9_]*=/.test(first) || (path.startsWith("/etc/") && !ext)) return "properties";
  return null;
}

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--void)", fontSize: "12px", height: "100%" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.75" },
    ".cm-gutters": { backgroundColor: "var(--void)", borderRight: "none", color: "var(--smoke)" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

/**
 * Read-only code viewer. CodeMirror only renders the visible viewport,
 * so multi-megabyte files stay responsive.
 */
export default function CodeView({
  value,
  language,
  wrap = false,
  lineNumbers = true,
  height = "100%",
}: {
  value: string;
  language: string | null;
  wrap?: boolean;
  /** Off when the text carries its own numbering. */
  lineNumbers?: boolean;
  height?: string;
}) {
  const extensions = useMemo(
    () => [
      // Above the built-in dark theme, so our background and gutter colors win.
      Prec.highest(theme),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(language && MODES[language] ? [StreamLanguage.define(MODES[language])] : []),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [language, wrap],
  );
  return (
    <CodeMirror
      value={value}
      theme="dark"
      height={height}
      extensions={extensions}
      basicSetup={{
        lineNumbers,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}
