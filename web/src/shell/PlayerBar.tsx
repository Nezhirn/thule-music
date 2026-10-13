import { Music, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import styles from "./PlayerBar.module.css";

/** The player along the bottom. The controls come alive with the player (stage 4). */
export function PlayerBar() {
  const { t } = useI18n();
  return (
    <section className={`glass ${styles.bar}`} aria-label={t.player.label}>
      <div className={styles.track}>
        <span className={styles.cover}>
          <Music />
        </span>
        <span className={styles.nothing}>{t.player.nothingPlaying}</span>
      </div>
      <div className={styles.center}>
        <div className={styles.controls}>
          <IconButton icon={Shuffle} label={t.player.shuffle} size="sm" disabled />
          <IconButton icon={SkipBack} label={t.player.previous} disabled />
          <IconButton icon={Play} label={t.player.play} size="lg" primary disabled />
          <IconButton icon={SkipForward} label={t.player.next} disabled />
          <IconButton icon={Repeat} label={t.player.repeat} size="sm" disabled />
        </div>
        <div className={styles.progress}>
          <span className={styles.time}>0:00</span>
          <input
            type="range"
            className={styles.range}
            aria-label={t.player.position}
            min={0}
            max={1}
            value={0}
            disabled
            readOnly
          />
          <span className={styles.time}>0:00</span>
        </div>
      </div>
      <div className={styles.volume}>
        <Volume2 className={styles.volumeIcon} />
        <input
          type="range"
          className={styles.range}
          aria-label={t.player.volume}
          min={0}
          max={1}
          value={1}
          disabled
          readOnly
        />
      </div>
    </section>
  );
}
