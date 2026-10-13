import { SearchX } from "lucide-react";
import { ApiFailure } from "../api/errors";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { EmptyState } from "../ui/EmptyState";
import { LoadError } from "./LoadError";
import styles from "./PageStatus.module.css";

/** A page while its data loads. */
export function PageLoading() {
  const { t } = useI18n();
  return (
    <p role="status" className={styles.loading}>
      {t.common.loading}
    </p>
  );
}

/** A page whose data didn't load: not found (with its own title), or an error to retry. */
export function PageFailed({
  error,
  notFound,
  onRetry,
}: {
  error: unknown;
  notFound: string;
  onRetry(): void;
}) {
  if (error instanceof ApiFailure && error.status === 404) return <NotFound title={notFound} />;
  return <LoadError error={error} onRetry={onRetry} />;
}

function NotFound({ title }: { title: string }) {
  const { t } = useI18n();
  useDocumentTitle(title);
  return (
    <>
      <h1 className="visually-hidden">{title}</h1>
      <EmptyState icon={SearchX} title={title}>
        {t.catalog.notFound}
      </EmptyState>
    </>
  );
}
