import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { PlayButton } from "../player/PlayButton";
import { Cover } from "./Cover";
import { albumQuery, type Album } from "./queries";
import styles from "./Card.module.css";

/** An album in a grid or a shelf: the cover and title open it, the artist opens theirs, the
 * button on the cover (under the pointer, in focus, or while it plays) plays it. */
export function AlbumCard({ album, detail }: { album: Album; detail?: "artist" | "year" }) {
  const queryClient = useQueryClient();
  return (
    <article className={styles.card}>
      <div className={styles.artWrap}>
        <Cover id={album.cover_id} sizes="(max-width: 899px) 45vw, 200px" className={styles.art} />
        <PlayButton
          source={{ type: "album", id: album.id }}
          name={album.title}
          tracks={async () => (await queryClient.fetchQuery(albumQuery(album.id))).tracks}
          size="md"
          className={styles.play}
        />
      </div>
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
