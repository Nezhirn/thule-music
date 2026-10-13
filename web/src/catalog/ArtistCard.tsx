import { Link } from "react-router";
import { useI18n } from "../i18n";
import { ArtistImage } from "./ArtistImage";
import type { Artist } from "./queries";
import styles from "./Card.module.css";

export function ArtistCard({ artist }: { artist: Artist }) {
  const { t } = useI18n();
  return (
    <article className={`${styles.card} ${styles.centered}`}>
      <ArtistImage
        name={artist.name}
        coverId={artist.cover_id}
        sizes="(max-width: 899px) 45vw, 200px"
        className={styles.art}
      />
      <Link to={`/artists/${artist.id}`} className={styles.title}>
        {artist.name}
      </Link>
      {artist.album_count > 0 && (
        <span className={styles.detail}>{t.catalog.albums(artist.album_count)}</span>
      )}
    </article>
  );
}
