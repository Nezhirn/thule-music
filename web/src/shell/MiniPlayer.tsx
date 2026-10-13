import { Pause, Play } from "lucide-react";
import type { CSSProperties } from "react";
import { Cover } from "../catalog/Cover";
import { artistNames } from "../catalog/format";
import { useI18n } from "../i18n";
import { selectTrack, usePlayer, usePlayerControls } from "../player/context";
import { IconButton } from "../ui/IconButton";
import styles from "./MiniPlayer.module.css";

/** On phones, above the tabs while something is in the player: the track (opens the full
 * player), play/pause, and a thin line of the progress. */
export function MiniPlayer({ onOpen }: { onOpen(): void }) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const track = usePlayer(selectTrack);
  const playing = usePlayer((state) => state.playing);
  const progress = usePlayer((state) =>
    state.duration > 0 ? Math.min(state.position / state.duration, 1) : 0,
  );
  if (!track) return null;
  const artists = artistNames(track);
  return (
    <section className={`glass ${styles.mini}`} aria-label={t.player.label}>
      <button
        type="button"
        className={styles.open}
        aria-haspopup="dialog"
        aria-label={`${track.title}, ${artists}. ${t.player.openPlayer}`}
        onClick={onOpen}
      >
        <Cover id={track.cover_id} sizes="40px" className={styles.cover} />
        <span className={styles.titles}>
          <span className={styles.title}>{track.title}</span>
          <span className={styles.artist}>{artists}</span>
        </span>
      </button>
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? t.player.pause : t.player.play}
        className={styles.play}
        onClick={() => player.toggle()}
      />
      <span
        className={styles.line}
        style={{ "--progress": progress } as CSSProperties}
        aria-hidden="true"
      />
    </section>
  );
}
