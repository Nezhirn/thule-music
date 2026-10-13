import { useState } from "react";
import { useMe } from "../account/me";
import { usePreferences } from "../account/preferences";
import { useSession } from "../auth/session";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/PageHeader";
import { AccountSettings } from "./AccountSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { LanguageSettings } from "./LanguageSettings";
import { PasswordSettings } from "./PasswordSettings";
import { PlaybackSettings } from "./PlaybackSettings";
import styles from "./Settings.module.css";

/** Everything here is stored on the server, so it follows the user to every device. */
export function SettingsPage() {
  const { t } = useI18n();
  const session = useSession();
  const me = useMe();
  const preferences = usePreferences();
  const [signingOut, setSigningOut] = useState(false);
  if (!me || !preferences) return null;

  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className={styles.cards}>
        <AppearanceSettings preferences={preferences} />
        <LanguageSettings />
        <PlaybackSettings preferences={preferences} />
        <AccountSettings me={me} />
        <PasswordSettings />
        <Button
          variant="secondary"
          className={styles.end}
          busyLabel={signingOut && t.auth.signingOut}
          onClick={() => {
            setSigningOut(true);
            void session.signOut();
          }}
        >
          {t.auth.signOut}
        </Button>
      </div>
    </>
  );
}
