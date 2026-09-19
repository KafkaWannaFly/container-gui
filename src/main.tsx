import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole, debug, error, info, trace, warn } from "@tauri-apps/plugin-log";
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
    const original = console[name];
    console[name] = (...args: unknown[]) => {
      original(...args);
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
