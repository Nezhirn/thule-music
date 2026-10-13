import { Disc3 } from "lucide-react";
import { useState } from "react";
import { coverUrl } from "../api/covers";
import styles from "./Cover.module.css";

interface Props {
  id: string | null;
  /** Rendered width in CSS pixels, for picking the thumbnail; or a `sizes` value. */
  sizes: string;
  className?: string;
}

/** An album's artwork, square; a disc where there is none. Decorative: the title is next to
 * it. Lazy, so long grids load their covers as they scroll into view. */
export function Cover({ id, sizes, className }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const classes = [styles.cover, className].filter(Boolean).join(" ");
  if (!id || failed === id) {
    return (
      <span className={`${classes} ${styles.none}`}>
        <Disc3 className={styles.disc} />
      </span>
    );
  }
  return (
    <img
      className={classes}
      src={coverUrl(id, 300)}
      srcSet={`${coverUrl(id, 300)} 300w, ${coverUrl(id, 600)} 600w`}
      sizes={sizes}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(id)}
    />
  );
}
