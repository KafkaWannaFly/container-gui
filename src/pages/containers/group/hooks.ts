import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { queryKeys } from "../../../lib/queryClient";
import { inspectContainer, inspectImage } from "../../../services/tauriApi";
import type { ContainerInspect, ContainerSummary, ImageInspect } from "../../../types/docker";

/** Inspect every project container once when `enabled`; shared across tabs via the query cache. */
export function useInspects(containers: ContainerSummary[], enabled = true): Map<string, ContainerInspect> {
  const results = useQueries({
    queries: containers.map((ctr) => ({
      queryKey: queryKeys.containerInspect(ctr.id),
      queryFn: () => inspectContainer(ctr.id),
      enabled,
      staleTime: 15_000,
    })),
  });
  return useMemo(() => {
    const map = new Map<string, ContainerInspect>();
    results.forEach((result, index) => {
      if (result.data) map.set(containers[index].id, result.data);
    });
    return map;
  }, [results, containers]);
}

/** Inspect each distinct image once when `enabled`, for env-source inference. */
export function useImages(
  inspects: Map<string, ContainerInspect>,
  enabled = true,
): Map<string, ImageInspect> {
  const refs = useMemo(
    () => [...new Set([...inspects.values()].map((ctr) => ctr.Image).filter(Boolean))] as string[],
    [inspects],
  );
  const results = useQueries({
    queries: refs.map((ref) => ({
      queryKey: queryKeys.imageInspect(ref),
      queryFn: () => inspectImage(ref),
      enabled,
      staleTime: 60_000,
    })),
  });
  return useMemo(() => {
    const map = new Map<string, ImageInspect>();
    results.forEach((result, index) => {
      if (result.data) map.set(refs[index], result.data);
    });
    return map;
  }, [results, refs]);
}
