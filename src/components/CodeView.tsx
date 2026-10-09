import { Spin } from "antd";
import { type ComponentProps, lazy, Suspense } from "react";

// CodeMirror and its language modes are a sizeable part of the JS bundle.
// Lazy-loading keeps them out of the startup chunk so the app parses and
// paints faster; they only load when a code view is first shown.
// Keep light exports (like detectLanguage) here, never in CodeViewImpl,
// or a static import of them would pull CodeMirror back in.
const CodeViewImpl = lazy(() => import("./CodeViewImpl"));

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

export default function CodeView(props: ComponentProps<typeof CodeViewImpl>) {
  return (
    <Suspense fallback={<Spin style={{ margin: 24 }} />}>
      <CodeViewImpl {...props} />
    </Suspense>
  );
}
