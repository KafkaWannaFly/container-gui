import { theme, type ThemeConfig } from "antd";

/**
 * Linear-inspired "midnight precision instrument" theme.
 * Tokens mirror prototypes/index.html.
 */
export const antdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorBgBase: "#08090a",
    colorBgContainer: "#0f1011",
    colorBgElevated: "#161718",
    colorBorder: "#23252a",
    colorBorderSecondary: "#23252a",
    colorText: "#d0d6e0",
    colorTextSecondary: "#8a8f98",
    colorTextTertiary: "#62666d",
    colorPrimary: "#e4f222",
    colorTextLightSolid: "#08090a",
    colorError: "#eb5757",
    colorSuccess: "#27a644",
    colorWarning: "#d9a441",
    colorInfo: "#02b8cc",
    borderRadius: 6,
    borderRadiusLG: 12,
    fontFamily: "'Inter',system-ui,-apple-system,sans-serif",
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
      defaultBorderColor: "#23252a",
      fontWeight: 400,
      paddingInline: 12,
    },
    Table: {
      headerBg: "#0f1011",
      headerColor: "#8a8f98",
      headerSplitColor: "transparent",
      rowHoverBg: "#161718",
      rowSelectedBg: "transparent",
      rowSelectedHoverBg: "#161718",
      borderColor: "#23252a",
      headerBorderRadius: 8,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
    },
    Input: {
      colorBgContainer: "rgba(255,255,255,0.02)",
      activeBorderColor: "#d0d6e0",
      hoverBorderColor: "#383b3f",
      activeShadow: "none",
    },
    Select: {
      colorBgContainer: "rgba(255,255,255,0.02)",
      optionSelectedBg: "#23252a",
    },
    Modal: {
      contentBg: "#0f1011",
      headerBg: "#0f1011",
      titleColor: "#ffffff",
    },
    Drawer: {
      colorBgElevated: "#0f1011",
    },
    Descriptions: {
      labelBg: "transparent",
      titleColor: "#ffffff",
    },
    Tabs: {
      itemColor: "#8a8f98",
      itemSelectedColor: "#ffffff",
      inkBarColor: "#e4f222",
    },
    Progress: {
      defaultColor: "#e4f222",
    },
    Tag: {
      defaultBg: "rgba(255,255,255,0.05)",
      defaultColor: "#8a8f98",
    },
    Segmented: {
      itemSelectedBg: "#23252a",
      itemColor: "#8a8f98",
      itemSelectedColor: "#ffffff",
    },
    Divider: {
      colorSplit: "#23252a",
    },
  },
};
