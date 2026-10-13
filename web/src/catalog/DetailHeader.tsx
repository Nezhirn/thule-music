import type { ReactNode } from "react";
import type { Schemas } from "../api/client";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { usePageTint } from "../shell/pageTint";
import { coverTint } from "../theme/theme";
import styles from "./DetailHeader.module.css";

interface Props {
  /** "Album", "Artist": above the title. */
  kind: string;
  title: string;
  art: ReactNode;
  palette: Schemas["CoverPalette"] | null;
  /** Under the title: artist, year, length. */
  children?: ReactNode;
}

/** The head of an album's or artist's page. Holds the page's h1, sets the browser tab's title,
 * and tints the top of the panel with the colours of the cover. */
export function DetailHeader({ kind, title, art, palette, children }: Props) {
  useDocumentTitle(title);
  usePageTint(palette ? coverTint(palette) : null);
  return (
    <header className={styles.header}>
      <div className={styles.art}>{art}</div>
      <div className={styles.text}>
        <p className={styles.kind}>{kind}</p>
        <h1 className={styles.title}>{title}</h1>
        {children && <div className={styles.meta}>{children}</div>}
      </div>
    </header>
  );
}
