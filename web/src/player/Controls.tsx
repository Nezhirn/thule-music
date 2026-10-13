import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import { usePlayer, usePlayerControls } from "./context";
import type { Repeat as RepeatMode } from "./player";
import styles from "./Controls.module.css";

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

/** Shuffle, previous, play/pause, next, repeat. `large` on the phone's full player. */
export function Controls({ large }: { large?: boolean }) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const playing = usePlayer((state) => state.playing);
  const shuffle = usePlayer((state) => state.queue.unshuffled !== null);
  const repeat = usePlayer((state) => state.repeat);
  const loaded = usePlayer((state) => state.queue.current !== -1);
  const hasNext = usePlayer(
    (state) => state.queue.current < state.queue.items.length - 1 || state.repeat !== "off",
  );
  const side = large ? "md" : "sm";
  const skip = large ? "lg" : "md";
  return (
    <div className={`${styles.controls} ${large ? styles.large : ""}`}>
      <IconButton
        icon={Shuffle}
        label={t.player.shuffle}
        size={side}
        aria-pressed={shuffle}
        className={styles.toggle}
        disabled={!loaded}
        onClick={() => player.setShuffle(!shuffle)}
      />
      <IconButton
        icon={SkipBack}
        label={t.player.previous}
        size={skip}
        className={styles.skip}
        disabled={!loaded}
        onClick={() => player.previous()}
      />
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? t.player.pause : t.player.play}
        size="lg"
        primary
        className={`${styles.play} ${large ? styles.playLarge : ""}`}
        disabled={!loaded}
        onClick={() => player.toggle()}
      />
      <IconButton
        icon={SkipForward}
        label={t.player.next}
        size={skip}
        className={styles.skip}
        disabled={!hasNext}
        onClick={() => player.next()}
      />
      <IconButton
        icon={repeat === "one" ? Repeat1 : Repeat}
        label={t.player.repeat[repeat]}
        size={side}
        className={styles.toggle}
        data-active={repeat !== "off" || undefined}
        disabled={!loaded}
        onClick={() => player.setRepeat(NEXT_REPEAT[repeat])}
      />
    </div>
  );
}
