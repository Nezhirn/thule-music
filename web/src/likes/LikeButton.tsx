import { Heart, Star } from "lucide-react";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import { useLiked, useToggleLike, type Likeable } from "./context";
import styles from "./LikeButton.module.css";

/** The heart of a track: in Liked songs or not. */
export function LikeButton({
  track,
  size = "sm",
  className,
}: {
  track: Track;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useI18n();
  const liked = useLiked("track", track);
  const toggle = useToggleLike();
  return (
    <IconButton
      icon={Heart}
      label={t.likes.like(track.title)}
      size={size}
      aria-pressed={liked}
      className={[styles.toggle, className].filter(Boolean).join(" ")}
      onClick={() => toggle("track", track, track.title)}
    />
  );
}

/** The star of an album or an artist: in Favourites or not. */
export function FavouriteButton({
  kind,
  item,
  name,
}: {
  kind: "album" | "artist";
  item: Likeable;
  name: string;
}) {
  const { t } = useI18n();
  const liked = useLiked(kind, item);
  const toggle = useToggleLike();
  return (
    <IconButton
      icon={Star}
      label={t.likes.favourite}
      aria-pressed={liked}
      className={styles.toggle}
      onClick={() => toggle(kind, item, name)}
    />
  );
}
