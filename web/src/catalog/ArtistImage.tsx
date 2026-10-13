import { coverUrl } from "../api/covers";
import { toHex, fromOklch } from "../theme/color";
import styles from "./ArtistImage.module.css";

/** An artist's picture (the one an admin chose, else the cover of their newest album), round;
 * their initial on a colour of their own where there is none. Decorative: the name is next
 * to it. */
export function ArtistImage({
  name,
  coverId,
  sizes,
  className,
}: {
  name: string;
  coverId: string | null;
  sizes: string;
  className?: string;
}) {
  const classes = [styles.image, className].filter(Boolean).join(" ");
  if (coverId) {
    return (
      <img
        className={classes}
        src={coverUrl(coverId, 300)}
        srcSet={`${coverUrl(coverId, 300)} 300w, ${coverUrl(coverId, 600)} 600w`}
        sizes={sizes}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span className={`${classes} ${styles.initial}`} style={{ background: colourOf(name) }}>
      <span aria-hidden="true">{[...name][0]?.toUpperCase()}</span>
    </span>
  );
}

/** A dark colour from the name, the same every time: white letters read on it. */
function colourOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return toHex(fromOklch({ l: 0.42, c: 0.09, h: hash }));
}
