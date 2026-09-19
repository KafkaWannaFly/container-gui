import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMount, useUnmount } from "ahooks";
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
  const unlisteners = useRef<UnlistenFn[]>([]);
  const disposed = useRef(false);
  const lastStandby = useRef<string | null>(null);

  useMount(() => {
    void (async () => {
      const eventUnlisten = await listen<unknown>("docker://event", (event) => {
        const parsed = DockerEventSchema.safeParse(event.payload);
        if (!parsed.success) return;
        switch (parsed.data.resourceType) {
          case "container":
            void queryClient.invalidateQueries({ queryKey: ["containers"] });
            void queryClient.invalidateQueries({ queryKey: ["system-info"] });
            break;
          case "volume":
            void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
            break;
          case "image":
            void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
            break;
        }
      });

      const statusUnlisten = await listen<unknown>("docker://status", (event) => {
        const parsed = DockerStatusSchema.safeParse(event.payload);
        if (!parsed.success) return;
        const status = parsed.data;
        queryClient.setQueryData(queryKeys.status(), status);
        if (status.state === "standby" || status.state === "error") {
          if (lastStandby.current !== status.message) {
            lastStandby.current = status.message;
            notification.error({
              message: "Docker engine unreachable",
              description: status.message ?? "Retrying in the background…",
              placement: "bottomRight",
            });
          }
        } else if (status.state === "connected") {
          lastStandby.current = null;
        }
      });

      if (disposed.current) {
        eventUnlisten();
        statusUnlisten();
      } else {
        unlisteners.current.push(eventUnlisten, statusUnlisten);
      }
    })();
  });

  useUnmount(() => {
    disposed.current = true;
    unlisteners.current.forEach((unlisten) => unlisten());
    unlisteners.current = [];
  });
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
