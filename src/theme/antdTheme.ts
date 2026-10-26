import { type ThemeConfig, theme } from "antd";
import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo } from "react";
import { createElement } from "react";
import { z } from "zod";
import { usePersistentState } from "../hooks/usePersistentState";

export interface ThemePalette {
  void: string;
  carbon: string;
  obsidian: string;
  graphite: string;
  smoke: string;
  ash: string;
  fog: string;
  mist: string;
  bone: string;
  paper: string;
  lime: string;
  green: string;
  coral: string;
  teal: string;
  violet: string;
  lav: string;
  amber: string;
}

export const THEME_IDS = [
  "linear",
  "aurora",
  "high-performance",
  "continuous-commerce",
  "immersive-entertainment",
  "flat-design",
  "liquid-glass",
  "memphis",
  "swiss-minimal",
  "origami",
  "flip7",
  "genesis",
] as const;
export const ThemeIdSchema = z.enum(THEME_IDS);
export type ThemeId = z.infer<typeof ThemeIdSchema>;
export const DEFAULT_THEME_ID: ThemeId = "linear";

export interface AppTheme {
  id: ThemeId;
  name: string;
  description: string;
  mode: "dark" | "light";
  palette: ThemePalette;
  /** Swatch colors shown in the theme picker. */
  swatches: [string, string, string];
  antd: ThemeConfig;
}

interface AntdThemeOptions {
  primaryText?: string;
  buttonRadius?: number;
  cardRadius?: number;
  buttonWeight?: number;
}

function buildAntdTheme(mode: "dark" | "light", p: ThemePalette, opts: AntdThemeOptions = {}): ThemeConfig {
  const subtleFill = mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
  const tagFill = mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  const radius = opts.buttonRadius ?? 6;
  const radiusLG = opts.cardRadius ?? 12;
  return {
    algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorBgBase: p.void,
      colorBgContainer: p.carbon,
      colorBgElevated: p.obsidian,
      colorBorder: p.graphite,
      colorBorderSecondary: p.graphite,
      colorText: p.mist,
      colorTextSecondary: p.fog,
      colorTextTertiary: p.ash,
      colorPrimary: p.lime,
      colorTextLightSolid: opts.primaryText ?? p.void,
      colorError: p.coral,
      colorSuccess: p.green,
      colorWarning: p.amber,
      colorInfo: p.teal,
      borderRadius: radius,
      borderRadiusLG: radiusLG,
      fontFamily: "var(--font-ui)",
      fontSize: 13,
      controlHeight: 32,
      controlHeightSM: 26,
      lineHeight: 1.5,
      wireframe: false,
    },
    components: {
      Button: {
        primaryShadow: "none",
        defaultBg: "transparent",
        defaultBorderColor: p.graphite,
        fontWeight: opts.buttonWeight ?? 400,
        paddingInline: 12,
      },
      Table: {
        headerBg: p.carbon,
        headerColor: p.fog,
        headerSplitColor: "transparent",
        rowHoverBg: p.obsidian,
        rowSelectedBg: "transparent",
        rowSelectedHoverBg: p.obsidian,
        borderColor: p.graphite,
        headerBorderRadius: Math.min(radiusLG, 8),
        cellPaddingBlock: 10,
        cellPaddingInline: 12,
      },
      Input: {
        colorBgContainer: subtleFill,
        activeBorderColor: p.mist,
        hoverBorderColor: p.smoke,
        activeShadow: "none",
      },
      Select: {
        colorBgContainer: subtleFill,
        optionSelectedBg: p.graphite,
      },
      Modal: {
        contentBg: p.carbon,
        headerBg: p.carbon,
        titleColor: p.paper,
      },
      Drawer: {
        colorBgElevated: p.carbon,
      },
      Descriptions: {
        labelBg: "transparent",
        titleColor: p.paper,
      },
      Tabs: {
        itemColor: p.fog,
        itemSelectedColor: p.paper,
        inkBarColor: p.lime,
      },
      Progress: {
        defaultColor: p.lime,
      },
      Tag: {
        defaultBg: tagFill,
        defaultColor: p.fog,
      },
      Segmented: {
        itemSelectedBg: p.graphite,
        itemColor: p.fog,
        itemSelectedColor: p.paper,
      },
      Divider: {
        colorSplit: p.graphite,
      },
      Tooltip: {
        colorBgSpotlight: p.graphite,
        colorTextLightSolid: p.bone,
      },
      Tree: {
        nodeHoverBg: p.obsidian,
        nodeSelectedBg: p.graphite,
        titleHeight: 26,
        indentSize: 14,
      },
    },
  };
}

