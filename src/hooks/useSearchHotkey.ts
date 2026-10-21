import { useHotkey } from "@tanstack/react-hotkeys";
import type { InputRef } from "antd";
import { useRef } from "react";

/**
 * Registers `Mod+F` (`Ctrl+F` on Windows/Linux, `Cmd+F` on macOS) while the
 * owning component is mounted, focusing and selecting the bound search `<Input>`.
 */
export function useSearchHotkey() {
  const ref = useRef<InputRef>(null);
  useHotkey(
    "Mod+F",
    () => {
      if (document.activeElement?.closest(".xterm")) return;
      ref.current?.focus({ cursor: "all" });
    },
    { requireReset: true, conflictBehavior: "allow" },
  );
  return ref;
}
