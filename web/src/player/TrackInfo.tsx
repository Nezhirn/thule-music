import { Link } from "react-router";
import { ArtistLinks } from "../catalog/ArtistLinks";
import type { Track } from "../catalog/queries";
import styles from "./TrackInfo.module.css";

/** The playing track's title (a link to its album) and artists. */
export function TrackInfo({ track, large }: { track: Track; large?: boolean }) {
  return (
    <div className={`${styles.info} ${large ? styles.large : ""}`}>
      <Link to={`/albums/${track.album.id}`} className={styles.title}>
        {track.title}
      </Link>
      <span className={styles.artists}>
        <ArtistLinks artists={track.artists.length ? track.artists : [track.artist]} />
      </span>
    </div>
  );
}
