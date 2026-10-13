import { useId, type ReactNode } from "react";
import styles from "./Card.module.css";

/** A titled group of content on a page, e.g. a section of the settings. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={id}>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  );
}
