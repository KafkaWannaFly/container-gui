import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { App, Button } from "antd";
import { useCallback } from "react";
import { toError } from "../services/tauriApi";

/**
 * Ask the user where to save `defaultName`, run `write` with that path, and
 * report the result with a shortcut to reveal it in the file manager.
 * A cancelled dialog is silent.
 */
export function useSaveFile() {
  const { message } = App.useApp();
  return useCallback(
    async (defaultName: string, write: (dest: string) => Promise<string>) => {
      let dest: string | null;
      try {
        dest = await save({ defaultPath: defaultName });
      } catch (err) {
        message.error(toError(err).message);
        return;
      }
      if (!dest) return;
      const key = "save-file";
      message.loading({ key, content: "Saving…", duration: 0 });
      try {
        const path = await write(dest);
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
