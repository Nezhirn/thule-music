import { useId } from "react";
import { errorMessage } from "../api/errors";
import { useChooseLanguage } from "../auth/useChooseLanguage";
import { LANGUAGES, MESSAGES, useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Card } from "../ui/Card";
import { Segmented } from "../ui/Segmented";
import { Field } from "./Field";

export function LanguageSettings() {
  const { t, language } = useI18n();
  const id = useId();
  const { choose, error } = useChooseLanguage();
  const options = LANGUAGES.map((value) => ({
    value,
    label: MESSAGES[value].languageName,
    lang: value,
  }));
  return (
    <Card title={t.settings.language.title}>
      {error && <Alert tone="error">{t.settings.saveFailed(errorMessage(t, error))}</Alert>}
      <Field id={id} title={t.settings.language.label} note={t.settings.language.note}>
        <Segmented labelledBy={id} options={options} value={language} onChange={choose} />
      </Field>
    </Card>
  );
}
