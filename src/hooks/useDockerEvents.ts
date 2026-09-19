import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { DockerEventSchema, DockerStatusSchema } from "../types/docker";
import { queryKeys } from "../lib/queryClient";

/**
 * Bridges the backend Docker event stream into React Query cache
 * invalidation, and surfaces connection state changes as notifications.
 */
export function useDockerEvents() {
  const queryClient = useQueryClient();
  const { notification } = App.useApp();

  useEffect(() => {
    // Closure state, not refs: StrictMode mounts this effect twice in dev and
    // a shared `disposed` ref would make the second run unlisten itself.
    let disposed = false;
    let unlisteners: UnlistenFn[] = [];
    let lastStandby: string | null = null;

    void (async () => {
      let eventUnlisten: UnlistenFn;
      try {
        eventUnlisten = await listen<unknown>("docker://event", (event) => {
          const parsed = DockerEventSchema.safeParse(event.payload);
          if (!parsed.success) return;
          switch (parsed.data.resourceType) {
            case "container":
              void queryClient.invalidateQueries({ queryKey: ["containers"] });
              void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
              break;
            case "volume":
              void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
              break;
            case "image":
              void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
              break;
          }
        });
      } catch {
        return;
      }

      let statusUnlisten: UnlistenFn;
      try {
        statusUnlisten = await listen<unknown>("docker://status", (event) => {
          const parsed = DockerStatusSchema.safeParse(event.payload);
          if (!parsed.success) return;
          const status = parsed.data;
          queryClient.setQueryData(queryKeys.status(), status);
          if (status.state === "standby" || status.state === "error") {
            if (lastStandby !== status.message) {
              lastStandby = status.message;
              notification.error({
                message: "Docker engine unreachable",
                description: status.message ?? "Retrying in the background…",
                placement: "bottomRight",
              });
            }
          } else if (status.state === "connected") {
            lastStandby = null;
          }
        });
      } catch {
        eventUnlisten();
        return;
      }

      if (disposed) {
        eventUnlisten();
        statusUnlisten();
      } else {
        unlisteners = [eventUnlisten, statusUnlisten];
      }
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => {
        unlisten();
      });
      unlisteners = [];
    };
  }, [queryClient, notification]);
}

/**
 * Tracks the latest connection status, seeded by polling and updated by
 * backend `docker://status` events.
 */
export function useReconnectSignal(): number {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<unknown>("docker://status", (event) => {
      const parsed = DockerStatusSchema.safeParse(event.payload);
      if (parsed.success && parsed.data.state === "connected") setSignal((n) => n + 1);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);
  return signal;
}
