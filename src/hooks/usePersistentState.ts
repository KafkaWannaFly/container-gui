import { useCallback, useState } from "react";
import type { z } from "zod";

const PREFIX = "cgui:";

function read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/**
 * `useState` backed by localStorage. Stored values are validated with
 * `schema`, so a stale or hand-edited entry falls back to `fallback`
 * instead of crashing the view.
 */
export function usePersistentState<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState(() => read(key, schema, fallback));

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(resolved));
        } catch {
          // Storage full or unavailable: keep the in-memory value.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
