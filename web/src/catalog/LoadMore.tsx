import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import styles from "./LoadMore.module.css";

interface Paging {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage(): unknown;
}

/** The end of a long list: loads the next page as it comes near the screen, or when its
 * button is pressed (keyboards, screen readers). */
export function LoadMore({ query }: { query: Paging }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!hasNextPage) return null;
  return (
    <div ref={ref} className={styles.more}>
      <Button
        variant="secondary"
        busyLabel={isFetchingNextPage && t.common.loading}
        onClick={() => fetchNextPage()}
      >
        {t.catalog.showMore}
      </Button>
    </div>
  );
}
