import { Link } from "react-router";
import styles from "./GenreLinks.module.css";

interface Props {
  label: string;
  genres: string[];
  /** The chosen one, marked as current; with `all`, a first link to all genres. */
  current?: string | null;
  all?: string;
  /** On several lines, instead of one that scrolls sideways. */
  wrap?: boolean;
  to(genre: string | null): string;
}

/** Genres as a row of pill links: filters of the album list, shortcuts on the home page. */
export function GenreLinks({ label, genres, current, all, wrap, to }: Props) {
  const items: [string | null, string][] = [
    ...(all ? [[null, all] as [null, string]] : []),
    ...genres.map((genre): [string, string] => [genre, genre]),
  ];
  return (
    <nav aria-label={label} className={styles.nav}>
      <ul className={`${styles.list} ${wrap ? styles.wrap : ""}`}>
        {items.map(([genre, name]) => {
          const selected =
            all !== undefined && (current ?? null)?.toLowerCase() === genre?.toLowerCase();
          return (
            <li key={genre ?? ""}>
              <Link
                to={to(genre)}
                className={styles.genre}
                aria-current={selected ? "true" : undefined}
              >
                {name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
