import { forgetSaved } from "../player/persist";
import { MESSAGES, savedLanguage, useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { CenteredLayout } from "../ui/CenteredLayout";
import styles from "./Crashed.module.css";

/** In place of a page that failed to render: the player and the navigation go on. */
export function PageCrashed({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <Alert tone="error">{t.shell.pageCrashed}</Alert>
      <Button variant="secondary" size="small" onClick={onRetry}>
        {t.common.retry}
      </Button>
    </div>
  );
}

/** In place of the whole app when it failed to render: outside its providers, so the
 * language is read here. Something kept on the device (the queue) may be what fails at
 * every start: it can be forgotten. */
export function AppCrashed() {
  const t = MESSAGES[savedLanguage()];
  return (
    <CenteredLayout>
      <Alert tone="error">{t.shell.appCrashed}</Alert>
      <div className={styles.actions}>
        <Button onClick={() => window.location.reload()}>{t.shell.reload}</Button>
        <Button
          variant="secondary"
          onClick={() => {
            forgetSaved();
            window.location.reload();
          }}
        >
          {t.shell.resetAndReload}
        </Button>
      </div>
    </CenteredLayout>
  );
}
