import { ListMusic, Music } from "lucide-react";
import { Cover } from "../catalog/Cover";
import { useI18n } from "../i18n";
import { LikeButton } from "../likes/LikeButton";
import { LyricsButton } from "../lyrics/LyricsButton";
import { selectTrack, usePlayer } from "../player/context";
import { Controls } from "../player/Controls";
import { Progress } from "../player/Progress";
import { TrackInfo } from "../player/TrackInfo";
import { Volume } from "../player/Volume";
import { IconButton } from "../ui/IconButton";
import styles from "./PlayerBar.module.css";

/** The id of the button that opens the queue over the page (narrower windows). */
export const QUEUE_TOGGLE = "queue-toggle";

/** The player along the bottom (not on phones: they have the mini player). */
export function PlayerBar({
  queueOpen,
  onToggleQueue,
}: {
  queueOpen: boolean;
  onToggleQueue(): void;
}) {
  const { t } = useI18n();
  const track = usePlayer(selectTrack);
  return (
    <section className={`glass ${styles.bar}`} aria-label={t.player.label}>
      <div className={styles.track}>
        {track ? (
          <>
            <Cover id={track.album.cover_id} sizes="56px" className={styles.cover} />
            <TrackInfo track={track} />
            <LikeButton track={track} />
          </>
        ) : (
          <>
            <span className={`${styles.cover} ${styles.empty}`}>
              <Music />
            </span>
            <span className={styles.nothing}>{t.player.nothingPlaying}</span>
          </>
        )}
      </div>
      <div className={styles.center}>
        <Controls />
        <Progress />
      </div>
      <div className={styles.side}>
        <LyricsButton className={styles.toggle} />
        <IconButton
          id={QUEUE_TOGGLE}
          icon={ListMusic}
          label={t.player.queue}
          size="sm"
          aria-expanded={queueOpen}
          aria-controls="now-playing"
          className={`${styles.toggle} ${styles.queue}`}
          onClick={onToggleQueue}
        />
        <Volume />
      </div>
    </section>
  );
}
