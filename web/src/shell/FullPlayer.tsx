import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { useLocation } from "react-router";
import { Cover } from "../catalog/Cover";
import { useI18n } from "../i18n";
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

  const palette = track?.album.cover_palette;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="full-player-title"
      style={palette ? ({ "--player-tint": coverTint(palette) } as CSSProperties) : undefined}
      onClose={onClose}
    >
      {track && (
        <div className={styles.body}>
          <div className={styles.top}>
            <IconButton icon={ChevronDown} label={t.player.closePlayer} onClick={onClose} />
            <h2 id="full-player-title" className={styles.heading}>
              {t.player.nowPlaying}
            </h2>
          </div>
          <Cover
            id={track.album.cover_id}
            sizes="(max-width: 899px) 86vw, 420px"
            className={styles.cover}
          />
          <TrackInfo track={track} large />
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
