import type { CSSProperties } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { coverTint } from "../theme/theme";
import { Cover } from "./Cover";
import type { Album } from "./queries";
import styles from "./NewAlbum.module.css";

/** A new album in the carousel at the top of the home page: a big cover on its colours. */
export function NewAlbum({ album }: { album: Album }) {
  const { t } = useI18n();
  const tint = album.cover_palette ? coverTint(album.cover_palette) : null;
  return (
    <article
      className={styles.card}
      style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}
    >
      <Cover id={album.cover_id} sizes="(max-width: 899px) 120px, 200px" className={styles.art} />
      <div className={styles.text}>
        <span className={styles.kind}>{t.catalog.album}</span>
        <Link to={`/albums/${album.id}`} className={styles.title}>
          {album.title}
        </Link>
        <Link to={`/artists/${album.artist.id}`} className={styles.artist}>
          {album.artist.name}
        </Link>
        <span className={styles.meta}>{[album.year, album.genre].filter(Boolean).join(" · ")}</span>
      </div>
    </article>
  );
}
