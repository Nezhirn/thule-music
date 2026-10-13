import { useEffect, useId } from "react";
import { useUpdatePreferences, type Preferences } from "../account/preferences";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/context";
import { Alert } from "../ui/Alert";
import { Card } from "../ui/Card";
import { Switch } from "../ui/Switch";
import { AccentPicker } from "./AccentPicker";
import { CoverPreview } from "./CoverPreview";
import { Field } from "./Field";
import styles from "./Settings.module.css";

export function AppearanceSettings({ preferences }: { preferences: Preferences }) {
  const { t } = useI18n();
  const accentId = useId();
  const { previewAccent, previewCover } = useTheme();
  const save = useUpdatePreferences();
  const text = t.settings.appearance;

  // Previews last as long as the settings are open.
  useEffect(
    () => () => {
      previewAccent(null);
      previewCover(null);
    },
    [previewAccent, previewCover],
  );

  return (
    <Card title={text.title}>
      {save.isError && (
        <Alert tone="error">{t.settings.saveFailed(errorMessage(t, save.error))}</Alert>
      )}
      <Field id={accentId} title={text.accent} note={text.accentNote}>
        <AccentPicker
          labelledBy={accentId}
          value={preferences.accent_color}
          onPreview={previewAccent}
          onPick={(color) =>
            save.mutate({ accent_color: color }, { onSettled: () => previewAccent(null) })
          }
        />
      </Field>
      <div className={styles.divider} />
      <Switch
        label={text.blur}
        description={text.blurNote}
        checked={preferences.blur}
        onChange={(blur) => save.mutate({ blur })}
      />
      <div className={styles.divider} />
      <Switch
        label={text.adaptive}
        description={text.adaptiveNote}
        checked={preferences.adaptive_color}
        onChange={(adaptive) => {
          if (!adaptive) previewCover(null);
          save.mutate({ adaptive_color: adaptive });
        }}
      />
      {preferences.adaptive_color && <CoverPreview />}
    </Card>
  );
}
