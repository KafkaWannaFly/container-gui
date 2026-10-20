import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useLatest } from "ahooks";
import { App } from "antd";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { queryKeys } from "../lib/queryClient";
import { DockerEventSchema, DockerStatusSchema } from "../types/docker";

/**
 * Subscribe to a Tauri event for the lifetime of the component. Payloads that
 * fail `schema` are dropped. The handler is read through a ref, so changing it
 * never re-subscribes.
 */
export function useTauriEvent<T>(name: string, schema: z.ZodType<T>, handler: (payload: T) => void) {
  const latest = useLatest(handler);
  useEffect(() => {
    // Closure state, not refs: StrictMode mounts this effect twice in dev and
    // a shared `disposed` ref would make the second run unlisten itself.
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<unknown>(name, (event) => {
      const parsed = schema.safeParse(event.payload);
      if (parsed.success) latest.current(parsed.data);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name, schema, latest]);
}

/**
 * Bridges the backend Docker event stream into React Query cache
 * invalidation, and surfaces connection state changes as notifications.
 * `quiet` suppresses the standby notifications (e.g. on the Preferences page).
 */
export function useDockerEvents(quiet = false) {
  const queryClient = useQueryClient();
  const { notification } = App.useApp();
  const lastStandby = useRef<string | null>(null);

  useTauriEvent("docker://event", DockerEventSchema, (event) => {
    switch (event.resourceType) {
      case "container":
        void queryClient.invalidateQueries({ queryKey: queryKeys.containersPrefix() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.containerInspect(event.actorId) });
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

  useTauriEvent("docker://status", DockerStatusSchema, (status) => {
    queryClient.setQueryData(queryKeys.status(), status);
    if (status.state === "standby" || status.state === "error") {
      if (!quiet && lastStandby.current !== status.message) {
        lastStandby.current = status.message ?? null;
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
}

/** Increments each time the backend reports a (re)connection to the engine. */
export function useReconnectSignal(): number {
  const [signal, setSignal] = useState(0);
  useTauriEvent("docker://status", DockerStatusSchema, (status) => {
    if (status.state === "connected") setSignal((n) => n + 1);
  });
  return signal;
}
