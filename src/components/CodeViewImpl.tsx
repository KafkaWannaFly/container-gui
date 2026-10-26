import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { css } from "@codemirror/legacy-modes/mode/css";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { javascript, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import CodeMirror, { EditorState, EditorView, Prec } from "@uiw/react-codemirror";
import { useMemo } from "react";
import { useTheme } from "../theme/antdTheme";

const jsonMode: StreamParser<unknown> = {
  name: "json",
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:[^"\\]|\\.)*"(?=\s*:)/)) return "atom";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^(?:true|false|null)\b/)) return "keyword";
    if (stream.match(/^[{}[\]:,]/)) return "meta";
    stream.next();
    return null;
  },
};

interface YamlState {
  pair: boolean;
  value: boolean;
  keyCol: number;
  inlinePairs: number;
  inlineList: number;
  literal: boolean;
}

const YAML_KEYWORDS = /^(?:true|false|on|off|yes|no|null|~)(?=\s*(?:$|#|in|[,}\]]))/i;
const YAML_NUMBER = /^-?\d+(?:\.\d+)?(?=\s*(?:$|#|[,}\]]))/;

const yamlMode: StreamParser<YamlState> = {
  name: "yaml",
  startState: () => ({
    pair: false,
    value: false,
    keyCol: 0,
    inlinePairs: 0,
    inlineList: 0,
    literal: false,
  }),
  token(stream, state) {
    if (stream.sol()) {
      if (state.literal && stream.indentation() > state.keyCol) {
        stream.skipToEnd();
        return "string";
      }
      state.literal = false;
      state.keyCol = 0;
      state.pair = false;
      state.value = false;
      if (stream.match(/^---(?=\s|$)|^\.\.\.(?=\s|$)/)) return "def";
    }
    if (stream.eatSpace()) return null;

    const ch = stream.peek();
    if (ch === "#" && (stream.pos === 0 || /\s/.test(stream.string.charAt(stream.pos - 1)))) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^('([^']|\\.)*'?|"([^"]|\\.)*"?)/)) return "string";
    if (stream.match(/^\$\{[^}]*\}?/)) return "variable";

    if (!state.value && stream.match(/^-\s+/)) {
      // List item: if it isn't a `key: value` pair, treat the rest of the item as a value.
      if (!/^[^#:\s][^#]*?:\s*($|\s|#)/.test(stream.string.slice(stream.pos))) {
        state.value = true;
      }
      return "meta";
    }

    if (stream.match(/^[{}[\],]/)) {
      if (ch === "{") {
        state.inlinePairs++;
        state.pair = false;
        state.value = false;
      } else if (ch === "}") {
        state.inlinePairs = Math.max(0, state.inlinePairs - 1);
      } else if (ch === "[") {
        state.inlineList++;
        state.value = true;
      } else if (ch === "]") {
        state.inlineList = Math.max(0, state.inlineList - 1);
      } else if (ch === ",") {
        if (state.inlinePairs > 0) {
          state.pair = false;
          state.value = false;
        } else if (state.inlineList > 0) {
          state.value = true;
        }
      }
      return "meta";
    }

    if (!state.pair && !state.value && stream.match(/^[^#:\s{}[\],][^#{}[\],]*?(?=\s*:($|\s|#))/)) {
      state.pair = true;
      state.keyCol = stream.indentation();
      return "atom";
    }
    if (state.pair && stream.match(/^:\s*/)) {
      state.value = true;
      return "meta";
    }

    if (state.value) {
      if (stream.match(/^[|>][-+]?\s*(?=$|#)/)) {
        state.literal = true;
        return "meta";
      }
      if (stream.match(/^[&*][\w.-]+/)) return "variable";
      if (stream.match(YAML_NUMBER)) return "number";
      if (stream.match(YAML_KEYWORDS)) return "keyword";
      if (stream.match(/^[^\s#$,{}[\]]+(?:\s+[^\s#$,{}[\]]+)*/)) return "string";
    }

    stream.next();
    return null;
  },
};

interface PropertiesState {
  inValue: boolean;
  continuation: boolean;
}

const propertiesMode: StreamParser<PropertiesState> = {
  name: "properties",
  startState: () => ({ inValue: false, continuation: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.inValue = state.continuation;
      state.continuation = false;
    }
    if (stream.eatSpace()) return null;

    const ch = stream.peek();
    if (!state.inValue && (ch === "#" || ch === ";" || ch === "!")) {
      stream.skipToEnd();
      return "comment";
    }
    if (!state.inValue && stream.pos === stream.indentation() && ch === "[") {
      if (stream.match(/^\[[^\]]*\]/)) return "keyword";
    }
    if (!state.inValue) {
      if (stream.match(/^export(?=\s+)/)) return "keyword";
      if (stream.match(/^[^=:#\s][^=:#]*?(?=\s*[=:])/)) return "atom";
      if (stream.match(/^[=:]/)) {
        state.inValue = true;
        return "meta";
      }
    }

    if (state.inValue) {
      if (ch === "#" && /\s/.test(stream.string.charAt(stream.pos - 1))) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^('([^']|\\.)*'?|"([^"]|\\.)*"?)/)) return "string";
      if (stream.match(/^\$\{[^}]*\}?|\$[A-Za-z_][A-Za-z0-9_]*/)) return "variable";
      if (stream.match(/^-?\d+(?:\.\d+)?(?=\s*(?:$|#))/)) return "number";
      if (stream.match(/^(?:true|false|yes|no|on|off)(?=\s*(?:$|#))/i)) return "keyword";
      if (stream.match(/^\\$/)) {
        state.continuation = true;
        return "meta";
      }
      if (stream.match(/^[^\s#$'"]+/)) return "string";
    }

    stream.next();
    return null;
  },
};

const MODES: Record<string, StreamParser<unknown>> = {
  dockerfile: dockerFile,
  shell,
  nginx,
  properties: propertiesMode,
  toml,
  yaml: yamlMode,
  json: jsonMode,
  javascript,
  typescript,
  python,
  go,
  rust,
  xml,
  html,
  css,
};

const baseEditorStyle = {
  "&": { backgroundColor: "var(--void)", fontSize: "12px", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.75" },
  ".cm-gutters": { backgroundColor: "var(--void)", borderRight: "none", color: "var(--smoke)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
};

const darkTheme = EditorView.theme(baseEditorStyle, { dark: true });
const lightTheme = EditorView.theme(baseEditorStyle, { dark: false });

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
  const { theme: appTheme } = useTheme();
  const extensions = useMemo(
    () => [
      // Above the built-in theme, so our background and gutter colors win.
      Prec.highest(appTheme.mode === "dark" ? darkTheme : lightTheme),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(language && MODES[language] ? [StreamLanguage.define(MODES[language])] : []),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [appTheme.mode, language, wrap],
  );
  return (
    <CodeMirror
      value={value}
      theme={appTheme.mode}
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