const linearPalette: ThemePalette = {
  void: "#08090a",
  carbon: "#0f1011",
  obsidian: "#161718",
  graphite: "#23252a",
  smoke: "#383b3f",
  ash: "#62666d",
  fog: "#8a8f98",
  mist: "#d0d6e0",
  bone: "#e5e5e6",
  paper: "#ffffff",
  lime: "#e4f222",
  green: "#27a644",
  coral: "#eb5757",
  teal: "#02b8cc",
  violet: "#6366f1",
  lav: "#8b5cf6",
  amber: "#d9a441",
};

/**
 * Linear-inspired "midnight precision instrument" theme.
 * Tokens mirror DESIGN.md.
 */
export const linearTheme: AppTheme = {
  id: "linear",
  name: "Linear",
  description: "Midnight precision instrument",
  mode: "dark",
  palette: linearPalette,
  swatches: ["#08090a", "#e4f222", "#d0d6e0"],
  antd: buildAntdTheme("dark", linearPalette),
};

const auroraPalette: ThemePalette = {
  void: "#070b14",
  carbon: "#0c1222",
  obsidian: "#131c33",
  graphite: "#1f2d4d",
  smoke: "#314570",
  ash: "#6b7fa8",
  fog: "#94a7cc",
  mist: "#d8e4ff",
  bone: "#eef4ff",
  paper: "#ffffff",
  lime: "#0080ff",
  green: "#10b981",
  coral: "#ff4d6d",
  teal: "#00ffff",
  violet: "#7c5cff",
  lav: "#ff1493",
  amber: "#f59e0b",
};

/**
 * Aurora UI theme inspired by Northern Lights mesh gradients
 * (prototypes/aurora.md: Electric Blue #0080FF, Magenta #FF1493, Cyan #00FFFF).
 */
export const auroraTheme: AppTheme = {
  id: "aurora",
  name: "Aurora",
  description: "Northern Lights mesh gradients & electric accents",
  mode: "dark",
  palette: auroraPalette,
  swatches: ["#0080ff", "#ff1493", "#00ffff"],
  antd: buildAntdTheme("dark", auroraPalette, {
    primaryText: "#ffffff",
    buttonRadius: 10,
    cardRadius: 12,
    buttonWeight: 600,
  }),
};

const highPerformancePalette: ThemePalette = {
  void: "#0a0b0d",
  carbon: "#121418",
  obsidian: "#1b1f26",
  graphite: "#2b313b",
  smoke: "#3d4654",
  ash: "#737d8c",
  fog: "#a0aab8",
  mist: "#d8dee8",
  bone: "#eef2f6",
  paper: "#ffffff",
  lime: "#ed1c24",
  green: "#00e676",
  coral: "#ff5252",
  teal: "#00bfff",
  violet: "#5c6bc0",
  lav: "#90a4ae",
  amber: "#ffab00",
};

/**
 * High Performance Computing theme (prototypes/Alta Performance.md:
 * Performance Red #ED1C24, Electric Blue #00BFFF, Silver #C0C0C0).
 */
export const highPerformanceTheme: AppTheme = {
  id: "high-performance",
  name: "Alta Performance",
  description: "Server silicon telemetry with performance red & electric blue",
  mode: "dark",
  palette: highPerformancePalette,
  swatches: ["#ed1c24", "#00bfff", "#c0c0c0"],
  antd: buildAntdTheme("dark", highPerformancePalette, {
    primaryText: "#ffffff",
    buttonRadius: 8,
    cardRadius: 8,
    buttonWeight: 600,
  }),
};

const continuousCommercePalette: ThemePalette = {
  void: "#f3f5f7",
  carbon: "#ffffff",
  obsidian: "#eaeded",
  graphite: "#d5dbdb",
  smoke: "#aeb6bf",
  ash: "#687078",
  fog: "#414d5c",
  mist: "#232f3e",
  bone: "#161e2d",
  paper: "#0f141a",
  lime: "#ff9900",
  green: "#008000",
  coral: "#d13212",
  teal: "#00a8e1",
  violet: "#527fff",
  lav: "#8c6eff",
  amber: "#d49b00",
};

