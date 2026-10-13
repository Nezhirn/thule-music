import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { meQuery } from "../auth/queries";
import { useSession } from "../auth/session";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import { CenteredLayout } from "../ui/CenteredLayout";
import styles from "./HomePage.module.css";

// Placeholder until the app shell (stage 2): who is signed in, and signing out.
export function HomePage() {
  const { t } = useI18n();
  const session = useSession();
  const me = useQuery(meQuery).data;
  const [signingOut, setSigningOut] = useState(false);
  if (!me) return null;

  return (
    <CenteredLayout>
      <div className={styles.account}>
        <p className={styles.muted}>{t.auth.signedInAs}</p>
        <h1 className={styles.name}>{me.display_name ?? me.username}</h1>
        <p className={styles.muted}>
          @{me.username}
          {me.role === "admin" && <span className={styles.badge}>{t.auth.admin}</span>}
        </p>
      </div>
      <p className={styles.muted}>{t.home.comingSoon}</p>
      <Button
        variant="secondary"
        busyLabel={signingOut && t.auth.signingOut}
        onClick={() => {
          setSigningOut(true);
          void session.signOut();
        }}
      >
        {t.auth.signOut}
      </Button>
    </CenteredLayout>
  );
}
