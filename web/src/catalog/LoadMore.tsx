import { useEffect, useRef } from "react";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import styles from "./LoadMore.module.css";

interface Paging {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  error: unknown;
  fetchNextPage(): unknown;
}

/** The end of a long list: loads the next page as it comes near the screen, or when its
 * button is pressed (keyboards, screen readers). A page that failed to load waits for the
 * button: asking again by itself would ask many times a second while the server is down. */
export function LoadMore({ query }: { query: Paging }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (!hasNextPage) return null;
  const failed = isFetchNextPageError && !isFetchingNextPage;
  return (
    <div ref={ref} className={styles.more}>
      {failed && (
        <Alert tone="error">
          {t.catalog.loadFailed} {errorMessage(t, query.error)}
        </Alert>
      )}
      <Button
        variant="secondary"
        busyLabel={isFetchingNextPage && t.common.loading}
        onClick={() => fetchNextPage()}
      >
        {failed ? t.common.retry : t.catalog.showMore}
      </Button>
    </div>
  );
}
