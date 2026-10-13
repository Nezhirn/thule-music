import { Link } from "react-router";
import { Cover } from "./Cover";
import type { Album } from "./queries";
import styles from "./Card.module.css";

/** An album in a grid or a shelf: the cover and title open it, the artist opens theirs. */
export function AlbumCard({ album, detail }: { album: Album; detail?: "artist" | "year" }) {
  return (
    <article className={styles.card}>
      <Cover id={album.cover_id} sizes="(max-width: 899px) 45vw, 200px" className={styles.art} />
      <Link to={`/albums/${album.id}`} className={styles.title}>
        {album.title}
      </Link>
      {detail === "year" ? (
        album.year && <span className={styles.detail}>{album.year}</span>
      ) : (
        <Link to={`/artists/${album.artist.id}`} className={`${styles.detail} ${styles.link}`}>
          {album.artist.name}
        </Link>
      )}
    </article>
  );
}