/**
 * Continuous Commerce theme (prototypes/Compra Contínua.md:
 * Retail Orange #FF9900, Dark Slate #232F3E, Teal #00A8E1, 3px radius).
 */
export const continuousCommerceTheme: AppTheme = {
  id: "continuous-commerce",
  name: "Compra Contínua",
  description: "Trustworthy retail workspace with warm orange & slate navy",
  mode: "light",
  palette: continuousCommercePalette,
  swatches: ["#ff9900", "#232f3e", "#00a8e1"],
  antd: buildAntdTheme("light", continuousCommercePalette, {
    primaryText: "#232f3e",
    buttonRadius: 3,
    cardRadius: 4,
    buttonWeight: 600,
  }),
};

const immersiveEntertainmentPalette: ThemePalette = {
  void: "#0b0b0e",
  carbon: "#141419",
  obsidian: "#1e1e26",
  graphite: "#2c2c38",
  smoke: "#424254",
  ash: "#727287",
  fog: "#a3a3b5",
  mist: "#dedee8",
  bone: "#f2f2f7",
  paper: "#ffffff",
  lime: "#e50914",
  green: "#2ecc71",
  coral: "#ff4757",
  teal: "#3b82f6",
  violet: "#800080",
  lav: "#a855f7",
  amber: "#ffd700",
};

/**
 * Immersive Entertainment theme (prototypes/Estilo de Entretenimento Imersivo.md:
 * Streaming Red #E50914, Gold #FFD700, Purple #800080).
 */
export const immersiveEntertainmentTheme: AppTheme = {
  id: "immersive-entertainment",
  name: "Entretenimento Imersivo",
  description: "Cinematic dark theater with streaming red & gold highlights",
  mode: "dark",
  palette: immersiveEntertainmentPalette,
  swatches: ["#e50914", "#ffd700", "#800080"],
  antd: buildAntdTheme("dark", immersiveEntertainmentPalette, {
    primaryText: "#ffffff",
    buttonRadius: 8,
    cardRadius: 8,
    buttonWeight: 600,
  }),
};

const flatDesignPalette: ThemePalette = {
  void: "#f8f9fa",
  carbon: "#ffffff",
  obsidian: "#eef1f4",
  graphite: "#dee2e6",
  smoke: "#adb5bd",
  ash: "#6c757d",
  fog: "#495057",
  mist: "#343a40",
  bone: "#212529",
  paper: "#16191c",
  lime: "#007bff",
  green: "#28a745",
  coral: "#dc3545",
  teal: "#17a2b8",
  violet: "#6610f2",
  lav: "#6f42c1",
  amber: "#d99b00",
};

/**
 * Corporate Flat Design theme (prototypes/Flat Design.md:
 * Corporate Blue #007BFF, Dark Grey #343A40, Light Grey #F8F9FA, 4px radius).
 */
export const flatDesignTheme: AppTheme = {
  id: "flat-design",
  name: "Flat Design",
  description: "Clean corporate geometry with solid semantic colors",
  mode: "light",
  palette: flatDesignPalette,
  swatches: ["#007bff", "#28a745", "#ffc107"],
  antd: buildAntdTheme("light", flatDesignPalette, {
    primaryText: "#ffffff",
    buttonRadius: 4,
    cardRadius: 4,
    buttonWeight: 600,
  }),
};

const liquidGlassPalette: ThemePalette = {
  void: "#0c101c",
  carbon: "#151d30",
  obsidian: "#1f2a44",
  graphite: "#2e3d5e",
  smoke: "#445985",
  ash: "#788cb8",
  fog: "#a3b4db",
  mist: "#dce6fa",
  bone: "#f0f4ff",
  paper: "#ffffff",
  lime: "#0066ff",
  green: "#2dd4bf",
  coral: "#fb7185",
  teal: "#38bdf8",
  violet: "#818cf8",
  lav: "#c084fc",
  amber: "#fbbf24",
};

/**
 * Liquid Glass theme (prototypes/Liquid Glass.md:
 * Translucent fluid glass, #0066FF tertiary accent, 12px radius).
 */
