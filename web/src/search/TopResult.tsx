import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArtistImage } from "../catalog/ArtistImage";
import { ArtistLinks } from "../catalog/ArtistLinks";
import { Cover } from "../catalog/Cover";
import { albumQuery, artistQuery } from "../catalog/queries";
import { useI18n } from "../i18n";
import { PlayButton } from "../player/PlayButton";
import type { TopResult as Top } from "./match";
import styles from "./TopResult.module.css";

/** The best match, large: its picture, name (opening its page; a track's album), what it is,
 * and a button that plays it (an artist's popular tracks, an album, a track). */
export function TopResult({ top }: { top: Top }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  let picture, name, to, byline, play;
  if (top.kind === "artist") {
    const { artist } = top;
    name = artist.name;
    to = `/artists/${artist.id}`;
    picture = (
      <ArtistImage name={name} coverId={artist.cover_id} sizes="112px" className={styles.art} />
    );
    play = (
      <PlayButton
        source={{ type: "artist", id: artist.id }}
        name={name}
        tracks={async () => (await queryClient.fetchQuery(artistQuery(artist.id))).top_tracks}
        className={styles.play}
      />
    );
  } else if (top.kind === "album") {
    const { album } = top;
    name = album.title;
    to = `/albums/${album.id}`;
    picture = <Cover id={album.cover_id} sizes="112px" className={styles.art} />;
    byline = (
      <Link to={`/artists/${album.artist.id}`} className={styles.link}>
        {album.artist.name}
      </Link>
    );
    play = (
      <PlayButton
        source={{ type: "album", id: album.id }}
        name={name}
        tracks={async () => (await queryClient.fetchQuery(albumQuery(album.id))).tracks}
        className={styles.play}
      />
    );
  } else {
    const { track } = top;
    name = track.title;
    to = `/albums/${track.album.id}`;
    picture = <Cover id={track.album.cover_id} sizes="112px" className={styles.art} />;
    byline = (
      <span className={styles.artists}>
        <ArtistLinks artists={track.artists.length ? track.artists : [track.artist]} />
      </span>
    );
    play = (
      <PlayButton
        source={{ type: "track", id: track.id }}
        name={name}
        tracks={() => [track]}
        className={styles.play}
      />
    );
  }
  return (
    <div className={styles.frame}>
      <article className={styles.top}>
        {picture}
        <Link to={to} className={styles.name}>
          {name}
        </Link>
        <p className={styles.meta}>
          <span className={styles.kind}>{t.search.kind[top.kind]}</span>
          {byline && <span aria-hidden="true"> · </span>}
          {byline}
        </p>
        {play}
      </article>
    </div>
  );
}
