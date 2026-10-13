import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import styles from "./LoadError.module.css";

/** In place of content that failed to load, with a way to try again. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const { t } = useI18n();
  return (
    <div className={styles.error}>
      <Alert tone="error">
        {t.catalog.loadFailed} {errorMessage(t, error)}
      </Alert>
      <Button variant="secondary" size="small" onClick={onRetry}>
        {t.common.retry}
      </Button>
    </div>
  );
}
