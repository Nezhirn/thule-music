import { Music, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Cover } from "../catalog/Cover";
import { codecName } from "../catalog/format";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { selectTrack, usePlayer, usePlayerControls } from "../player/context";
import { QueueList } from "../player/QueueList";
import { TrackInfo } from "../player/TrackInfo";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import styles from "./NowPlaying.module.css";

/** The right column: the playing track with its cover, and what plays next. In narrower
 * windows it opens over the page from the player's queue button (`open`). */
export function NowPlaying({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const track = usePlayer(selectTrack);
  const more = usePlayer((state) => state.queue.current < state.queue.items.length - 1);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opened over the page: reading goes on from its top.
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  return (
    <aside
      id="now-playing"
      className={`glass ${styles.aside}`}
      data-open={open || undefined}
      aria-labelledby="now-playing-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) onClose();
      }}
    >
      <div className={styles.head}>
        <h2 id="now-playing-title" ref={heading} tabIndex={-1} className={styles.title}>
          {t.player.nowPlaying}
        </h2>
        <IconButton
          icon={X}
          label={t.player.closeQueue}
          size="sm"
          className={styles.close}
          onClick={onClose}
        />
      </div>
      {track ? (
        <>
          <Playing track={track} />
          <div className={styles.head}>
            <h2 id="up-next-title" tabIndex={-1} className={styles.title}>
              {t.player.upNext}
            </h2>
            {more && (
              <Button variant="secondary" size="small" onClick={() => player.clearUpcoming()}>
                {t.player.clearQueue}
              </Button>
            )}
          </div>
          <QueueList labelledBy="up-next-title" />
        </>
      ) : (
        <EmptyState icon={Music} title={t.player.nothingPlaying}>
          {t.player.nowPlayingEmpty}
        </EmptyState>
      )}
    </aside>
  );
}

function Playing({ track }: { track: Track }) {
  const { t } = useI18n();
  const stream = usePlayer((state) => state.stream);
  return (
    <div className={styles.playing}>
      <Cover id={track.album.cover_id} sizes="280px" className={styles.cover} />
      <TrackInfo track={track} large />
      {stream && (
        <p className={styles.stream}>{t.player.stream(codecName(stream.codec), stream.bitrate)}</p>
      )}
    </div>
  );
}
