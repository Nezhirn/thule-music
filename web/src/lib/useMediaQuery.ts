import { useCallback, useSyncExternalStore } from "react";

/** The layout for phones (the CSS's breakpoint): tabs at the bottom, the mini player. */
export const PHONE = "(max-width: 899px)";

/** Whether the media query matches, following changes (a window resized, a phone turned). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
