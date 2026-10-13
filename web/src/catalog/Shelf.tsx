import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import styles from "./Shelf.module.css";

interface Props {
  title: string;
  /** Where "See all" leads. */
  more?: string;
  /** Wider items: the carousel of new albums. */
  wide?: boolean;
  children: ReactNode[];
}

/** A titled row of cards that scrolls sideways: swiped on touch screens, with buttons
 * elsewhere. Every card stays a link in the tab order; focusing one scrolls it into view. */
export function Shelf({ title, more, wide, children }: Props) {
  const { t } = useI18n();
  const id = useId();
  const row = useRef<HTMLUListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEnds({
      start: el.scrollLeft <= 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, children.length]);

  const scroll = (direction: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <section className={styles.shelf} aria-labelledby={id}>
      <div className={styles.head}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {more && (
          <Link to={more} className={styles.more}>
            {t.catalog.seeAll}
          </Link>
        )}
        {!(ends.start && ends.end) && (
          <span className={styles.buttons}>
            <IconButton
              label={t.catalog.scrollBack(title)}
              icon={ChevronLeft}
              size="sm"
              disabled={ends.start}
              onClick={() => scroll(-1)}
            />
            <IconButton
              label={t.catalog.scrollForward(title)}
              icon={ChevronRight}
              size="sm"
              disabled={ends.end}
              onClick={() => scroll(1)}
            />
          </span>
        )}
      </div>
      <ul ref={row} className={`${styles.row} ${wide ? styles.wide : ""}`} onScroll={measure}>
        {children.map((child, i) => (
          <li key={i} className={styles.item}>
            {child}
          </li>
        ))}
      </ul>
    </section>
  );
}
