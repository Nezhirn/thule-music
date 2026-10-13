import { Music } from "lucide-react";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import styles from "./NowPlaying.module.css";

/** The right column: the playing track with its cover, and the queue. Filled by the player
 * (stage 4); until then it says how to start. */
export function NowPlaying() {
  const { t } = useI18n();
  return (
    <aside className={`glass ${styles.aside}`} aria-labelledby="now-playing-title">
      <h2 id="now-playing-title" className={styles.title}>
        {t.player.nowPlaying}
      </h2>
      <EmptyState icon={Music} title={t.player.nothingPlaying}>
        {t.player.nowPlayingEmpty}
      </EmptyState>
      <h2 className={styles.title}>{t.player.upNext}</h2>
      <p className={styles.note}>{t.player.queueEmpty}</p>
    </aside>
  );
}
