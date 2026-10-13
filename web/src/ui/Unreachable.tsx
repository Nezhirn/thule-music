import { useI18n } from "../i18n";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { CenteredLayout } from "./CenteredLayout";

export function Unreachable({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  return (
    <CenteredLayout>
      <Alert tone="error">{t.common.unreachable}</Alert>
      <Button onClick={onRetry}>{t.common.retry}</Button>
    </CenteredLayout>
  );
}
