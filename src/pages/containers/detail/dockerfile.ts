import type { LayerHistoryItem } from "../../../types/docker";

/** `RUN |2 A=1 B=2 /bin/sh -c …` — BuildKit records build args this way. */
const RUN_WITH_ARGS = /^RUN \|\d+ ((?:\S+=\S*\s+)+)/;

export type Instruction = { text: string; args: string[] };

/** Turn one `docker history` CreatedBy entry back into a Dockerfile instruction. */
export function toInstruction(createdBy: string): Instruction {
  let s = createdBy
    .replace(/\s+# buildkit$/, "")
    .trim()
    .replace(/^\/bin\/sh -c #\(nop\)\s+/, "");
  if (s.startsWith("/bin/sh -c ")) s = `RUN ${s.slice(11)}`;

  const args: string[] = [];
  const withArgs = RUN_WITH_ARGS.exec(s);
  if (withArgs) {
    args.push(...withArgs[1].trim().split(/\s+/));
    s = `RUN ${s.slice(withArgs[0].length)}`;
  }
  s = s.replace(/^RUN \/bin\/(ba)?sh -c /, "RUN ");
  // `CMD ["a" "b"]` → `CMD ["a", "b"]`
  s = s.replace(
    /^(CMD|ENTRYPOINT|SHELL) \[(.*)\]$/,
    (_, k, a: string) => `${k} [${a.replace(/" "/g, '", "')}]`,
  );
  s = s.replace(/^EXPOSE map\[(.*)\]$/, (_, m: string) => `EXPOSE ${m.replace(/:\{\}/g, "")}`);
  // Legacy builder: `ADD file:abc in /` / `COPY dir:abc in /app`.
  s = s.replace(/^(ADD|COPY) ((?:file|dir|multi):[0-9a-f]+) in /, "$1 $2 ");
  if (s.startsWith("RUN ") && s.includes(" && ")) s = s.split(/\s+&&\s+/).join(" \\\n    && ");
  return { text: s, args };
}

/** Oldest first; Docker returns newest first. */
export function oldestFirst(history: LayerHistoryItem[]): LayerHistoryItem[] {
  return [...history].reverse();
}

/**
 * Index of the first layer after the base image, or 0 when unknown. Base
 * images almost always end with CMD/ENTRYPOINT, so the last such
 * instruction before the final stretch marks the boundary.
 */
export function baseBoundary(layers: LayerHistoryItem[]): number {
  for (let i = layers.length - 2; i >= 0; i -= 1) {
    const by = layers[i].createdBy;
    if (/(^|#\(nop\)\s+)(CMD|ENTRYPOINT)\b/.test(by.replace(/^\/bin\/sh -c /, ""))) {
      const later = layers.slice(i + 1);
      // Only a boundary if real work follows it.
      if (later.some((l) => l.size > 0 || /\b(RUN|COPY|ADD)\b/.test(l.createdBy))) return i + 1;
    }
  }
  return 0;
}

export function reconstructDockerfile(image: string, layers: LayerHistoryItem[], baseName?: string): string {
  const boundary = baseBoundary(layers);
  const seenArgs = new Set<string>();
  const render = (items: LayerHistoryItem[]) =>
    items.flatMap((layer) => {
      const { text, args } = toInstruction(layer.createdBy);
      // Declared ARGs have their own history entry; only add ones that don't.
      if (text.startsWith("ARG ")) {
        if (seenArgs.has(text.slice(4))) return [];
        seenArgs.add(text.slice(4));
        return [text];
      }
      const fresh = args.filter((a) => !seenArgs.has(a));
      for (const a of fresh) seenArgs.add(a);
      return [...fresh.map((a) => `ARG ${a}`), text];
    });

  const header = [
    `# Reconstructed from: docker history --no-trunc ${image}`,
    "# Images do not store their Dockerfile. Comments, build args, builder",
    "# stages and exact COPY sources may be missing or approximate.",
    "",
  ];
  if (!boundary) return `${[...header, ...render(layers)].join("\n")}\n`;
  return `${[
    ...header,
    `# ---- base image layers (${baseName ?? "inferred"}) ----`,
    ...render(layers.slice(0, boundary)),
    "",
    `# ---- ${image} ----`,
    ...render(layers.slice(boundary)),
  ].join("\n")}\n`;
}

/** `docker history`-style plain text, oldest first, nothing truncated. */
export function historyText(
  layers: LayerHistoryItem[],
  formatSize: (n: number) => string,
  formatTime: (unix: number) => string,
) {
  const rows = layers.map((l, i) => [String(i + 1), formatTime(l.created), formatSize(l.size), l.createdBy]);
  const head = ["#", "CREATED", "SIZE", "CREATED BY"];
  const widths = [0, 1, 2].map((c) => Math.max(head[c].length, ...rows.map((r) => r[c].length)));
  const line = (r: string[]) => `${[0, 1, 2].map((c) => r[c].padEnd(widths[c])).join("   ")}   ${r[3]}`;
  return `${[line(head), ...rows.map(line)].join("\n")}\n`;
}
