import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { App, Button } from "antd";
import { useCallback } from "react";
import { toError } from "../services/tauriApi";

/**
 * Run a save-to-Downloads command and report where the file went, with a
 * shortcut to reveal it in the file manager.
 */
export function useSaveToDownloads() {
  const { message } = App.useApp();
  return useCallback(
    async (save: () => Promise<string>) => {
      const key = "save-to-downloads";
      message.loading({ key, content: "Saving…", duration: 0 });
      try {
        const path = await save();
        message.success({
          key,
          duration: 6,
          content: (
            <span>
              Saved to <span className="mono">{path}</span>
              <Button type="link" size="small" onClick={() => void revealItemInDir(path)}>
                Show in folder
              </Button>
            </span>
          ),
        });
      } catch (err) {
        message.error({ key, content: toError(err).message });
      }
    },
    [message],
  );
}
