import { useCallback, useState } from "react";
import { duration as clock } from "../catalog/format";
import { useI18n } from "../i18n";
import { Slider } from "../ui/Slider";
import { usePlayer, usePlayerControls } from "./context";
import styles from "./Progress.module.css";

/** Where the track is: the time, a slider to seek with, the length. */
export function Progress() {
  const { t } = useI18n();
  const player = usePlayerControls();
  const position = usePlayer((state) => state.position);
  const length = usePlayer((state) => state.duration);
  const loaded = usePlayer((state) => state.queue.current !== -1);
  // Where the thumb is while it is dragged; the track seeks once it is let go.
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = Math.min(scrub ?? position, length);
  const commit = useCallback(
    (seconds: number) => {
      player.seek(seconds);
      setScrub(null);
    },
    [player],
  );
  return (
    <div className={styles.progress}>
      <span className={styles.time}>{clock(shown * 1000)}</span>
      <Slider
        label={t.player.position}
        value={shown}
        max={Math.floor(length)}
        valueText={t.player.positionText(clock(shown * 1000), clock(length * 1000))}
        disabled={!loaded}
        onInput={setScrub}
        onCommit={commit}
      />
      <span className={styles.time}>{clock(length * 1000)}</span>
    </div>
  );
}
