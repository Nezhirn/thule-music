import { Clock, Pause, Play } from "lucide-react";
import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { LikeButton } from "../likes/LikeButton";
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
  /** What playing a row queues, if more than the rows: they are its beginning (an artist's
   * top tracks, partly shown). */
  queue?: Track[];
  /** The rows' keys, where a track can be listed twice (a playlist, the history). */
  keys?: string[];
  /** The numbers in the first column: track numbers (an album) or positions (a ranking). */
  numbers?: "track" | "position";
  /** The album's artist: credits that are just them aren't repeated on every row. */
  albumArtistId?: string;
  /** An album column, and small covers by the titles. */
  withAlbum?: boolean;
  /** A heading row per disc, when there are several. */
  byDisc?: boolean;
  /** A heading row over each run of rows with the same heading (the days of the history). */
  groupBy?(track: Track, index: number): string;
  /** More items for the row's menu (taking it out of a playlist). */
  actions?(index: number): ReactNode;
  /** Rows can be dragged to another place: the row at `from` goes to `to`. */
  onMove?(from: number, to: number): void;
}

interface Group {
  heading: string | null;
  rows: number[];
}

/** Tracks in a table: number (a play button on the row in focus or under the pointer), title
 * with the credited artists, album, like, length, a menu. A double click (a tap on touch
 * screens) plays the row too. */
export function TrackTable({
  tracks,
  label,
  source,
  queue = tracks,
  keys,
  numbers,
  albumArtistId,
  withAlbum,
  byDisc,
  groupBy,
  actions,
  onMove,
}: Props) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const currentId = usePlayer((state) => selectTrack(state)?.id ?? null);
  const playing = usePlayer((state) => state.playing);
  const [drag, setDrag] = useState<{ from: number; to: number | null } | null>(null);
  const columns = 5 + Number(Boolean(withAlbum));

  const discs = byDisc
    ? group(tracks, (track) => (track.disc_no === null ? null : t.catalog.disc(track.disc_no)))
    : [];
  const groups: Group[] = groupBy
    ? group(tracks, groupBy)
    : discs.length > 1
      ? discs
      : [{ heading: null, rows: tracks.map((_, i) => i) }];

  const play = (index: number) => {
    if (tracks[index]?.id === currentId) {
      player.toggle();
      return;
    }
    player.play(queue, { start: index, source });
  };
  // Clicks on the row itself, not on its links and buttons.
  const onRow = (event: MouseEvent, index: number, touch: boolean) => {
    if ((event.target as Element).closest("a, button")) return;
    if (touch !== window.matchMedia("(hover: none)").matches) return;
    play(index);
  };

  const dragging = (index: number) =>
    onMove && {
      draggable: true,
      onDragStart(event: DragEvent<HTMLTableRowElement>) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tracks[index]?.title ?? "");
        event.dataTransfer.setDragImage(event.currentTarget, 24, 24);
        setDrag({ from: index, to: null });
      },
      onDragOver(event: DragEvent<HTMLTableRowElement>) {
        if (!drag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const { top, height } = event.currentTarget.getBoundingClientRect();
        const to = event.clientY < top + height / 2 ? index : index + 1;
        if (drag.to !== to) setDrag({ ...drag, to });
      },
      onDrop(event: DragEvent<HTMLTableRowElement>) {
        if (!drag || drag.to === null) return;
        event.preventDefault();
        // Where it lands once taken out of its place.
        const to = drag.to > drag.from ? drag.to - 1 : drag.to;
        if (to !== drag.from) onMove(drag.from, to);
        setDrag(null);
      },
      onDragEnd: () => setDrag(null),
    };
  // The line showing where a dragged row would land: above a row, or below the last.
  const dropMark = (index: number) => {
    if (!drag || drag.to === null || drag.to === drag.from || drag.to === drag.from + 1) {
      return undefined;
    }
    if (drag.to === index) return "before";
    if (drag.to === tracks.length && index === tracks.length - 1) return "after";
    return undefined;
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
          <th scope="col" className={styles.like}>
            <span className="visually-hidden">{t.catalog.columns.liked}</span>
          </th>
          <th scope="col" className={styles.duration}>
            <Clock className={styles.clock} aria-hidden="true" />
            <span className="visually-hidden">{t.catalog.columns.duration}</span>
          </th>
          <th scope="col" className={styles.actions}>
            <span className="visually-hidden">{t.catalog.columns.actions}</span>
          </th>
        </tr>
      </thead>
      {groups.map(({ heading, rows }, g) => (
        <tbody key={g}>
          {heading !== null && (
            <tr className={styles.group}>
              <th scope="row" colSpan={columns}>
                {heading}
              </th>
            </tr>
          )}
          {rows.map((index) => {
            const track = tracks[index]!;
            const credits = track.artists.length ? track.artists : [track.artist];
            const showCredits =
              !albumArtistId || credits.some((artist) => artist.id !== albumArtistId);
            const current = track.id === currentId;
            const number =
              numbers === "track" ? (track.track_no ?? "") : numbers === "position" && index + 1;
            return (
              <tr
                key={keys?.[index] ?? track.id}
                className={styles.row}
                aria-current={current || undefined}
                data-key={keys?.[index]}
                data-drop={dropMark(index)}
                data-dragged={drag?.from === index || undefined}
                onDoubleClick={(event) => onRow(event, index, false)}
                onClick={(event) => onRow(event, index, true)}
                {...dragging(index)}
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
                      onClick={() => play(index)}
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
                <td className={styles.like}>
                  <LikeButton track={track} className={styles.heart} />
                </td>
                <td className={styles.duration}>{duration(track.duration_ms)}</td>
                <td className={styles.actions}>
                  <TrackActions track={track} className={styles.more}>
                    {actions?.(index)}
                  </TrackActions>
                </td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

/** Runs of rows with the same heading. */
function group(tracks: Track[], heading: (track: Track, index: number) => string | null) {
  const groups: Group[] = [];
  tracks.forEach((track, index) => {
    const own = heading(track, index);
    const last = groups.at(-1);
    if (last && last.heading === own) last.rows.push(index);
    else groups.push({ heading: own, rows: [index] });
  });
  return groups;
}
