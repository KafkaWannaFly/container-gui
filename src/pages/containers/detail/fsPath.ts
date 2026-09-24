import type { FsEntry } from "../../../types/docker";

export function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}

/** Every ancestor of `path`, root first, including `path` itself. */
export function ancestors(path: string): string[] {
  const out = ["/"];
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i += 1) out.push(`/${parts.slice(0, i).join("/")}`);
  return out;
}

/** Collapse `.`, `..` and duplicate slashes. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/** Absolute path a symlink at `linkPath` points to. */
export function resolveLink(linkPath: string, target: string): string {
  return normalize(target.startsWith("/") ? target : `${parentOf(linkPath)}/${target}`);
}

/** Kernel-generated trees: reading them through the archive API is meaningless. */
export type Special = "stdout" | "stderr" | "virtual" | null;

export function classify(path: string): Special {
  if (/^\/(dev\/stdout|proc\/self\/fd\/1)$/.test(path)) return "stdout";
  if (/^\/(dev\/stderr|proc\/self\/fd\/2)$/.test(path)) return "stderr";
  if (/^\/(proc|sys)(\/|$)/.test(path)) return "virtual";
  return null;
}

export function sortEntries(entries: FsEntry[]): FsEntry[] {
  const rank = (e: FsEntry) => (e.kind === "dir" ? 0 : 1);
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Names that commonly hold keys or credentials; previews start masked. */
export function isSensitive(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return (
    /\.(key|pem|p12|pfx|jks|keystore)$/i.test(name) ||
    /^(id_(rsa|ecdsa|ed25519|dsa)|\.env(\..+)?|\.netrc|\.pgpass|shadow|gshadow|credentials|secrets?(\..+)?)$/i.test(
      name,
    ) ||
    /\/(secrets|\.ssh)\//.test(path)
  );
}
