import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  containers: (all = true) => ["containers", all] as const,
  containerStats: () => ["container-stats"] as const,
  metricsSeries: (ids: string[], maxPoints: number) => ["metrics-series", ids, maxPoints] as const,
  containerInspect: (id: string) => ["container-inspect", id] as const,
  composeProject: (workdir: string) => ["compose-project", workdir] as const,
  images: () => ["images"] as const,
  imageHistory: (ref: string) => ["image-history", ref] as const,
  imageInspect: (ref: string) => ["image-inspect", ref] as const,
  volumes: () => ["volumes"] as const,
  volumeDetail: (name: string) => ["volumes", name] as const,
  status: () => ["docker-status"] as const,
  system: () => ["system-info"] as const,
  contexts: () => ["docker-contexts"] as const,
  appInfo: () => ["app-info"] as const,
};
