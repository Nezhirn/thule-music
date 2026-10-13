import { User } from "lucide-react";
import { coverUrl } from "../api/covers";
import styles from "./Avatar.module.css";

/** The user's photo; a neutral silhouette until they upload one. Decorative: the name is
 * always next to it or in the label of what contains it. */
export function Avatar({ id, size }: { id: string | null; size: number }) {
  const style = { width: size, height: size };
  if (!id) {
    return (
      <span className={styles.avatar} style={style}>
        <User className={styles.silhouette} />
      </span>
    );
  }
  return (
    <img
      className={styles.avatar}
      style={style}
      src={coverUrl(id, size > 48 ? 300 : 64)}
      alt=""
      width={size}
      height={size}
    />
  );
}
