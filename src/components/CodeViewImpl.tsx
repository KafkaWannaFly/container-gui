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
