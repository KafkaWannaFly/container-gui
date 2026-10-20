import { useLocalStorageState } from "ahooks";
import type { z } from "zod";

const PREFIX = "cgui:";

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
  const [value, setValue] = useLocalStorageState<T>(PREFIX + key, {
    defaultValue: fallback,
    deserializer: (raw) => schema.parse(JSON.parse(raw)),
  });
  return [value as T, (next) => setValue((prev) => (next instanceof Function ? next(prev as T) : next))];
}
