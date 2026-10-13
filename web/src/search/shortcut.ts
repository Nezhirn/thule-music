import { useEffect } from "react";
import { useNavigate } from "react-router";

/** What the search page reads from its address state: open with the field in focus. */
export interface SearchState {
  focusSearch?: boolean;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "range", "submit", "reset"].includes(target.type)
  );
}

/** "/" or Ctrl+K (⌘K) goes to the search field from anywhere: focuses it on the search
 * page, opens the page otherwise. Not while typing elsewhere or in a dialog. Keys by their
 * place too, so they work in other keyboard layouts ("/" is "." in the Russian one). */
export function useSearchShortcut() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const slash =
        (event.key === "/" || (event.code === "Slash" && !event.shiftKey)) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey;
      const k =
        (event.key.toLowerCase() === "k" || event.code === "KeyK") &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey;
      if (!slash && !k) return;
      const field = document.querySelector<HTMLInputElement>("[data-search-field]");
      if (typing(event.target) && event.target !== field) return;
      if (document.querySelector("dialog[open]")) return;
      if (slash && event.target === field) return;
      event.preventDefault();
      if (field) {
        field.focus();
        field.select();
        return;
      }
      const state: SearchState = { focusSearch: true };
      void navigate("/search", { state });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
}