export const liquidGlassTheme: AppTheme = {
  id: "liquid-glass",
  name: "Liquid Glass",
  description: "Translucent refractive glass with iridescent highlights",
  mode: "dark",
  palette: liquidGlassPalette,
  swatches: ["#0066ff", "#38bdf8", "#c084fc"],
  antd: buildAntdTheme("dark", liquidGlassPalette, {
    primaryText: "#ffffff",
    buttonRadius: 12,
    cardRadius: 12,
    buttonWeight: 600,
  }),
};

const memphisPalette: ThemePalette = {
  void: "#18192c",
  carbon: "#21233c",
  obsidian: "#2b2e4d",
  graphite: "#3e436e",
  smoke: "#6a7bb4",
  ash: "#8d99c9",
  fog: "#b4bee3",
  mist: "#e6e9f8",
  bone: "#f5f6fc",
  paper: "#ffffff",
  lime: "#ff71ce",
  green: "#86ccca",
  coral: "#ff5c77",
  teal: "#86ccca",
  violet: "#6a7bb4",
  lav: "#b983ff",
  amber: "#ffce5c",
};

/**
 * Memphis Design theme (prototypes/memphis.md:
 * Pink #FF71CE, Yellow #FFCE5C, Mint #86CCCA, Periwinkle #6A7BB4).
 */
export const memphisTheme: AppTheme = {
  id: "memphis",
  name: "Memphis",
  description: "1980s postmodern geometry with bold pastel-neon contrasts",
  mode: "dark",
  palette: memphisPalette,
  swatches: ["#ff71ce", "#ffce5c", "#86ccca"],
  antd: buildAntdTheme("dark", memphisPalette, {
    primaryText: "#18192c",
    buttonRadius: 8,
    cardRadius: 8,
    buttonWeight: 600,
  }),
};

const swissMinimalPalette: ThemePalette = {
  void: "#f5f1e8",
  carbon: "#ffffff",
  obsidian: "#ebe5d8",
  graphite: "#d4cdc0",
  smoke: "#808080",
  ash: "#6e6a63",
  fog: "#4a4742",
  mist: "#1f1e1c",
  bone: "#141413",
  paper: "#141413",
  lime: "#141413",
  green: "#2d6a4f",
  coral: "#c1121f",
  teal: "#457b9d",
  violet: "#5e548e",
  lav: "#b38b6d",
  amber: "#b38b6d",
};

/**
 * Minimalism & Swiss Style theme (prototypes/Minimalism & Swiss Style.md:
 * Warm Beige #F5F1E8, White #FFFFFF, Taupe #B38B6D, sharp 0px edges).
 */
export const swissMinimalTheme: AppTheme = {
  id: "swiss-minimal",
  name: "Minimalism & Swiss",
  description: "Objective mathematical grid with sharp edges & warm paper",
  mode: "light",
  palette: swissMinimalPalette,
  swatches: ["#141413", "#f5f1e8", "#b38b6d"],
  antd: buildAntdTheme("light", swissMinimalPalette, {
    primaryText: "#ffffff",
    buttonRadius: 0,
    cardRadius: 0,
    buttonWeight: 600,
  }),
};

const origamiPalette: ThemePalette = {
  void: "#f2f0ec",
  carbon: "#fafafa",
  obsidian: "#e7e4de",
  graphite: "#d2cec6",
  smoke: "#b0b0b0",
  ash: "#6e6e6e",
  fog: "#4a4a4a",
  mist: "#262626",
  bone: "#1a1a1a",
  paper: "#1a1a1a",
  lime: "#ff6b6b",
  green: "#3b9c6e",
  coral: "#e04848",
  teal: "#3898c4",
  violet: "#6c7a89",
  lav: "#87ceeb",
  amber: "#d49a3d",
};

/**
 * Origami Geométrico theme (prototypes/Origami Geométrico.md:
 * Paper White #FAFAFA, Ink #1A1A1A, Coral #FF6B6B, Sky Fold #87CEEB, Sage #A8D5BA, 0px corners).
 */
