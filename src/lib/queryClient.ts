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
  containerInspect: (id: string) => ["container-inspect", id] as const,
  images: () => ["images"] as const,
  imageHistory: (ref: string) => ["image-history", ref] as const,
  volumes: () => ["volumes"] as const,
  status: () => ["docker-status"] as const,
  system: () => ["system-info"] as const,
  contexts: () => ["docker-contexts"] as const,
};
