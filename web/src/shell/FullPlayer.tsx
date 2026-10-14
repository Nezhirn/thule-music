import { ChevronDown, MessageSquareQuote } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "react-router";
import { Cover } from "../catalog/Cover";
import { useI18n } from "../i18n";
import { LikeButton } from "../likes/LikeButton";
import { Lyrics } from "../lyrics/Lyrics";
import { selectTrack, usePlayer } from "../player/context";
import { Controls } from "../player/Controls";
import { Progress } from "../player/Progress";
import { QueueList } from "../player/QueueList";
import { TrackInfo } from "../player/TrackInfo";
import { coverTint } from "../theme/theme";
import { IconButton } from "../ui/IconButton";
import styles from "./FullPlayer.module.css";

/** The phone's player, over everything: the cover, the controls, what plays next. Closes
 * with its button, Escape (the back gesture on Android) or a link followed from it. */
export function FullPlayer({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const track = usePlayer(selectTrack);
  const { pathname } = useLocation();
  const shown = open && track !== null;
  // The lyrics in place of the cover.
  const [lyrics, setLyrics] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (shown && !element.open) element.showModal();
    if (!shown && element.open) element.close();
  }, [shown]);

  // A link in it was followed: the page shows.
  const page = useRef(pathname);
  useEffect(() => {
    if (page.current === pathname) return;
    page.current = pathname;
    onClose();
  }, [pathname, onClose]);

  const palette = track?.cover_palette;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="full-player-title"
      style={palette ? ({ "--player-tint": coverTint(palette) } as CSSProperties) : undefined}
      onClose={onClose}
    >
      {shown && (
        <div className={styles.body}>
          <div className={styles.top}>
            <IconButton icon={ChevronDown} label={t.player.closePlayer} onClick={onClose} />
            <h2 id="full-player-title" className={styles.heading}>
              {t.player.nowPlaying}
            </h2>
          </div>
          {lyrics ? (
            // Scrolls on its own: in the tab order, so keyboards scroll it too.
            <section
              aria-label={t.lyrics.title}
              tabIndex={0}
              className={`${styles.cover} ${styles.lyrics}`}
            >
              <Lyrics key={track.id} track={track} size="small" />
            </section>
          ) : (
            <Cover
              id={track.cover_id}
              sizes="(max-width: 899px) 86vw, 420px"
              className={styles.cover}
            />
          )}
          <div className={styles.info}>
            <TrackInfo track={track} large />
            <IconButton
              icon={MessageSquareQuote}
              label={t.lyrics.button}
              aria-pressed={lyrics}
              className={styles.toggle}
              onClick={() => setLyrics(!lyrics)}
            />
            <LikeButton track={track} size="md" />
          </div>
          <Progress />
          <Controls large />
          <section className={styles.queue} aria-labelledby="full-up-next">
            <h2 id="full-up-next" tabIndex={-1} className={styles.heading}>
              {t.player.upNext}
            </h2>
            <QueueList labelledBy="full-up-next" />
          </section>
        </div>
      )}
    </dialog>
  );
}
