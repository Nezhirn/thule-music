import { Disc3, ListEnd, ListStart, MoreHorizontal, UserRound } from "lucide-react";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Menu, MenuItem, MenuLink } from "../ui/Menu";
import { announce } from "../ui/toast";
import { usePlayerControls } from "./context";
import styles from "./TrackActions.module.css";

/** A track's menu: queue it next or last, go to its album or artist. */
export function TrackActions({ track, className }: { track: Track; className?: string }) {
  const { t } = useI18n();
  const player = usePlayerControls();
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
      <MenuLink to={`/albums/${track.album.id}`} icon={Disc3}>
        {t.player.goToAlbum}
      </MenuLink>
      <MenuLink to={`/artists/${track.artist.id}`} icon={UserRound}>
        {t.player.goToArtist}
      </MenuLink>
    </Menu>
  );
}
