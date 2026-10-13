import { Clock, Pause, Play } from "lucide-react";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { selectTrack, usePlayer, usePlayerControls } from "../player/context";
import type { Source } from "../player/player";
import { TrackActions } from "../player/TrackActions";
import { ArtistLinks } from "./ArtistLinks";
import { Cover } from "./Cover";
import { duration } from "./format";
import type { Track } from "./queries";
import styles from "./TrackTable.module.css";

interface Props {
  tracks: Track[];
  /** The table's name for screen readers. */
  label: string;
  /** Where the tracks come from: the album or artist whose play button shows them playing. */
  source: Source;
  /** What playing a row queues, if not just the rows (an artist's top tracks, partly shown). */
  queue?: Track[];
  /** The numbers in the first column: track numbers (an album) or positions (a ranking). */
  numbers?: "track" | "position";
  /** The album's artist: credits that are just them aren't repeated on every row. */
  albumArtistId?: string;
  /** An album column, and small covers by the titles. */
  withAlbum?: boolean;
  /** A heading row per disc, when there are several. */
  byDisc?: boolean;
}

/** Tracks in a table: number (a play button on the row in focus or under the pointer), title
 * with the credited artists, album, length, a menu. A double click (a tap on touch screens)
 * plays the row too. */
export function TrackTable({
  tracks,
  label,
  source,
  queue = tracks,
  numbers,
  albumArtistId,
  withAlbum,
  byDisc,
}: Props) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const currentId = usePlayer((state) => selectTrack(state)?.id ?? null);
  const playing = usePlayer((state) => state.playing);
  const discs = byDisc ? groupByDisc(tracks) : [{ disc: null, tracks }];
  const columns = 4 + Number(Boolean(withAlbum));
  const positions = new Map(tracks.map((track, i) => [track.id, i + 1]));

  const play = (track: Track) => {
    if (track.id === currentId) {
      player.toggle();
      return;
    }
    const start = queue.findIndex((queued) => queued.id === track.id);
    player.play(start === -1 ? [track] : queue, { start: Math.max(start, 0), source });
  };
  // Clicks on the row itself, not on its links and buttons.
  const onRow = (event: MouseEvent, track: Track, touch: boolean) => {
    if ((event.target as Element).closest("a, button")) return;
    if (touch !== window.matchMedia("(hover: none)").matches) return;
    play(track);
  };

  return (
    <table className={styles.table}>
      <caption className="visually-hidden">{label}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.number}>
            {numbers ? (
              t.catalog.columns.number
            ) : (
              <span className="visually-hidden">{t.player.play}</span>
            )}
          </th>
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
          <th scope="col" className={styles.actions}>
            <span className="visually-hidden">{t.catalog.columns.actions}</span>
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
            const current = track.id === currentId;
            const number =
              numbers === "track" ? (track.track_no ?? "") : numbers && positions.get(track.id);
            return (
              <tr
                key={track.id}
                className={styles.row}
                aria-current={current || undefined}
                onDoubleClick={(event) => onRow(event, track, false)}
                onClick={(event) => onRow(event, track, true)}
              >
                <td className={styles.number}>
                  <div className={styles.slot}>
                    {current && playing ? (
                      <span className={styles.bars} aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <span className={styles.index}>{number}</span>
                    )}
                    <button
                      type="button"
                      className={styles.play}
                      aria-label={
                        current && playing ? t.player.pause : t.player.playItem(track.title)
                      }
                      onClick={() => play(track)}
                    >
                      {current && playing ? <Pause /> : <Play />}
                    </button>
                  </div>
                </td>
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
                <td className={styles.actions}>
                  <TrackActions track={track} className={styles.more} />
                </td>
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
