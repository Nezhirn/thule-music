import { ListMusic } from "lucide-react";
import { Cover } from "../catalog/Cover";
import styles from "./playlists.module.css";

/** A playlist's picture, from the covers of its albums (`ids`, up to four): four make a
 * mosaic, fewer show the first, none a note. Decorative. */
export function PlaylistCover({
  ids,
  sizes,
  small,
  className,
}: {
  ids: string[];
  sizes: string;
  small?: boolean;
  className?: string;
}) {
  const size = [small && styles.small, className].filter(Boolean).join(" ");
  if (ids.length === 0) {
    return (
      <span className={`${styles.blank} ${size}`}>
        <ListMusic />
      </span>
    );
  }
  if (ids.length < 4) return <Cover id={ids[0]!} sizes={sizes} className={size} />;
  return (
    <span className={`${styles.mosaic} ${size}`}>
      {ids.slice(0, 4).map((id) => (
        <Cover key={id} id={id} sizes={sizes} />
      ))}
    </span>
  );
}
