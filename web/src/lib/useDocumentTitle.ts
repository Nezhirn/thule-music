import { useEffect } from "react";

/** "Settings — Thule" in the tab and the history. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Thule`;
  }, [title]);
}
