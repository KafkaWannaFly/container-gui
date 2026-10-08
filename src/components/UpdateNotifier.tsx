import { App, Button, Progress } from "antd";
import { useEffect } from "react";
import { useAppUpdater } from "../hooks/useAppUpdater";

const KEY = "app-update";

/** Checks for a new release once at startup and offers a one-click install. */
export default function UpdateNotifier() {
  const { notification } = App.useApp();
  const { status, update, percent, error, checkForUpdate, installUpdate } = useAppUpdater();

  useEffect(() => {
    if (!import.meta.env.DEV) void checkForUpdate();
  }, [checkForUpdate]);

  useEffect(() => {
    if (!update) return;
    if (status === "available") {
      notification.info({
        key: KEY,
        duration: false,
        title: `Update ${update.version} available`,
        description: `You are on ${update.currentVersion}. The app restarts to finish installing.`,
        actions: (
          <Button type="primary" size="small" onClick={() => void installUpdate()}>
            Install & restart
          </Button>
        ),
      });
    } else if (status === "downloading" || status === "installing") {
      notification.info({
        key: KEY,
        duration: false,
        closable: false,
        title: status === "installing" ? `Installing ${update.version}…` : `Downloading ${update.version}…`,
        description: <Progress percent={percent ?? 0} status="active" showInfo={percent != null} />,
      });
    } else if (status === "error") {
      notification.error({ key: KEY, duration: false, title: "Update failed", description: error });
    }
  }, [notification, status, update, percent, error, installUpdate]);

  return null;
}
