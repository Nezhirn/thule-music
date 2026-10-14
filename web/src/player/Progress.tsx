import { useCallback, useState } from "react";
import { duration as clock } from "../catalog/format";
import { useI18n } from "../i18n";
import { Slider } from "../ui/Slider";
import { usePlayer, usePlayerControls } from "./context";
import { currentItem } from "./queue";
import styles from "./Progress.module.css";

/** Where the track is: the time, a slider to seek with, the length. */
export function Progress() {
  const { t } = useI18n();
  const player = usePlayerControls();
  const position = usePlayer((state) => state.position);
  const length = usePlayer((state) => state.duration);
  const loaded = usePlayer((state) => state.queue.current !== -1);
  const key = usePlayer((state) => currentItem(state.queue)?.key);
  // Where the thumb is while it is dragged, for the track it was dragged on; the track seeks
  // once it is let go.
  const [scrub, setScrub] = useState<{ key?: string; at: number } | null>(null);
  const shown = Math.min(scrub && scrub.key === key ? scrub.at : position, length);
  const commit = useCallback(
    (seconds: number) => {
      player.seek(seconds);
      setScrub(null);
    },
    [player],
  );
  const input = useCallback((at: number) => setScrub({ key, at }), [key]);
  return (
    <div className={styles.progress}>
      <span className={styles.time}>{clock(shown * 1000)}</span>
      <Slider
        label={t.player.position}
        value={shown}
        max={Math.floor(length)}
        valueText={t.player.positionText(clock(shown * 1000), clock(length * 1000))}
        disabled={!loaded}
        onInput={input}
        onCommit={commit}
      />
      <span className={styles.time}>{clock(length * 1000)}</span>
    </div>
  );
}
