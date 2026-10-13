import { Link } from "react-router";
import type { Schemas } from "../api/client";
import { useI18n } from "../i18n";
import { PlaylistCover } from "./PlaylistCover";
import card from "../catalog/Card.module.css";

/** A playlist in a shelf: its picture, its name (opening it), how many tracks. */
export function PlaylistCard({ playlist }: { playlist: Schemas["PlaylistOut"] }) {
  const { t } = useI18n();
  return (
    <article className={card.card}>
      <div className={card.artWrap}>
        <PlaylistCover
          ids={playlist.cover_ids}
          sizes="(max-width: 899px) 45vw, 200px"
          className={card.art}
        />
      </div>
      <Link to={`/playlists/${playlist.id}`} className={card.title}>
        {playlist.name}
      </Link>
      <span className={card.detail}>{t.catalog.tracks(playlist.track_count)}</span>
    </article>
  );
}
