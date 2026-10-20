import { useMutation, useQuery } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useMemoizedFn } from "ahooks";
import { useState } from "react";
import { queryKeys } from "../lib/queryClient";

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
 * The check is a manual query, so every consumer shares its result.
 */
export function useAppUpdater() {
  const [percent, setPercent] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);

  const checkQuery = useQuery({
    queryKey: queryKeys.updaterCheck(),
    queryFn: () => check(),
    enabled: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const update = checkQuery.data ?? null;

  const install = useMutation({
    mutationFn: async (target: Update) => {
      setPercent(null);
      setInstalling(false);
      let total = 0;
      let received = 0;
      await target.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setPercent(total ? 0 : null);
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total) setPercent(Math.min(100, Math.round((received / total) * 100)));
        } else {
          setInstalling(true);
        }
      });
      await relaunch();
    },
  });

  let status: UpdaterStatus = "idle";
  if (install.isPending) status = installing ? "installing" : "downloading";
  else if (checkQuery.isFetching) status = "checking";
  else if (install.isError || checkQuery.isError) status = "error";
  else if (update) status = "available";
  else if (checkQuery.data === null) status = "up-to-date";

  const failure = install.error ?? checkQuery.error;

  const checkForUpdate = useMemoizedFn(async () => {
    install.reset();
    return (await checkQuery.refetch()).data ?? null;
  });

  const installUpdate = useMemoizedFn(async (target?: Update) => {
    const pending = target ?? update;
    if (pending) await install.mutateAsync(pending).catch(() => {});
  });

  return {
    status,
    update,
    percent,
    error: failure ? String(failure) : null,
    checkForUpdate,
    installUpdate,
  };
}
