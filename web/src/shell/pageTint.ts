import { createContext, useContext, useEffect } from "react";

/** Sets the colour that tints the top of the content panel (null: none). */
export const PageTintContext = createContext<(color: string | null) => void>(() => {});

/** Tints the top of the content panel while the calling page is shown: the colours of the
 * album or artist it is about. */
export function usePageTint(color: string | null) {
  const setTint = useContext(PageTintContext);
  useEffect(() => {
    setTint(color);
    return () => setTint(null);
  }, [setTint, color]);
}
