import { Clock, Pause, Play } from "lucide-react";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
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
  const [drag, setDrag] = useState<Drag | null>(null);
  const columns = 5 + Number(Boolean(withAlbum));

  // What the rows' handlers read when called: the handlers stay the same objects, so a row
  // renders again only when what it shows changes.
  const latest = useRef({ tracks, queue, source, onMove, drag });
  useLayoutEffect(() => {
    latest.current = { tracks, queue, source, onMove, drag };
  });
  const handlers = useMemo<RowHandlers>(() => {
    const play = (index: number) => {
      const { tracks, queue, source } = latest.current;
      if (tracks[index]?.id === selectTrack(player.store.getState())?.id) {
        player.toggle();
        return;
      }
      player.play(queue, { start: index, source });
    };
    return {
      play,
      // Clicks on the row itself, not on its links and buttons.
      click(event, index, touch) {
        if ((event.target as Element).closest("a, button")) return;
        if (touch !== window.matchMedia("(hover: none)").matches) return;
        play(index);
      },
      dragStart(event, index) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", latest.current.tracks[index]?.title ?? "");
        event.dataTransfer.setDragImage(event.currentTarget, 24, 24);
        setDrag({ from: index, to: null });
      },
      dragOver(event, index) {
        const { drag } = latest.current;
        if (!drag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const { top, height } = event.currentTarget.getBoundingClientRect();
        const to = event.clientY < top + height / 2 ? index : index + 1;
        if (drag.to !== to) setDrag({ ...drag, to });
      },
      drop(event) {
        const { drag, onMove } = latest.current;
        if (!drag || drag.to === null) return;
        event.preventDefault();
        // Where it lands once taken out of its place.
        const to = drag.to > drag.from ? drag.to - 1 : drag.to;
        if (to !== drag.from) onMove?.(drag.from, to);
        setDrag(null);
      },
      dragEnd: () => setDrag(null),
    };
  }, [player]);

  const discs = byDisc
    ? group(tracks, (track) => (track.disc_no === null ? null : t.catalog.disc(track.disc_no)))
    : [];
  const groups: Group[] = groupBy
    ? group(tracks, groupBy)
    : discs.length > 1
      ? discs
      : [{ heading: null, rows: tracks.map((_, i) => i) }];

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
            return (
              <Row
                key={keys?.[index] ?? track.id}
                track={track}
                index={index}
                rowKey={keys?.[index]}
                number={
                  numbers === "track"
                    ? (track.track_no ?? "")
                    : numbers === "position"
                      ? index + 1
                      : ""
                }
                albumArtistId={albumArtistId}
                withAlbum={withAlbum}
                draggable={Boolean(onMove)}
                drop={dropMark(index)}
                dragged={drag?.from === index}
                actions={actions}
                handlers={handlers}
              />
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

interface Drag {
  from: number;
  to: number | null;
}

interface RowHandlers {
  play(index: number): void;
  click(event: MouseEvent, index: number, touch: boolean): void;
  dragStart(event: DragEvent<HTMLTableRowElement>, index: number): void;
  dragOver(event: DragEvent<HTMLTableRowElement>, index: number): void;
  drop(event: DragEvent<HTMLTableRowElement>): void;
  dragEnd(): void;
}

interface RowProps {
  track: Track;
  index: number;
  rowKey?: string;
  number: number | string;
  albumArtistId?: string;
  withAlbum?: boolean;
  draggable: boolean;
  drop?: "before" | "after";
  dragged: boolean;
  actions?(index: number): ReactNode;
  handlers: RowHandlers;
}

/** One track. It follows the player itself (playing, paused, another track): a new track or
 * a pause renders the two rows it concerns, not a playlist of thousands. */
const Row = memo(function Row({
  track,
  index,
  rowKey,
  number,
  albumArtistId,
  withAlbum,
  draggable,
  drop,
  dragged,
  actions,
  handlers,
}: RowProps) {
  const { t } = useI18n();
  const state = usePlayer((player) =>
    selectTrack(player)?.id === track.id ? (player.playing ? "playing" : "current") : null,
  );
  const current = state !== null;
  const playing = state === "playing";
  const credits = track.artists.length ? track.artists : [track.artist];
  const showCredits = !albumArtistId || credits.some((artist) => artist.id !== albumArtistId);
  return (
    <tr
      className={styles.row}
      aria-current={current || undefined}
      data-key={rowKey}
      data-drop={drop}
      data-dragged={dragged || undefined}
      onDoubleClick={(event) => handlers.click(event, index, false)}
      onClick={(event) => handlers.click(event, index, true)}
      {...(draggable && {
        draggable: true,
        onDragStart: (event: DragEvent<HTMLTableRowElement>) => handlers.dragStart(event, index),
        onDragOver: (event: DragEvent<HTMLTableRowElement>) => handlers.dragOver(event, index),
        onDrop: handlers.drop,
        onDragEnd: handlers.dragEnd,
      })}
    >
      <td className={styles.number}>
        <div className={styles.slot}>
          {playing ? (
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
            aria-label={playing ? t.player.pause : t.player.playItem(track.title)}
            onClick={() => handlers.play(index)}
          >
            {playing ? <Pause /> : <Play />}
          </button>
        </div>
      </td>
      <td>
        <div className={styles.main}>
          {withAlbum && <Cover id={track.cover_id} sizes="40px" className={styles.cover} />}
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
});

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