export const origamiTheme: AppTheme = {
  id: "origami",
  name: "Origami Geométrico",
  description: "Folded paper geometry with coral, sky fold & sage accents",
  mode: "light",
  palette: origamiPalette,
  swatches: ["#ff6b6b", "#87ceeb", "#a8d5ba"],
  antd: buildAntdTheme("light", origamiPalette, {
    primaryText: "#ffffff",
    buttonRadius: 0,
    cardRadius: 0,
    buttonWeight: 600,
  }),
};

const flip7Palette: ThemePalette = {
  void: "#eff8f7",
  carbon: "#ffffff",
  obsidian: "#e8f6f5",
  graphite: "#c8e6e4",
  smoke: "#96ccc8",
  ash: "#5f8583",
  fog: "#385c5a",
  mist: "#163836",
  bone: "#0f2927",
  paper: "#0a1f1e",
  lime: "#2ba8a2",
  green: "#27ae60",
  coral: "#ef6c4a",
  teal: "#5dade2",
  violet: "#1e8c86",
  lav: "#ff8a6a",
  amber: "#e6b800",
};

/**
 * Flip7 Card Game theme (prototypes/flip7-card-game.md:
 * Primary Teal #2BA8A2, Accent Gold #FFD23F, Coral #EF6C4A, Surface Base #EFF8F7).
 */
export const flip7Theme: AppTheme = {
  id: "flip7",
  name: "Flip7",
  description: "Retro-playful card game palette with teal, gold & coral",
  mode: "light",
  palette: flip7Palette,
  swatches: ["#2ba8a2", "#ffd23f", "#ef6c4a"],
  antd: buildAntdTheme("light", flip7Palette, {
    primaryText: "#ffffff",
    buttonRadius: 16,
    cardRadius: 12,
    buttonWeight: 700,
  }),
};

const genesisPalette: ThemePalette = {
  void: "#fafafa",
  carbon: "#ffffff",
  obsidian: "#f3f3f6",
  graphite: "#e8e8ec",
  smoke: "#d1d1d8",
  ash: "#9c9c9c",
  fog: "#6b6b6b",
  mist: "#0a0a0a",
  bone: "#0a0a0a",
  paper: "#0a0a0a",
  lime: "#6366f1",
  green: "#10b981",
  coral: "#ef4444",
  teal: "#4f46e5",
  violet: "#6366f1",
  lav: "#20970b",
  amber: "#f59e0b",
};

/**
 * Genesis theme (prototypes/genesis.md:
 * Indigo #6366F1, Near-Black #0A0A0A, Warm Gray #FAFAFA, Border #E8E8EC, 6px/12px radius).
 */
export const genesisTheme: AppTheme = {
  id: "genesis",
  name: "Genesis",
  description: "Editorial precision gallery surfaces with indigo highlights",
  mode: "light",
  palette: genesisPalette,
  swatches: ["#6366f1", "#0a0a0a", "#20970b"],
  antd: buildAntdTheme("light", genesisPalette, {
    primaryText: "#ffffff",
    buttonRadius: 6,
    cardRadius: 12,
    buttonWeight: 500,
  }),
};

export const THEMES: readonly AppTheme[] = [
  highPerformanceTheme,
  auroraTheme,
  continuousCommerceTheme,
  immersiveEntertainmentTheme,
  flatDesignTheme,
  flip7Theme,
  genesisTheme,
  linearTheme,
  liquidGlassTheme,
  memphisTheme,
  swissMinimalTheme,
  origamiTheme,
].sort((a, b) => a.name.localeCompare(b.name));

export const antdTheme: ThemeConfig = linearTheme.antd;

export function getTheme(id: ThemeId): AppTheme {
  return THEMES.find((t) => t.id === id) ?? linearTheme;
}

interface ThemeContextValue {
  themeId: ThemeId;
  theme: AppTheme;
  setThemeId: (next: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  theme: linearTheme,
  setThemeId: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = usePersistentState("theme", ThemeIdSchema, DEFAULT_THEME_ID);
  const currentTheme = useMemo(() => getTheme(themeId), [themeId]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = currentTheme.id;
    root.style.colorScheme = currentTheme.mode;
    for (const [key, value] of Object.entries(currentTheme.palette)) {
      root.style.setProperty(`--${key}`, value);
    }
  }, [currentTheme]);

  const value = useMemo(
    () => ({ themeId, theme: currentTheme, setThemeId }),
    [themeId, currentTheme, setThemeId],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
