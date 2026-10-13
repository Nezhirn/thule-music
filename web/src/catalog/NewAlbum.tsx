import { useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { PlayButton } from "../player/PlayButton";
import { coverTint } from "../theme/theme";
import { Cover } from "./Cover";
import { albumQuery, type Album } from "./queries";
import styles from "./NewAlbum.module.css";

/** A new album in the carousel at the top of the home page: a big cover on its colours. */
export function NewAlbum({ album }: { album: Album }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
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
        <PlayButton
          source={{ type: "album", id: album.id }}
          name={album.title}
          tracks={async () => (await queryClient.fetchQuery(albumQuery(album.id))).tracks}
          size="md"
          className={styles.play}
        />
      </div>
    </article>
  );
}
