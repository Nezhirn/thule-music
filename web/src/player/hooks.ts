import { useEffect } from "react";
import { useI18n } from "../i18n";
import { announce } from "../ui/toast";
import { usePlayer, usePlayerControls } from "./context";

/** Space plays and pauses, unless something focused takes it (a button, a field) or nothing
 * is in the player. */
export function useSpaceToPlay() {
  const player = usePlayerControls();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target !== document.body && target.id !== "content") return;
      if (player.store.getState().queue.current === -1) return;
      event.preventDefault();
      if (!event.repeat) player.toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [player]);
}

/** Says when a track couldn't be played (and was skipped). */
export function useFailureNotice() {
  const { t } = useI18n();
  const failed = usePlayer((state) => state.failed);
  useEffect(() => {
    if (failed) announce(t.player.failed(failed.title));
  }, [failed, t]);
}
