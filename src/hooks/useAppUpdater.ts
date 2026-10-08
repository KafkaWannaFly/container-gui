import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useState } from "react";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "installing"
  | "error";

/**
 * Drives the Tauri updater: check the GitHub `latest.json` endpoint, then
 * download, install and relaunch. On Windows the NSIS installer closes the
 * app itself during `install`, so `relaunch` only runs on other platforms.
 */
export function useAppUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    setStatus("checking");
    setError(null);
    try {
      const found = await check();
      setUpdate(found);
      setStatus(found ? "available" : "up-to-date");
      return found;
    } catch (err) {
      setError(String(err));
      setStatus("error");
      return null;
    }
  }, []);

  const installUpdate = useCallback(
    async (target?: Update) => {
      const pending = target ?? update;
      if (!pending) return;
      setStatus("downloading");
      setError(null);
      setPercent(null);
      let total = 0;
      let received = 0;
      try {
        await pending.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
            setPercent(total ? 0 : null);
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            if (total) setPercent(Math.min(100, Math.round((received / total) * 100)));
          } else {
            setStatus("installing");
          }
        });
        await relaunch();
      } catch (err) {
        setError(String(err));
        setStatus("error");
      }
    },
    [update],
  );

  return { status, update, percent, error, checkForUpdate, installUpdate };
}
