import { type Token, tokenizeDockerLine } from "./dockerfile";

/**
 * Small line-based highlighter for the file viewer. Stateless per line,
 * so block comments spanning lines are not tracked — good enough for the
 * config files and scripts people open inside containers.
 */
export type Lang = "dockerfile" | "shell" | "hash" | "ini" | "yaml" | "json" | "clike" | "markup" | "plain";

export type Tok = { t: Token["t"] | "num" | "key"; s: string };

const BY_EXT: Record<string, Lang> = {
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ash: "shell",
  conf: "hash",
  cnf: "hash",
  cfg: "hash",
  properties: "hash",
  env: "hash",
  toml: "hash",
  py: "hash",
  rb: "hash",
  pl: "hash",
  r: "hash",
  ini: "ini",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  js: "clike",
  mjs: "clike",
  cjs: "clike",
  ts: "clike",
  tsx: "clike",
  jsx: "clike",
  go: "clike",
  rs: "clike",
  c: "clike",
  h: "clike",
  cpp: "clike",
  java: "clike",
  kt: "clike",
  cs: "clike",
  php: "clike",
  css: "clike",
  scss: "clike",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
};

const BY_NAME: Record<string, Lang> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  ".bashrc": "shell",
  ".profile": "shell",
  ".ashrc": "shell",
  ".bash_profile": "shell",
  hosts: "hash",
  "resolv.conf": "hash",
  "mime.types": "hash",
  makefile: "hash",
  ".env": "hash",
  ".gitignore": "hash",
  ".dockerignore": "hash",
};

export function detectLang(path: string, firstLine: string): Lang {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.endsWith(".dockerfile") || name.startsWith("dockerfile.")) return "dockerfile";
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  if (BY_EXT[ext]) return BY_EXT[ext];
  if (/^#!.*\b(ba|a|z|da)?sh\b/.test(firstLine)) return "shell";
  if (/^#!.*\bpython/.test(firstLine)) return "hash";
  if (/^#!.*\bnode\b/.test(firstLine)) return "clike";
  if ((path.startsWith("/etc/") && !ext) || /^[A-Z_][A-Z0-9_]*=/.test(firstLine)) return "hash";
  return "plain";
}

type Rule = [RegExp, Tok["t"] | ((m: string) => Tok["t"])];

const STRING_DQ = /"(?:[^"\\]|\\.)*"?/y;
const STRING_SQ = /'(?:[^'\\]|\\.)*'?/y;
const NUMBER = /\b\d+(?:\.\d+)?\b/y;
const SPACE = /\s+/y;

const SHELL_KW = new Set(
  "if then else elif fi for while until do done case esac in function return export local readonly set unset exit shift source alias".split(
    " ",
  ),
);
const CLIKE_KW = new Set(
  "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof interface type enum struct impl fn pub use mod match loop package func go defer select chan map range public private protected static void int string bool true false null undefined nil None self this".split(
    " ",
  ),
);

const word = (keywords: Set<string>): Rule => [/[A-Za-z_][\w-]*/y, (m) => (keywords.has(m) ? "kw" : "text")];

const RULES: Record<Exclude<Lang, "dockerfile" | "plain">, Rule[]> = {
  shell: [
    [/(^|(?<=\s))#.*/y, "comment"],
    [STRING_DQ, "string"],
    [STRING_SQ, "string"],
    [/\$\{[^}]*\}|\$\w+|\$[@*#?$!0-9]/y, "var"],
    [/--?[A-Za-z][\w-]*/y, "flag"],
    [/&&|\|\||[|;<>]/y, "op"],
    [NUMBER, "num"],
    word(SHELL_KW),
    [SPACE, "text"],
  ],
  hash: [
    [/(^|(?<=\s))#.*/y, "comment"],
    [/^\s*[\w.-]+(?=\s*[=:])/y, "key"],
    [STRING_DQ, "string"],
    [STRING_SQ, "string"],
    [/\$\{[^}]*\}|\$\w+/y, "var"],
    [NUMBER, "num"],
    [/[A-Za-z_][\w.-]*/y, "text"],
    [SPACE, "text"],
  ],
  ini: [
    [/^\s*[;#].*/y, "comment"],
    [/^\s*\[[^\]]*\]/y, "kw"],
    [/^\s*[\w.-]+(?=\s*=)/y, "key"],
    [STRING_DQ, "string"],
    [NUMBER, "num"],
    [/[A-Za-z_][\w.-]*/y, "text"],
    [SPACE, "text"],
  ],
  yaml: [
    [/(^|(?<=\s))#.*/y, "comment"],
    [/^\s*(?:-\s+)?[\w."'/-]+(?=\s*:(\s|$))/y, "key"],
    [STRING_DQ, "string"],
    [STRING_SQ, "string"],
    [/\b(true|false|null|yes|no|on|off)\b/y, "kw"],
    [NUMBER, "num"],
    [/[&*][\w-]+/y, "var"],
    [/[A-Za-z_][\w.-]*/y, "text"],
    [SPACE, "text"],
  ],
  json: [
    [/"(?:[^"\\]|\\.)*"(?=\s*:)/y, "key"],
    [STRING_DQ, "string"],
    [/\b(true|false|null)\b/y, "kw"],
    [/-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, "num"],
    [SPACE, "text"],
  ],
  clike: [
    [/\/\/.*/y, "comment"],
    [/\/\*.*?(\*\/|$)/y, "comment"],
    [STRING_DQ, "string"],
    [STRING_SQ, "string"],
    [/`(?:[^`\\]|\\.)*`?/y, "string"],
    [NUMBER, "num"],
    word(CLIKE_KW),
    [SPACE, "text"],
  ],
  markup: [
    [/<!--.*?(-->|$)/y, "comment"],
    [/<\/?[\w:-]+/y, "kw"],
    [/\/?>/y, "kw"],
    [/[\w:-]+(?==)/y, "key"],
    [STRING_DQ, "string"],
    [STRING_SQ, "string"],
    [/&\w+;/y, "var"],
    [/[^<&"'=\s/>]+/y, "text"],
    [SPACE, "text"],
  ],
};

export function tokenizeLine(line: string, lang: Lang): Tok[] {
  if (lang === "plain") return [{ t: "text", s: line }];
  if (lang === "dockerfile") return tokenizeDockerLine(line);
  const rules = RULES[lang];
  const out: Tok[] = [];
  const push = (t: Tok["t"], s: string) => {
    const last = out[out.length - 1];
    if (t === "text" && last?.t === "text") last.s += s;
    else out.push({ t, s });
  };
  let i = 0;
  while (i < line.length) {
    let matched = false;
    for (const [re, type] of rules) {
      re.lastIndex = i;
      const m = re.exec(line);
      if (m && m[0].length > 0) {
        push(typeof type === "function" ? type(m[0]) : type, m[0]);
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      push("text", line[i]);
      i += 1;
    }
  }
  return out;
}
