import {
  Disc3,
  Heart,
  HeartOff,
  ListEnd,
  ListPlus,
  ListStart,
  MoreHorizontal,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { useLiked, useToggleLike } from "../likes/context";
import { useAddToPlaylist } from "../playlists/adding";
import { Menu, MenuItem, MenuLink } from "../ui/Menu";
import iconButton from "../ui/IconButton.module.css";
import { announce } from "../ui/toast";
import { usePlayerControls } from "./context";
import styles from "./TrackActions.module.css";

/** A track's menu: queue it next or last, like it, go to its album or artist; `children` are
 * more items, at the end. */
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
