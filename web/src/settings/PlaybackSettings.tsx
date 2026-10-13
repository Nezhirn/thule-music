import { useId } from "react";
import { useUpdatePreferences, type Preferences } from "../account/preferences";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Card } from "../ui/Card";
import { Segmented } from "../ui/Segmented";
import { Field } from "./Field";

type Quality = Preferences["stream_quality"];
const QUALITIES: readonly Quality[] = ["original", "high", "low"];

export function PlaybackSettings({ preferences }: { preferences: Preferences }) {
  const { t } = useI18n();
  const id = useId();
  const save = useUpdatePreferences();
  const text = t.settings.playback;
  const quality = preferences.stream_quality;
  return (
    <Card title={text.title}>
      {save.isError && (
        <Alert tone="error">{t.settings.saveFailed(errorMessage(t, save.error))}</Alert>
      )}
      <Field id={id} title={text.quality} note={text.qualityNotes[quality]}>
        <Segmented
          labelledBy={id}
          options={QUALITIES.map((value) => ({ value, label: text.qualities[value] }))}
          value={quality}
          onChange={(stream_quality) => save.mutate({ stream_quality })}
        />
      </Field>
    </Card>
  );
}
