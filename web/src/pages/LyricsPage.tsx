import { MessageSquareQuote } from "lucide-react";
import { Link } from "react-router";
import { ArtistLinks } from "../catalog/ArtistLinks";
import { Cover } from "../catalog/Cover";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { Lyrics } from "../lyrics/Lyrics";
import { selectTrack, usePlayer } from "../player/context";
import { usePageTint } from "../shell/pageTint";
import { coverTint } from "../theme/theme";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import styles from "./LyricsPage.module.css";

/** The words of the playing track, following it to the next one. Opened from the player. */
export function LyricsPage() {
  const { t } = useI18n();
  const track = usePlayer(selectTrack);
  const palette = track?.album.cover_palette;
  usePageTint(palette ? coverTint(palette) : null);
  useDocumentTitle(track ? t.lyrics.of(track.title) : t.lyrics.title);
  if (!track) {
    return (
      <>
        <PageHeader title={t.lyrics.title} />
        <EmptyState icon={MessageSquareQuote} title={t.player.nothingPlaying}>
          {t.lyrics.nothingPlaying}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <header className={styles.header}>
        <Cover id={track.album.cover_id} sizes="112px" className={styles.cover} />
        <div className={styles.text}>
          <p className={styles.kind}>{t.lyrics.title}</p>
          <h1 className={styles.title}>{track.title}</h1>
          <p className={styles.meta}>
            <span>
              <ArtistLinks artists={track.artists.length ? track.artists : [track.artist]} />
            </span>
            <Link to={`/albums/${track.album.id}`}>{track.album.title}</Link>
          </p>
        </div>
      </header>
      <section aria-labelledby="lyrics-heading" className={styles.body}>
        <h2 id="lyrics-heading" className="visually-hidden">
          {t.lyrics.title}
        </h2>
        <Lyrics key={track.id} track={track} />
      </section>
    </>
  );
}
