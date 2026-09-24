import { attachConsole, debug, error, info, trace, warn } from "@tauri-apps/plugin-log";
import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/global.css";
import App from "./App";

if (import.meta.env.DEV) {
  // Mirror Rust logs into devtools and forward console.* into the log file.
  void attachConsole();
  const forward = (
    name: "log" | "debug" | "info" | "warn" | "error",
    logger: (message: string) => Promise<void>,
  ) => {
    // attachConsole mirrors Rust log entries back into console.*; forwarding
    // those again would echo console -> Rust -> console forever. Rust prefixes
    // its formatted lines with `[YYYY-MM-DD][`, so skip them.
    const mirrored = /^\[\d{4}-\d{2}-\d{2}\]\[/;
    const original = console[name];
    console[name] = (...args: unknown[]) => {
      original(...args);
      if (typeof args[0] === "string" && mirrored.test(args[0])) return;
      void logger(args.map(String).join(" "));
    };
  };
  forward("log", trace);
  forward("debug", debug);
  forward("info", info);
  forward("warn", warn);
  forward("error", error);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
