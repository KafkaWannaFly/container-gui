// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import { icons as catppuccin } from "@iconify-json/catppuccin";
import { icons as codicon } from "@iconify-json/codicon";
import { icons as hugeicons } from "@iconify-json/hugeicons";
import { icons as lucide } from "@iconify-json/lucide";
import { icons as vscodeIcons } from "@iconify-json/vscode-icons";
import type { IconifyJSON } from "@iconify/types";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;

const PACK_VIRTUAL_PREFIX = "virtual:iconify-pack/";
const RESOLVED_PREFIX = `\0${PACK_VIRTUAL_PREFIX}`;

const SETS: Record<string, IconifyJSON> = {
  lucide,
  hugeicons,
  "vscode-icons": vscodeIcons,
  codicon,
  catppuccin,
};

const PACK_PREFIXES: Record<string, readonly string[]> = {
  lucide: ["lucide"],
  hugeicons: ["hugeicons"],
  "vscode-icons": ["vscode-icons", "codicon"],
  catppuccin: ["catppuccin", "lucide"],
};

const CATPPUCCIN_MOCHA_COLORS: Record<string, string> = {
  "#cad3f5": "var(--ctp-text)",
  "#8087a2": "var(--ctp-lavender)",
  "#8aadf4": "var(--ctp-blue)",
  "#8bd5ca": "var(--ctp-teal)",
  "#91d7e3": "var(--ctp-sky)",
  "#7dc4e4": "var(--ctp-sapphire)",
  "#a6da95": "var(--ctp-green)",
  "#eed49f": "var(--ctp-yellow)",
  "#f5a97f": "var(--ctp-peach)",
  "#ed8796": "var(--ctp-red)",
  "#ee99a0": "var(--ctp-maroon)",
  "#c6a0f6": "var(--ctp-mauve)",
  "#f5bde6": "var(--ctp-pink)",
};

function iconifyOfflinePlugin(): Plugin {
  return {
    name: "iconify-offline-subset",
    resolveId(id) {
      if (id.startsWith(PACK_VIRTUAL_PREFIX)) {
        return `\0${id}`;
      }
    },
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return;
      const packId = id.slice(RESOLVED_PREFIX.length);
      const allowedPrefixes = PACK_PREFIXES[packId];
      if (!allowedPrefixes) return;

      const source = fs.readFileSync("src/components/icons.tsx", "utf8");
      const byPrefix = new Map<string, Set<string>>();
      const re = /\b(lucide|hugeicons|vscode-icons|codicon|catppuccin):([a-z0-9-]+)\b/g;
      for (const match of source.matchAll(re)) {
        const [, prefix, name] = match;
        if (!allowedPrefixes.includes(prefix)) continue;
        let set = byPrefix.get(prefix);
        if (!set) {
          set = new Set();
          byPrefix.set(prefix, set);
        }
        set.add(name);
      }

      const subsets: IconifyJSON[] = [];
      for (const [prefix, names] of byPrefix) {
        const full = SETS[prefix];
        if (!full) continue;
        const icons: IconifyJSON["icons"] = {};
        for (const name of names) {
          const direct = full.icons[name];
          const aliasParent = full.aliases?.[name]?.parent;
          const resolved = direct ?? (aliasParent ? full.icons[aliasParent] : undefined);
          if (!resolved) {
            throw new Error(`Icon "${prefix}:${name}" not found in @iconify-json/${prefix}`);
          }
          let body = resolved.body;
          if (prefix === "catppuccin") {
            if (name === "config") body = body.replaceAll("#8087a2", "var(--ctp-mauve)");
            if (name === "lock") body = body.replaceAll("#8087a2", "var(--ctp-peach)");
            for (const [from, to] of Object.entries(CATPPUCCIN_MOCHA_COLORS)) {
              body = body.replaceAll(from, to);
            }
            body = body.replace(/stroke-width="[^"]*"/g, 'stroke-width="1.6"');
            body = `<g stroke-width="1.6">${body}</g>`;
          }
          icons[name] = { ...resolved, body };
        }
        subsets.push({
          prefix,
          width: full.width,
          height: full.height,
          icons,
        });
      }

      return `export default ${JSON.stringify(subsets)};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), iconifyOfflinePlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
