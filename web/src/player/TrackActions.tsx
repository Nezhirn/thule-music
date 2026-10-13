import {
  Disc3,
  FolderInput,
  Heart,
  HeartOff,
  ImagePlus,
  ListEnd,
  ListPlus,
  ListStart,
  MoreHorizontal,
  Pencil,
  SquarePen,
  Trash2,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Track } from "../catalog/queries";
import { useEdits } from "../edits/context";
import { useI18n } from "../i18n";
import { useLiked, useToggleLike } from "../likes/context";
import { useAddToPlaylist } from "../playlists/adding";
import { Menu, MenuItem, MenuLink, MenuSeparator } from "../ui/Menu";
import iconButton from "../ui/IconButton.module.css";
import { announce } from "../ui/toast";
import { usePlayerControls } from "./context";
import styles from "./TrackActions.module.css";

/** A track's menu: queue it next or last, like it, go to its album or artist; for admins,
 * edit it, its lyrics and cover, move it to another album, delete it. `children` are more
 * items, at the end. */
export function TrackActions({
  track,
  className,
  children,
}: {
  track: Track;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const liked = useLiked("track", track);
  const toggleLike = useToggleLike();
  const addToPlaylist = useAddToPlaylist();
  const edits = useEdits();
  return (
    <Menu
      label={t.player.trackActions(track.title)}
      trigger={<MoreHorizontal className={styles.icon} />}
      triggerClassName={[styles.trigger, className].filter(Boolean).join(" ")}
    >
      <MenuItem
        icon={ListStart}
        onSelect={() => {
          player.playNext([track]);
          announce(t.player.willPlayNext(track.title));
        }}
      >
        {t.player.playNext}
      </MenuItem>
      <MenuItem
        icon={ListEnd}
        onSelect={() => {
          player.addToQueue([track]);
          announce(t.player.addedToQueue(track.title));
        }}
      >
        {t.player.addToQueue}
      </MenuItem>
      <MenuItem
        icon={ListPlus}
        onSelect={() => addToPlaylist({ tracks: [track], name: track.title })}
      >
        {t.playlists.addTo}
      </MenuItem>
      <MenuItem
        icon={liked ? HeartOff : Heart}
        onSelect={() => toggleLike("track", track, track.title)}
      >
        {liked ? t.likes.removeFromLiked : t.likes.addToLiked}
      </MenuItem>
      <MenuLink to={`/albums/${track.album.id}`} icon={Disc3}>
        {t.player.goToAlbum}
      </MenuLink>
      <MenuLink to={`/artists/${track.artist.id}`} icon={UserRound}>
        {t.player.goToArtist}
      </MenuLink>
      {edits && (
        <>
          <MenuSeparator />
          <MenuItem icon={Pencil} onSelect={() => edits.editTrack(track)}>
            {t.edits.editTrack}
          </MenuItem>
          <MenuItem icon={SquarePen} onSelect={() => edits.editLyrics(track)}>
            {t.edits.editLyrics}
          </MenuItem>
          <MenuItem icon={ImagePlus} onSelect={() => edits.editCover({ kind: "track", track })}>
            {t.edits.changeCover}
          </MenuItem>
          <MenuItem
            icon={FolderInput}
            onSelect={() => edits.moveTracks({ tracks: [track], selected: [track.id] })}
          >
            {t.edits.moveTrack}
          </MenuItem>
          <MenuItem icon={Trash2} onSelect={() => edits.deleteTrack(track)}>
            {t.edits.deleteTrack}
          </MenuItem>
        </>
      )}
      {children}
    </Menu>
  );
}

/** The menu of an album or a playlist, in its header: queue all of it next or last, add it
 * to a playlist; `children` are more items, at the end. */
export function CollectionActions({
  name,
  tracks,
  children,
}: {
  /** The album's or playlist's name. */
  name: string;
  tracks: Track[];
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const addToPlaylist = useAddToPlaylist();
  return (
    <Menu
      label={t.player.trackActions(name)}
      trigger={<MoreHorizontal className={iconButton.icon} />}
      triggerClassName={`${iconButton.button} ${iconButton.md}`}
    >
      {tracks.length > 0 && (
        <>
          <MenuItem
            icon={ListStart}
            onSelect={() => {
              player.playNext(tracks);
              announce(t.player.willPlayNext(name));
            }}
          >
            {t.player.playNext}
          </MenuItem>
          <MenuItem
            icon={ListEnd}
            onSelect={() => {
              player.addToQueue(tracks);
              announce(t.player.addedToQueue(name));
            }}
          >
            {t.player.addToQueue}
          </MenuItem>
          <MenuItem icon={ListPlus} onSelect={() => addToPlaylist({ tracks, name })}>
            {t.playlists.addTo}
          </MenuItem>
        </>
      )}
      {children}
    </Menu>
  );
}
