import { Clock } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { ArtistLinks } from "./ArtistLinks";
import { Cover } from "./Cover";
import { duration } from "./format";
import type { Track } from "./queries";
import styles from "./TrackTable.module.css";

interface Props {
  tracks: Track[];
  /** The table's name for screen readers. */
  label: string;
  /** The numbers in the first column: track numbers (an album) or positions (a ranking). */
  numbers?: "track" | "position";
  /** The album's artist: credits that are just them aren't repeated on every row. */
  albumArtistId?: string;
  /** An album column, and small covers by the titles. */
  withAlbum?: boolean;
  /** A heading row per disc, when there are several. */
  byDisc?: boolean;
}

/** Tracks in a table: number, title with the credited artists, album, length. */
export function TrackTable({ tracks, label, numbers, albumArtistId, withAlbum, byDisc }: Props) {
  const { t } = useI18n();
  const discs = byDisc ? groupByDisc(tracks) : [{ disc: null, tracks }];
  const columns = 2 + Number(Boolean(numbers)) + Number(Boolean(withAlbum));
  const positions = new Map(tracks.map((track, i) => [track.id, i + 1]));
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">{label}</caption>
      <thead>
        <tr>
          {numbers && (
            <th scope="col" className={styles.number}>
              {t.catalog.columns.number}
            </th>
          )}
          <th scope="col">{t.catalog.columns.title}</th>
          {withAlbum && (
            <th scope="col" className={styles.album}>
              {t.catalog.columns.album}
            </th>
          )}
          <th scope="col" className={styles.duration}>
            <Clock className={styles.clock} aria-hidden="true" />
            <span className="visually-hidden">{t.catalog.columns.duration}</span>
          </th>
        </tr>
      </thead>
      {discs.map(({ disc, tracks: rows }) => (
        <tbody key={disc ?? "all"}>
          {disc !== null && discs.length > 1 && (
            <tr className={styles.disc}>
              <th scope="row" colSpan={columns}>
                {t.catalog.disc(disc)}
              </th>
            </tr>
          )}
          {rows.map((track) => {
            const credits = track.artists.length ? track.artists : [track.artist];
            const showCredits =
              !albumArtistId || credits.some((artist) => artist.id !== albumArtistId);
            return (
              <tr key={track.id} className={styles.row}>
                {numbers && (
                  <td className={styles.number}>
                    {numbers === "track" ? (track.track_no ?? "") : positions.get(track.id)}
                  </td>
                )}
                <td>
                  <div className={styles.main}>
                    {withAlbum && (
                      <Cover id={track.album.cover_id} sizes="40px" className={styles.cover} />
                    )}
                    <div className={styles.titles}>
                      <span className={styles.title}>{track.title}</span>
                      {(showCredits || withAlbum) && (
                        <span className={styles.credits}>
                          {showCredits && <ArtistLinks artists={credits} />}
                          {withAlbum && (
                            <span className={styles.inlineAlbum}>
                              {showCredits && " · "}
                              {track.album.title}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                {withAlbum && (
                  <td className={styles.album}>
                    <Link to={`/albums/${track.album.id}`} className={styles.albumLink}>
                      {track.album.title}
                    </Link>
                  </td>
                )}
                <td className={styles.duration}>{duration(track.duration_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

function groupByDisc(tracks: Track[]): { disc: number | null; tracks: Track[] }[] {
  const groups: { disc: number | null; tracks: Track[] }[] = [];
  for (const track of tracks) {
    const last = groups.at(-1);
    if (last && last.disc === track.disc_no) last.tracks.push(track);
    else groups.push({ disc: track.disc_no, tracks: [track] });
  }
  return groups;
}
